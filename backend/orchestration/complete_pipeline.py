"""
backend/orchestration/complete_pipeline.py
Optimized pipeline: parallel execution, deduped logic, dead-code removed.

Fixes applied (v3):
  1. get_technical_result: run_technical_model returns None on model failure
     but the result was being used directly — added explicit None check so
     the MA crossover fallback always fires when the model can't run.
  2. MA crossover fallback: now also computes RSI-based refinement and returns
     a more accurate score instead of a hard-clipped 0.5±0.25.  Also emits
     synthetic p_sell/p_hold/p_buy stubs so the fusion layer never crashes
     trying to read those keys.
  3. fuse_and_decide: fundamental_score was weighted 0.35 but was almost always
     0.0 (scraper issues), dragging final_score below 0.45 → forced HOLD/SELL.
     Weights re-balanced so technical + sentiment carry the score when
     fundamentals are unavailable.
  4. main.py was importing _get_price_data from here — kept exported but also
     fixed to never return None (always returns empty DataFrame as sentinel).
  5. technical_score key: pipeline returned result["technical"]["technical_score"]
     which main.py now reads correctly — verified key path is consistent.
  6. fuse_and_decide: reads p_hold from tech dict to build a conviction
     multiplier — high p_hold (model sees sideways/choppy market) dampens the
     entire fused score rather than just the technical component.
  7. Decision thresholds lowered to match the new conviction-dampened score
     distribution: BUY ≥ 0.62 (was 0.68), HOLD ≥ 0.42 (was 0.45).
"""

from __future__ import annotations

import importlib
import logging
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[1]
TECH_MODEL_PATH    = ROOT / "models" / "technical_model" / "gru_stock_classifier-2.keras"
TECH_FEATURE_PATH  = ROOT / "models" / "technical_model" / "feature_columns.json"
SENTIMENT_MODEL_PATH = ROOT / "models" / "sentiment_model" / "sentiment_expert_model_v1"
SENTIMENT_MODEL_REPO = "Rishabhkapur/financial-analysis-upgrade-sentiment"

_PRICE_CACHE: Dict[Tuple[str, str], pd.DataFrame] = {}
_SENTIMENT_MODEL = None
_SENTIMENT_TOKENIZER = None
_SENTIMENT_CACHE: Dict[str, Dict[str, Any]] = {}
_SENTIMENT_CACHE_TTL_HOURS = 24

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _clean_ticker(ticker: str) -> str:
    return str(ticker or "").strip().upper()


def _is_valid_number(value: object) -> bool:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return False
    return not (math.isnan(n) or math.isinf(n))


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        n = float(value)
        return default if (math.isnan(n) or math.isinf(n)) else n
    except (TypeError, ValueError):
        return default


def _to_builtin(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _to_builtin(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        converted = [_to_builtin(v) for v in value]
        return type(value)(converted)
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return 0.0
    return value


def _load_module(module_path: str):
    try:
        return importlib.import_module(module_path)
    except Exception as exc:
        logger.warning("Unable to import %s: %s", module_path, exc)
        return None


# ──────────────────────────────────────────────
# Price data
# ──────────────────────────────────────────────

_EMPTY_PRICE_DF = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _get_price_data(ticker: str, period: str = "2y") -> pd.DataFrame:
    """
    Fetch OHLCV data for ticker. Never returns None — always a DataFrame.
    Exported so main.py can call it, but main.py's _fetch_price_df is
    preferred for the API response (uses 1y period, handles tz-aware index).
    """
    cache_key = (_clean_ticker(ticker), period)
    if cache_key in _PRICE_CACHE:
        logger.debug("Cache hit: price data for %s", cache_key[0])
        return _PRICE_CACHE[cache_key].copy()

    logger.info("Fetching price data for %s (%s)", cache_key[0], period)

    # Try dedicated scraper first
    stock_mod = _load_module("backend.preprocessing.stock_feature_scraper")
    if stock_mod and hasattr(stock_mod, "fetch_price_data"):
        try:
            df = stock_mod.fetch_price_data(cache_key[0], period=period)
            if isinstance(df, pd.DataFrame) and not df.empty:
                _PRICE_CACHE[cache_key] = df.copy()
                return df.copy()
        except Exception as exc:
            logger.warning("stock_feature_scraper.fetch_price_data failed: %s", exc)

    # Fallback to yfinance directly
    try:
        yf = importlib.import_module("yfinance")
        df = yf.download(cache_key[0], period=period, progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if not df.empty and "Close" in df.columns:
            df = df[["Open", "High", "Low", "Close", "Volume"]]
            _PRICE_CACHE[cache_key] = df.copy()
            return df.copy()
    except Exception as exc:
        logger.exception("Price fetch failed for %s: %s", cache_key[0], exc)

    return _EMPTY_PRICE_DF.copy()


# ──────────────────────────────────────────────
# Technical MA+RSI fallback  (fix #2)
# ──────────────────────────────────────────────

def _ma_crossover_score(price_df: pd.DataFrame) -> dict:
    """
    Compute a technical score purely from price data when the GRU model
    is unavailable.  Uses MA crossover + RSI to produce a smoother score
    than the old hard-clipped 0.25/0.75 values.

    Also emits synthetic p_sell/p_hold/p_buy stubs (fix #2 extension) so the
    fusion layer has consistent keys regardless of which code path ran.
    """
    try:
        close = price_df["Close"].dropna()
        if len(close) < 50:
            return {
                "technical_score": 0.5, "signal": "HOLD", "confidence": "low",
                "p_sell": 0.25, "p_hold": 0.5, "p_buy": 0.25,
            }

        ma20 = float(close.rolling(20).mean().iloc[-1])
        ma50 = float(close.rolling(50).mean().iloc[-1])
        ma200_series = close.rolling(200).mean()
        ma200 = float(ma200_series.iloc[-1]) if len(close) >= 200 else ma50

        # RSI-14
        delta  = close.diff()
        gain   = delta.clip(lower=0).rolling(14).mean()
        loss   = (-delta.clip(upper=0)).rolling(14).mean()
        rs     = gain / (loss + 1e-9)
        rsi    = float(100 - (100 / (1 + rs.iloc[-1])))

        # Score components
        ma_signal   = 1.0 if ma20 > ma50 else 0.0
        trend_above = 1.0 if float(close.iloc[-1]) > ma200 else 0.0
        rsi_score   = float(np.clip((rsi - 30) / 40, 0.0, 1.0))  # 30→0, 70→1

        raw_score = 0.45 * ma_signal + 0.25 * trend_above + 0.30 * rsi_score
        score     = float(np.clip(raw_score, 0.0, 1.0))

        diff_pct   = abs(ma20 - ma50) / (ma50 + 1e-9)
        confidence = "high" if diff_pct > 0.02 else ("medium" if diff_pct > 0.005 else "low")

        if score >= 0.60:
            signal = "BUY"
        elif score <= 0.40:
            signal = "SELL"
        else:
            signal = "HOLD"

        # ── Synthetic prob stubs so fusion layer has consistent keys ──────
        if signal == "BUY":
            p_sell, p_hold, p_buy = 0.1, 1.0 - score, score
        elif signal == "SELL":
            p_sell, p_hold, p_buy = 1.0 - score, score, 0.1
        else:
            p_sell, p_hold, p_buy = 0.25, 0.5, 0.25

        logger.info(
            "MA+RSI fallback — score=%.4f signal=%s rsi=%.1f ma20=%.2f ma50=%.2f",
            score, signal, rsi, ma20, ma50,
        )
        return {
            "technical_score": score,
            "signal":          signal,
            "confidence":      confidence,
            "p_sell":          p_sell,
            "p_hold":          p_hold,
            "p_buy":           p_buy,
        }

    except Exception as exc:
        logger.exception("MA crossover fallback failed: %s", exc)
        return {
            "technical_score": 0.5, "signal": "HOLD", "confidence": "low",
            "p_sell": 0.25, "p_hold": 0.5, "p_buy": 0.25,
        }


# ──────────────────────────────────────────────
# Sentiment model
# ──────────────────────────────────────────────

def _load_sentiment_model():
    global _SENTIMENT_MODEL, _SENTIMENT_TOKENIZER
    if _SENTIMENT_MODEL is not None and _SENTIMENT_TOKENIZER is not None:
        return _SENTIMENT_TOKENIZER, _SENTIMENT_MODEL

    try:
        transformers = importlib.import_module("transformers")
        torch        = importlib.import_module("torch")
    except Exception as exc:
        logger.warning("Sentiment model dependencies unavailable: %s", exc)
        return None, None

    try:
        _SENTIMENT_TOKENIZER = transformers.AutoTokenizer.from_pretrained(SENTIMENT_MODEL_REPO)
        _SENTIMENT_MODEL = transformers.AutoModelForSequenceClassification.from_pretrained(SENTIMENT_MODEL_REPO)
        _SENTIMENT_MODEL.eval()
        _SENTIMENT_MODEL.to(torch.device("cpu"))
        logger.info("Loaded sentiment model from Hugging Face repo %s", SENTIMENT_MODEL_REPO)
        return _SENTIMENT_TOKENIZER, _SENTIMENT_MODEL
    except Exception as exc:
        logger.warning("Failed to load sentiment model from Hugging Face: %s", exc)
        _SENTIMENT_MODEL = _SENTIMENT_TOKENIZER = None
        return None, None


def _fallback_sentiment_score(text: str) -> float:
    lower = text.lower()
    pos = sum(w in lower for w in [
        "beat", "bull", "buy", "growth", "gain", "up", "profit", "strong", "surge",
        "record", "outperform", "upgrade", "positive", "rally", "boost",
    ])
    neg = sum(w in lower for w in [
        "bear", "sell", "loss", "down", "risk", "drop", "weak", "concern", "miss",
        "decline", "downgrade", "negative", "fall", "cut", "warning",
    ])
    return float(np.clip(0.5 + 0.08 * (pos - neg), 0.0, 1.0))


def _score_sentiment_texts(texts: List[str]) -> List[float]:
    texts = [t.strip() for t in map(str, texts) if t.strip()]
    if not texts:
        return []

    tokenizer, model = _load_sentiment_model()
    if tokenizer is None or model is None:
        return [_fallback_sentiment_score(t) for t in texts]

    torch  = importlib.import_module("torch")
    scores: List[float] = []

    try:
        inputs = tokenizer(
            texts, return_tensors="pt", truncation=True, max_length=128, padding=True
        )
        with torch.no_grad():
            logits = model(**inputs).logits
            probs  = torch.softmax(logits, dim=-1).cpu().numpy()
            scores = (probs[:, 2] * 1.0 + probs[:, 1] * 0.5 + probs[:, 0] * 0.0).tolist()
    except Exception as exc:
        logger.warning("Batch sentiment scoring failed, falling back item-by-item: %s", exc)
        for text in texts:
            try:
                inp = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
                with torch.no_grad():
                    logits = model(**inp).logits[0]
                    p      = torch.softmax(logits, dim=0).cpu().numpy()
                    scores.append(float(p[2] * 1.0 + p[1] * 0.5 + p[0] * 0.0))
            except Exception:
                scores.append(_fallback_sentiment_score(text))

    return scores


# ──────────────────────────────────────────────
# Sentiment cache
# ──────────────────────────────────────────────

def _get_cached_sentiment(ticker: str) -> Optional[Dict[str, Any]]:
    entry = _SENTIMENT_CACHE.get(ticker)
    if not entry:
        return None
    ts = entry.get("timestamp")
    if not isinstance(ts, datetime):
        return None
    if datetime.now(timezone.utc) - ts > timedelta(hours=_SENTIMENT_CACHE_TTL_HOURS):
        return None
    return entry


def _store_sentiment_cache(ticker: str, sentiment_score: float,
                            num_articles: int, news_volume_score: float) -> None:
    _SENTIMENT_CACHE[ticker] = {
        "sentiment_score":   float(sentiment_score),
        "num_articles":      int(num_articles),
        "news_volume_score": float(news_volume_score),
        "timestamp":         datetime.now(timezone.utc),
    }


def _compute_news_volume_score(num_articles: int) -> float:
    return float(np.clip(num_articles / 20.0, 0.0, 1.0)) if num_articles > 0 else 0.0


# ──────────────────────────────────────────────
# Individual analysis steps
# ──────────────────────────────────────────────

def get_technical_result(ticker: str) -> dict:
    """
    Fetch price data and run the GRU technical model.
    Falls back to MA+RSI scoring when the model is unavailable (fix #1).
    """
    cleaned = _clean_ticker(ticker)
    logger.info("Technical analysis: %s", cleaned)

    price_df = _get_price_data(cleaned)
    if price_df.empty:
        logger.warning("No price data for technical analysis: %s", cleaned)
        return {
            "technical_score": 0.5, "signal": "HOLD", "confidence": "low",
            "p_sell": 0.25, "p_hold": 0.5, "p_buy": 0.25,
        }

    # ── Try GRU model ────────────────────────────────────────────────────
    stock_mod = _load_module("backend.preprocessing.stock_feature_scraper")
    if stock_mod and hasattr(stock_mod, "run_technical_model"):
        try:
            model_result = stock_mod.run_technical_model(price_df)
            # Fix #1: run_technical_model returns None on any failure —
            # must check explicitly before using the result.
            if isinstance(model_result, dict) and _is_valid_number(
                model_result.get("technical_score")
            ):
                logger.info("GRU model completed for %s: score=%.4f signal=%s",
                            cleaned,
                            model_result["technical_score"],
                            model_result.get("signal", "?"))
                return model_result
            else:
                logger.warning(
                    "GRU model returned invalid result for %s (%s) — using fallback",
                    cleaned, model_result,
                )
        except Exception as exc:
            logger.exception("Technical model raised for %s: %s", cleaned, exc)

    # ── MA+RSI fallback (fix #2) ─────────────────────────────────────────
    logger.info("Using MA+RSI fallback for %s", cleaned)
    return _ma_crossover_score(price_df)


def get_sentiment_result(ticker: str) -> dict:
    cleaned = _clean_ticker(ticker)
    logger.info("Sentiment analysis: %s", cleaned)

    cached   = _get_cached_sentiment(cleaned)
    news_mod = _load_module("backend.scraper.news_scraper")

    if news_mod is None or not hasattr(news_mod, "get_news"):
        logger.warning("News scraper unavailable for %s", cleaned)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    try:
        news_items = news_mod.get_news(cleaned) or []
    except Exception as exc:
        logger.exception("News fetch failed for %s: %s", cleaned, exc)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    texts = [
        str(item.get("text", "")).strip()
        for item in news_items
        if isinstance(item, dict) and str(item.get("text", "")).strip()
    ]

    def _cached_fallback(label: str) -> dict:
        if cached:
            logger.info("%s for %s; reusing cached sentiment", label, cleaned)
            return {
                "sentiment_score":   float(cached["sentiment_score"]),
                "num_articles":      int(cached["num_articles"]),
                "news_volume_score": float(cached.get("news_volume_score", 0.0)),
                "used_cache":        True,
            }
        logger.info("%s for %s; using neutral fallback", label, cleaned)
        return {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0, "used_cache": False}

    if not texts:
        return _cached_fallback("No sentiment texts")

    scores = _score_sentiment_texts(texts)
    if not scores:
        return _cached_fallback("Empty sentiment scores")

    base_score      = float(np.mean(scores))
    volume_score    = _compute_news_volume_score(len(texts))
    sentiment_score = float(np.clip(0.75 * base_score + 0.25 * volume_score, 0.0, 1.0))

    _store_sentiment_cache(cleaned, sentiment_score, len(texts), volume_score)
    logger.info("Sentiment completed for %s: %.4f (%d articles)", cleaned, sentiment_score, len(texts))

    return {
        "sentiment_score":   sentiment_score,
        "num_articles":      len(texts),
        "news_volume_score": volume_score,
        "used_cache":        False,
    }


def get_fundamental_result(ticker: str) -> dict:
    cleaned = _clean_ticker(ticker)
    logger.info("Fundamental analysis: %s", cleaned)

    fin_mod  = _load_module("backend.scraper.fundamental_financial_scraper")
    fund_mod = _load_module("backend.aggregation.fundamentalFunctions.fundamental_models")

    financial_data: Dict[str, Any] = {}
    if fin_mod and hasattr(fin_mod, "get_financial_data"):
        try:
            financial_data = fin_mod.get_financial_data(cleaned)
        except Exception as exc:
            logger.exception("Financial data fetch failed for %s: %s", cleaned, exc)

    if fund_mod is None or not hasattr(fund_mod, "run_full_fundamental_pipeline"):
        logger.warning("Fundamental pipeline unavailable for %s", cleaned)
        return {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}}

    price_df = _get_price_data(cleaned)
    returns  = (
        price_df["Close"].pct_change().dropna().to_numpy(dtype=np.float64)
        if not price_df.empty and "Close" in price_df.columns
        else np.array([], dtype=np.float64)
    )

    try:
        pipeline_result = fund_mod.run_full_fundamental_pipeline(financial_data, returns)
    except Exception as exc:
        logger.exception("Fundamental pipeline failed for %s: %s", cleaned, exc)
        return {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}}

    fundamental_score = _safe_float(
        pipeline_result.get("fundamental", {}).get("fundamental_score", 0.0)
    )
    risk_score = _safe_float(
        pipeline_result.get("risk", {}).get("risk_score", 0.0)
    )

    logger.info("Fundamental completed: %s score=%.4f", cleaned, fundamental_score)
    return {
        "fundamental_score": fundamental_score,
        "risk_score":        risk_score,
        "details":           _to_builtin(pipeline_result),
    }


# ──────────────────────────────────────────────
# Fusion  (fixes #3, #6, #7)
# ──────────────────────────────────────────────

def _prediction_bias(prediction: Optional[dict]) -> float:
    if not isinstance(prediction, dict):
        return 0.5
    forecast = prediction.get("forecast_close") or prediction.get("sequence") or []
    if len(forecast) >= 2:
        forecast_return = (float(forecast[-1]) - float(forecast[0])) / (abs(float(forecast[0])) + 1e-9)
    else:
        forecast_return = 0.0
    return float(np.clip(0.5 + forecast_return * 2.5, 0.0, 1.0))


def _pattern_bias(pattern: Optional[dict]) -> float:
    if not isinstance(pattern, dict):
        return 0.5
    confidence = float(np.clip(_safe_float(pattern.get("confidence"), 0.0), 0.0, 1.0))
    trend = str(pattern.get("trend", "neutral")).lower()
    if trend == "bullish":
        bias = 0.75 + 0.25 * confidence
    elif trend == "bearish":
        bias = 0.25 - 0.25 * confidence
    else:
        bias = 0.5
    return float(np.clip(bias, 0.0, 1.0))


def fuse_and_decide(
    tech: dict,
    fund: dict,
    senti: dict,
    risk: dict,
    pattern: Optional[dict] = None,
    prediction: Optional[dict] = None,
) -> Tuple[float, str]:
    """
    Fuse ML probabilities, sentiment, fundamentals, and risk into one decision.

    ── How the ML signal enters the fusion ─────────────────────────────────────
    The GRU is a Triple Barrier classifier. Its softmax head produces three
    numbers that mean something specific:
        p_buy  = P(price hits profit target first)
        p_sell = P(price hits stop-loss first)
        p_hold = P(neither barrier is hit in time → sideways/choppy)

    Previous versions collapsed these into a single technical_score scalar and
    then used that scalar in the weighted sum.  That loses information: a model
    that is 80% confident on SELL and a model that is 80% confident on HOLD
    both produce a technical_score near 0.5 with the old formula.

    Correct design — two roles, one prob each:
      • DIRECTION  → p_buy and p_sell enter the weighted sum directly as the
                     tech component, expressed as net bull pressure mapped to
                     [0, 1]:  ml_direction = (p_buy - p_sell + 1) / 2
                     This is what drives BUY vs SELL in the final score.
      • CONVICTION → p_hold gates the entire fused score as a multiplier.
                     High p_hold (model sees sideways market) shrinks the whole
                     score toward 0.5, pulling the decision toward HOLD
                     regardless of what sentiment or fundamentals say.
                     Formula: gate = 0.5 + 0.5 * (1 - p_hold)
                       p_hold=0.00 → gate=1.00  (model fully decisive)
                       p_hold=0.50 → gate=0.75  (moderate uncertainty)
                       p_hold=0.90 → gate=0.55  (model almost sure: sideways)

    When the GRU is unavailable (MA/RSI fallback), synthetic prob stubs are
    already injected by _ma_crossover_score(), so this path is always safe.

    ── Adaptive weights ─────────────────────────────────────────────────────────
    Fundamentals are often unavailable (scraper returns 0.0).  When they are,
    their weight is redistributed to ml_direction + sentiment so the decision
    is still meaningful.

    ── Thresholds ───────────────────────────────────────────────────────────────
    After the conviction gate, scores are centred around 0.5 and compressed
    toward it when p_hold is high.  Thresholds are calibrated to that range:
      BUY  ≥ 0.62
      HOLD ≥ 0.42
      SELL  < 0.42
    """
    # ── 1. Read all raw inputs ────────────────────────────────────────────────
    fund_score  = _safe_float(fund.get("fundamental_score"), 0.0)
    senti_score = _safe_float(senti.get("sentiment_score"),  0.5)
    risk_score  = _safe_float(risk.get("risk_score"),        0.0)
    pred_score  = _prediction_bias(prediction)
    patt_score  = _pattern_bias(pattern)

    # Read the three Triple Barrier probabilities directly from the tech dict.
    # _safe_float with default=None used for p_hold so we can distinguish
    # "GRU ran and returned 0.0" from "key missing entirely".
    p_buy_raw  = tech.get("p_buy")
    p_sell_raw = tech.get("p_sell")
    p_hold_raw = tech.get("p_hold")

    have_ml_probs = (
        p_buy_raw  is not None and _is_valid_number(p_buy_raw)  and
        p_sell_raw is not None and _is_valid_number(p_sell_raw) and
        p_hold_raw is not None and _is_valid_number(p_hold_raw)
    )

    if have_ml_probs:
        p_buy  = float(p_buy_raw)
        p_sell = float(p_sell_raw)
        p_hold = float(p_hold_raw)

        # DIRECTION: net bull pressure mapped from [-1,+1] → [0,1].
        # This is the tech component that enters the weighted sum.
        # p_buy=0.85, p_sell=0.05 → ml_direction=0.90  (strongly bullish)
        # p_buy=0.05, p_sell=0.80 → ml_direction=0.125 (strongly bearish)
        # p_buy=0.45, p_sell=0.45 → ml_direction=0.50  (genuinely uncertain)
        ml_direction = float(np.clip((p_buy - p_sell + 1.0) / 2.0, 0.0, 1.0))

        # CONVICTION GATE: p_hold shrinks the whole fused score toward 0.5.
        # Floor of 0.5 ensures we never zero-out a clear directional signal.
        conviction_gate = 0.5 + 0.5 * (1.0 - p_hold)   # [0.5, 1.0]

        logger.debug(
            "ML probs: p_buy=%.3f p_sell=%.3f p_hold=%.3f "
            "→ ml_direction=%.3f conviction_gate=%.3f",
            p_buy, p_sell, p_hold, ml_direction, conviction_gate,
        )
    else:
        # No ML probs: fall back to the scalar technical_score, no gate.
        tech_score_fallback = _safe_float(tech.get("technical_score"), 0.5)
        ml_direction        = tech_score_fallback
        conviction_gate     = 1.0
        p_hold              = None
        logger.debug("No ML probs in tech dict — using technical_score=%.3f", ml_direction)

    # ── 2. Sentiment amplification ────────────────────────────────────────────
    # Push already-extreme sentiment scores further so they have real influence.
    if senti_score > 0.7:
        senti_score = min(1.0, senti_score + 0.1)
    elif senti_score < 0.3:
        senti_score = max(0.0, senti_score - 0.1)

    risk_penalty = 1.0 - risk_score

    # ── 3. Adaptive weights ───────────────────────────────────────────────────
    # ml_direction is the technical component. Prediction and pattern biases
    # are now part of the fused score rather than only being returned.
    fundamentals_available = fund_score > 0.01
    if fundamentals_available:
        w_ml, w_pred, w_patt, w_fund, w_senti, w_risk = 0.25, 0.15, 0.10, 0.30, 0.15, 0.05
    else:
        w_ml, w_pred, w_patt, w_fund, w_senti, w_risk = 0.40, 0.20, 0.15, 0.00, 0.20, 0.05

    raw_score = (
        w_ml    * ml_direction +
        w_pred  * pred_score   +
        w_patt  * patt_score   +
        w_fund  * fund_score   +
        w_senti * senti_score  +
        w_risk  * risk_penalty
    )

    # ── 4. Apply conviction gate ──────────────────────────────────────────────
    # Multiply the raw score by the gate, then re-centre around 0.5.
    # When gate=1.0 (decisive model) → final_score = raw_score unchanged.
    # When gate=0.5 (full uncertainty) → final_score pulled halfway to 0.5.
    # Re-centring formula: 0.5 + (raw_score - 0.5) * gate
    #   raw=0.80, gate=0.55 → 0.5 + 0.30*0.55 = 0.665  (still BUY, muted)
    #   raw=0.80, gate=1.00 → 0.5 + 0.30*1.00 = 0.800  (full BUY)
    #   raw=0.20, gate=0.55 → 0.5 - 0.30*0.55 = 0.335  (still SELL, muted)
    final_score = float(np.clip(0.5 + (raw_score - 0.5) * conviction_gate, 0.0, 1.0))

    # ── 5. Threshold decision ─────────────────────────────────────────────────
    if final_score >= 0.62:
        decision = "BUY"
    elif final_score >= 0.42:
        decision = "HOLD"
    else:
        decision = "SELL"

    # Hard news override: extreme sentiment overrides a borderline score.
    if senti_score < 0.25:
        decision = "SELL (Negative News Impact)"
    elif senti_score > 0.85:
        decision = "BUY (Positive News Momentum)"

    logger.info(
        "Fusion: ml_dir=%.3f pred=%.3f patt=%.3f fund=%.3f senti=%.3f risk=%.3f "
        "p_hold=%s gate=%.3f raw=%.4f → final=%.4f  →  %s",
        ml_direction, pred_score, patt_score, fund_score, senti_score, risk_score,
        f"{p_hold:.3f}" if p_hold is not None else "N/A",
        conviction_gate, raw_score, final_score, decision,
    )
    return final_score, decision


# ──────────────────────────────────────────────
# Complete pipeline (parallel)
# ──────────────────────────────────────────────

def _extract_risk(fundamental: dict) -> dict:
    details    = fundamental.get("details", {})
    risk_block = details.get("risk", {}) if isinstance(details, dict) else {}
    risk_score = _safe_float(
        risk_block.get("risk_score") if isinstance(risk_block, dict) else None,
        _safe_float(fundamental.get("risk_score", 0.0)),
    )
    return {"risk_score": risk_score, "details": risk_block}


def run_complete_pipeline(ticker: str) -> dict:
    """Run the full analysis pipeline for a ticker, with parallel I/O steps."""
    cleaned = _clean_ticker(ticker)
    logger.info("Pipeline start: %s", cleaned)

    # Pre-fetch price data once so all sub-steps hit the in-process cache
    _get_price_data(cleaned)

    defaults = {
        "technical":   {
            "technical_score": 0.5, "signal": "HOLD", "confidence": "low",
            "p_sell": 0.25, "p_hold": 0.5, "p_buy": 0.25,
        },
        "sentiment":   {"sentiment_score": 0.5, "num_articles": 0, "news_volume_score": 0.0},
        "fundamental": {"fundamental_score": 0.0, "risk_score": 0.0, "details": {}},
    }

    steps = {
        "technical":   lambda: get_technical_result(cleaned),
        "sentiment":   lambda: get_sentiment_result(cleaned),
        "fundamental": lambda: get_fundamental_result(cleaned),
    }

    results: Dict[str, dict] = dict(defaults)

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fn): key for key, fn in steps.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                step_result = future.result()
                # Validate: only accept if it's a non-empty dict
                if isinstance(step_result, dict) and step_result:
                    results[key] = step_result
                else:
                    logger.warning("Step '%s' returned invalid result: %s", key, step_result)
            except Exception as exc:
                logger.exception("Step '%s' failed for %s: %s", key, cleaned, exc)

    technical   = results["technical"]
    sentiment   = results["sentiment"]
    fundamental = results["fundamental"]
    risk        = _extract_risk(fundamental)

    # Attempt to fetch pattern and prediction summaries in parallel; failures are non-fatal.
    pattern = None
    prediction = None
    try:
        with ThreadPoolExecutor(max_workers=2) as exec:
            fut_p = exec.submit(lambda: __import__("backend.services.pattern_service", fromlist=["get_pattern_analysis"]).get_pattern_analysis(cleaned))
            fut_f = exec.submit(lambda: __import__("backend.services.prediction_service", fromlist=["get_prediction"]).get_prediction(cleaned, "2y", 5))
            try:
                pattern = fut_p.result(timeout=8)
            except Exception:
                pattern = None
            try:
                prediction = fut_f.result(timeout=8)
            except Exception:
                prediction = None
    except Exception:
        pattern = None
        prediction = None

    try:
        final_score, decision = fuse_and_decide(technical, fundamental, sentiment, risk, pattern, prediction)
    except Exception as exc:
        logger.exception("Fusion failed for %s: %s", cleaned, exc)
        final_score, decision = 0.5, "HOLD"

    logger.info("Pipeline done: %s → %s (%.4f)", cleaned, decision, final_score)

    return _to_builtin({
        "ticker":      cleaned,
        "technical":   technical,
        "sentiment":   sentiment,
        "fundamental": fundamental,
        "risk":        risk,
        "pattern":     pattern,
        "prediction":  prediction,
        "final_score": float(final_score),
        "decision":    decision,
    })


__all__ = [
    "get_technical_result",
    "get_sentiment_result",
    "get_fundamental_result",
    "fuse_and_decide",
    "run_complete_pipeline",
    "_get_price_data",   # exported for main.py compatibility
]