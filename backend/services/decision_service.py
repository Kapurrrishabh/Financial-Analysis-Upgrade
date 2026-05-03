from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

from backend.orchestration.complete_pipeline import (
    get_sentiment_result,
    get_fundamental_result,
    get_technical_result,
)
from backend.services.pattern_service import get_pattern_analysis
from backend.services.prediction_service import get_prediction
from backend.utils.preprocessing import clean_symbol, to_builtin


def _norm_score(v: Optional[float]) -> float:
    """Normalize a score to [0,1]. Accepts either 0-1 or 0-100 inputs."""
    try:
        if v is None:
            return 0.0
        f = float(v)
        if f > 1.0:
            f = f / 100.0
        return float(np.clip(f, 0.0, 1.0))
    except Exception:
        return 0.0


def _pattern_direction_and_confidence(pattern: Optional[Dict[str, Any]]) -> tuple[float, float]:
    if not isinstance(pattern, dict):
        return 0.5, 0.0
    conf = _norm_score(pattern.get("confidence", 0.0))
    trend = str(pattern.get("trend", "neutral")).lower()
    if trend == "bullish":
        dirv = 0.5 + 0.5 * conf
    elif trend == "bearish":
        dirv = 0.5 - 0.5 * conf
    else:
        dirv = 0.5
    return float(dirv), float(conf)


def _fetch_price_volatility_and_drawdown(symbol: str, lookback_days: int = 90) -> Tuple[Optional[float], Optional[float], Optional[int]]:
    try:
        df = yf.download(symbol, period=f"{max(30, lookback_days)}d", progress=False)
        if df is None or df.empty or "Close" not in df.columns:
            return None, None, None
        close = df["Close"].astype(float).to_numpy()
        if len(close) < 5:
            return None, None, None
        # daily absolute returns
        daily_ret = np.abs(np.diff(close) / (close[:-1] + 1e-9))
        vol = float(np.nanstd(daily_ret))
        # drawdown (max peak to trough) over lookback
        peak = close[0]
        max_dd = 0.0
        for p in close:
            if p > peak:
                peak = p
            dd = (peak - p) / (peak + 1e-9)
            if dd > max_dd:
                max_dd = dd
        return vol, float(max_dd), len(close)
    except Exception:
        return None, None, None


def _confidence_from_signals(
    weighted_score: float,
    components: Dict[str, float],
    weights: Dict[str, float],
    volatility_factor: float,
) -> tuple[float, Dict[str, float]]:
    component_values = np.array([float(v) for v in components.values()], dtype=float)
    component_std = float(np.std(component_values)) if component_values.size else 0.0
    alignment_score = float(1.0 - min(1.0, component_std * 2.0))
    decision_strength = float(np.clip(abs(weighted_score - 0.5) * 2.0, 0.0, 1.0))

    support_weight = 0.0
    if weighted_score >= 0.5:
        for name, value in components.items():
            if float(value) >= 0.5:
                support_weight += float(weights.get(name, 0.0))
    else:
        for name, value in components.items():
            if float(value) < 0.5:
                support_weight += float(weights.get(name, 0.0))

    weighted_signal = (
        0.55 * decision_strength
        + 0.25 * alignment_score
        + 0.20 * float(np.clip(support_weight, 0.0, 1.0))
    )

    raw_confidence = 0.20 + 0.65 * float(np.clip(weighted_signal, 0.0, 1.0))
    volatility_dampening = 1.0 - float(np.clip(volatility_factor, 0.0, 1.0)) * 0.35
    confidence = float(np.clip(raw_confidence * volatility_dampening, 0.20, 0.85))

    debug = {
        "decision_strength": round(decision_strength, 4),
        "component_std": round(component_std, 4),
        "alignment_score": round(alignment_score, 4),
        "support_weight": round(float(np.clip(support_weight, 0.0, 1.0)), 4),
        "weighted_signal": round(float(np.clip(weighted_signal, 0.0, 1.0)), 4),
        "raw_confidence": round(raw_confidence, 4),
        "volatility_dampening": round(volatility_dampening, 4),
        "volatility_factor": round(float(np.clip(volatility_factor, 0.0, 1.0)), 4),
    }
    return confidence, debug


def _compute_short_term(symbol: str, tech: Dict[str, Any], pattern: Dict[str, Any], senti: Dict[str, Any], fund: Dict[str, Any], prediction: Dict[str, Any]) -> Dict[str, Any]:
    # Inputs normalized
    senti_score = _norm_score(senti.get("sentiment_score", 0.5))
    fund_score = _norm_score(fund.get("fundamental_score", 0.0))

    # Technical: attempt ML probabilities first
    p_buy = tech.get("p_buy")
    p_sell = tech.get("p_sell")
    p_hold = tech.get("p_hold")
    have_ml = p_buy is not None and p_sell is not None
    if have_ml:
        try:
            p_buy_f = float(p_buy)
            p_sell_f = float(p_sell)
            ml_dir = float(np.clip((p_buy_f - p_sell_f + 1.0) / 2.0, 0.0, 1.0))
        except Exception:
            ml_dir = _norm_score(tech.get("technical_score", 0.5))
    else:
        ml_dir = _norm_score(tech.get("technical_score", 0.5))

    # Pattern direction and confidence
    patt_dir, patt_conf = _pattern_direction_and_confidence(pattern)

    # Volatility and drawdown (for confidence calibration and risk)
    vol, max_dd, price_points = _fetch_price_volatility_and_drawdown(symbol, lookback_days=90)
    # volatility factor normalized (map daily vol ~0.03 -> 1.0)
    volatility_factor = float(np.clip((vol or 0.0) / 0.03, 0.0, 1.0))

    # Base weights
    base_w = {"technical": 0.5, "pattern": 0.25, "sentiment": 0.15, "fundamental": 0.10}

    # Reliability scores
    tech_reliability = 0.5 + min(0.5, abs((tech.get("p_buy") or 0.0) - (tech.get("p_sell") or 0.0)))
    patt_reliability = patt_conf
    senti_reliability = float(np.clip((senti.get("num_articles", 0) / max(1, (senti.get("num_articles", 0) + 10))) + (senti.get("news_volume_score", 0.0) * 0.2), 0.0, 1.0))
    fund_reliability = 0.0
    try:
        # data completeness: count non-null fundamentals
        keys = ["market_cap", "pe_ratio", "eps", "debt_equity"]
        present = sum(1 for k in keys if fund.get(k) not in (None, 0, "", 0.0))
        fund_reliability = present / len(keys)
    except Exception:
        fund_reliability = 0.0

    # Pattern reliability impact
    if patt_conf < 0.6:
        patt_reliability *= 0.5

    # Penalize pattern if it contradicts technical trend
    if (patt_dir > 0.55 and ml_dir < 0.45) or (patt_dir < 0.45 and ml_dir > 0.55):
        patt_reliability *= 0.7

    # Effective weights = base * reliability
    w = {
        "technical": base_w["technical"] * tech_reliability,
        "pattern": base_w["pattern"] * patt_reliability,
        "sentiment": base_w["sentiment"] * senti_reliability,
        "fundamental": base_w["fundamental"] * fund_reliability,
    }

    forced_action: Optional[str] = None
    technical_override_reason: Optional[str] = None

    # Adjustments
    # Strong trend boosts technical weight
    if abs(ml_dir - 0.5) > 0.15:
        w["technical"] += 0.12
    # High pattern confidence
    if patt_conf > 0.7:
        w["pattern"] += 0.08
    # Sentiment spike
    if senti_score > 0.8 or senti_score < 0.2:
        w["sentiment"] += 0.07

    # Re-normalize weights to sum to 1 (fallback to base if zero)
    total = sum(w.values())
    if total <= 0:
        w = base_w.copy()
        total = sum(w.values())
    for k in w:
        w[k] = w[k] / total

    # Overrides
    # Technical extremes still influence the decision label, but confidence
    # must continue through the shared weighted path so it can vary by stock.
    if ml_dir < 0.35:
        forced_action = "SELL"
        technical_override_reason = "Strong short-term downtrend (technical)"
    if ml_dir > 0.65:
        forced_action = "BUY"
        technical_override_reason = "Strong short-term uptrend (technical)"

    # Weighted composite (directional components in [0,1])
    components = {
        "technical": ml_dir,
        "pattern": patt_dir,
        "sentiment": senti_score,
        "fundamental": fund_score,
    }

    composite = sum(w[k] * components[k] for k in w)

    if composite >= 0.62:
        action = "BUY"
    elif composite <= 0.38:
        action = "SELL"
    else:
        action = "HOLD"

    if forced_action is not None:
        action = forced_action

    calibrated_conf, debug_info = _confidence_from_signals(composite, components, w, volatility_factor)
    
    reason_parts = []
    if technical_override_reason:
        reason_parts.append(technical_override_reason)
    if patt_conf > 0.5:
        reason_parts.append(f"pattern:{pattern.get('pattern','?')}({patt_conf:.2f})")
    reason_parts.append(f"technical={ml_dir:.2f}")
    reason_parts.append(f"sentiment={senti_score:.2f}")
    if debug_info["component_std"] < 0.1:
        reason_parts.append("signals aligned")
    if debug_info["component_std"] > 0.25:
        reason_parts.append("signals mixed")

    # Risk scoring
    trend_strength = abs(ml_dir - 0.5) * 2.0
    vol_score = volatility_factor
    drawdown_score = float(np.clip((max_dd or 0.0), 0.0, 1.0))
    risk_raw = vol_score * 0.5 + trend_strength * 0.3 + drawdown_score * 0.2
    risk_norm = float(np.clip(risk_raw, 0.0, 1.0))
    if risk_norm < 0.33:
        risk_label = "LOW"
    elif risk_norm < 0.66:
        risk_label = "MEDIUM"
    else:
        risk_label = "HIGH"

    # If consensus weak, prefer HOLD low confidence
    if max(components.values()) < 0.55 and min(components.values()) > 0.45:
        return {
            "decision": "HOLD",
            "confidence": round(0.30 * 100.0, 2),
            "weights": {k: round(float(w[k]), 4) for k in w},
            "reason": "Conflicting or weak signals",
            "components": {k: round(float(components[k]), 4) for k in components},
            "risk": risk_label,
            "horizon": "1-7 days",
            "action": "avoid entry",
            "_debug": {
                "component_std": debug_info["component_std"],
                "alignment": debug_info["alignment_score"],
                "volatility_factor": round(float(volatility_factor), 4),
            },
        }

    # Sentiment negative reduces buy confidence
    if action == "BUY" and senti_score < 0.25:
        calibrated_conf *= 0.85
    
    # Sentiment positive boosts buy confidence slightly
    if action == "BUY" and senti_score > 0.75:
        calibrated_conf = min(0.80, calibrated_conf * 1.05)

    return {
        "decision": action,
        "confidence": round(calibrated_conf * 100.0, 2),
        "weights": {k: round(float(w[k]), 4) for k in w},
        "reason": ", ".join(reason_parts),
        "components": {k: round(float(components[k]), 4) for k in components},
        "risk": risk_label,
        "horizon": "1-7 days",
        "action": "exit / avoid entry" if action == "SELL" else ("accumulate on dips" if action == "HOLD" else "enter with stop"),
        "debug": debug_info,
    }


def _compute_long_term(fund: Dict[str, Any], pattern: Dict[str, Any], senti: Dict[str, Any], tech: Dict[str, Any], volatility_factor: float = 0.0) -> Dict[str, Any]:
    fund_score = _norm_score(fund.get("fundamental_score", 0.0))
    senti_score = _norm_score(senti.get("sentiment_score", 0.5))
    tech_score = _norm_score(tech.get("technical_score", 0.5))
    patt_dir, patt_conf = _pattern_direction_and_confidence(pattern)

    # Base weights (fund-heavy for long-term)
    base_w = {"fundamental": 0.5, "sentiment": 0.2, "technical": 0.2, "pattern": 0.1}
    w = base_w.copy()

    # Reliability adjustments
    fund_reliability = 0.0
    try:
        keys = ["market_cap", "pe_ratio", "eps", "debt_equity"]
        present = sum(1 for k in keys if fund.get(k) not in (None, 0, "", 0.0))
        fund_reliability = present / len(keys)
    except Exception:
        fund_reliability = 0.0

    tech_reliability = 0.5 + min(0.5, abs((tech.get("p_buy") or 0.0) - (tech.get("p_sell") or 0.0)))
    senti_reliability = float(np.clip((senti.get("num_articles", 0) / max(1, senti.get("num_articles", 0) + 10)) + (senti.get("news_volume_score", 0.0) * 0.2), 0.0, 1.0))
    patt_reliability = patt_conf

    # Apply reliability multipliers
    w["fundamental"] *= fund_reliability
    w["technical"] *= tech_reliability
    w["sentiment"] *= senti_reliability
    w["pattern"] *= patt_reliability

    # Adjust weights dynamically based on signal strength
    if fund_score > 0.8:
        w["fundamental"] += base_w["fundamental"] * 0.3
    if fund_score < 0.2:
        w["sentiment"] += base_w["sentiment"] * 0.2
        w["technical"] += base_w["technical"] * 0.2
    if patt_conf > 0.7:
        w["pattern"] += base_w["pattern"] * 0.4

    # Normalize
    total = sum(w.values())
    if total <= 0:
        w = base_w.copy()
        total = sum(w.values())
    for k in w:
        w[k] = w[k] / total

    # Compute weighted composite
    components = {
        "fundamental": fund_score,
        "sentiment": senti_score,
        "technical": tech_score,
        "pattern": patt_dir,
    }
    composite = sum(w[k] * components[k] for k in w)

    # Decision thresholds
    if composite >= 0.62:
        action = "BUY"
    elif composite <= 0.38:
        action = "SELL"
    else:
        action = "HOLD"

    calibrated_conf, debug_info = _confidence_from_signals(composite, components, w, volatility_factor)

    # Risk scoring for long-term
    # Based on fundamentals strength, sentiment stability, pattern trend
    fund_risk = 1.0 - fund_score  # weak fundamentals = high risk
    senti_volatility = abs(senti_score - 0.5) * 0.3  # sentiment extremes = higher risk
    trend_stability = 1.0 - patt_conf * 0.5  # weak pattern confidence = less stability
    risk_raw = fund_risk * 0.5 + senti_volatility * 0.3 + trend_stability * 0.2
    risk_norm = float(np.clip(risk_raw, 0.0, 1.0))
    if risk_norm < 0.33:
        risk_label = "LOW"
    elif risk_norm < 0.66:
        risk_label = "MEDIUM"
    else:
        risk_label = "HIGH"

    reason_parts = []
    if fund_score > 0.7:
        reason_parts.append("strong fundamentals")
    elif fund_score < 0.3:
        reason_parts.append("weak fundamentals")
    if patt_conf > 0.5:
        reason_parts.append(f"{pattern.get('trend', 'neutral').lower()} pattern")
    if senti_score > 0.7:
        reason_parts.append("positive sentiment")
    elif senti_score < 0.3:
        reason_parts.append("negative sentiment")
    reason = ", ".join(reason_parts) if reason_parts else "mixed signals"

    # Action suggestion
    if action == "BUY":
        action_str = "accumulate on dips" if risk_label == "HIGH" else "buy strength"
    elif action == "SELL":
        action_str = "exit positions"
    else:
        action_str = "wait for confirmation"

    return {
        "decision": action,
        "confidence": round(calibrated_conf * 100.0, 2),
        "weights": {k: round(float(w[k]), 4) for k in w},
        "reason": reason,
        "components": {k: round(float(components[k]), 4) for k in components},
        "risk": risk_label,
        "horizon": "3-12 months",
        "action": action_str,
        "debug": debug_info,
    }


@lru_cache(maxsize=256)
def _cached_decision(symbol: str, period: str, horizon: int) -> Dict[str, Any]:
    # Fetch all inputs (non-fatal failures handled inside each function)
    prediction = get_prediction(symbol, period=period, horizon=horizon)
    pattern = get_pattern_analysis(symbol, period=period)
    sentiment = get_sentiment_result(symbol)
    technical = get_technical_result(symbol)
    fundamental = get_fundamental_result(symbol)
    vol, _, _ = _fetch_price_volatility_and_drawdown(symbol, lookback_days=90)
    volatility_factor = float(np.clip((vol or 0.0) / 0.03, 0.0, 1.0))

    short = _compute_short_term(symbol, technical or {}, pattern or {}, sentiment or {}, fundamental or {}, prediction or {})
    long = _compute_long_term(fundamental or {}, pattern or {}, sentiment or {}, technical or {}, volatility_factor=volatility_factor)

    # Compose overall numeric score from short & long using confidence as weights
    def _map_decision_to_num(d: str) -> float:
        if not isinstance(d, str):
            return 0.5
        if d.startswith("BUY"):
            return 1.0
        if d.startswith("SELL"):
            return 0.0
        return 0.5

    s_conf = float(short.get("confidence", 50.0)) / 100.0
    l_conf = float(long.get("confidence", 50.0)) / 100.0
    s_val = _map_decision_to_num(short.get("decision", "HOLD"))
    l_val = _map_decision_to_num(long.get("decision", "HOLD"))

    if (s_conf + l_conf) > 0:
        overall_score = (s_val * s_conf + l_val * l_conf) / (s_conf + l_conf)
    else:
        overall_score = 0.5

    if overall_score >= 0.62:
        overall_dec = "BUY"
    elif overall_score <= 0.38:
        overall_dec = "SELL"
    else:
        overall_dec = "HOLD"

    overall_alignment = 1.0 - min(1.0, abs(s_conf - l_conf))
    overall_strength = abs(overall_score - 0.5) * 2.0
    overall_conf = float(np.clip(0.2 + 0.65 * (0.6 * overall_strength + 0.4 * overall_alignment), 0.2, 0.85))

    # Aggregate risk from short and long horizons
    short_risk = short.get("risk", "MEDIUM")
    long_risk = long.get("risk", "MEDIUM")
    risk_map = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    avg_risk_score = (risk_map.get(short_risk, 1) + risk_map.get(long_risk, 1)) / 2.0
    if avg_risk_score < 0.67:
        overall_risk = "LOW"
    elif avg_risk_score < 1.67:
        overall_risk = "MEDIUM"
    else:
        overall_risk = "HIGH"

    result = {
        "short_term": short,
        "long_term": long,
        "overall": {
            "decision": overall_dec,
            "confidence": round(overall_conf * 100.0, 2),
            "reason": f"Short-term {short.get('decision')} ({short.get('confidence')}%) + Long-term {long.get('decision')} ({long.get('confidence')}%)",
            "risk": overall_risk,
        },
        "symbol": symbol,
        "period": period,
        "horizon": horizon,
        "pattern": pattern,
        "prediction": prediction,
        "sentiment": sentiment,
        "technical": technical,
        "fundamental": fundamental,
    }

    return to_builtin(result)


def get_final_decision(symbol: str, period: str = "2y", horizon: int = 5) -> Dict[str, Any]:
    cleaned_symbol = clean_symbol(symbol)
    return dict(_cached_decision(cleaned_symbol, period, int(horizon)))


__all__ = ["get_final_decision"]
