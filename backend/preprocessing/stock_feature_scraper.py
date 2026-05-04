import json
import logging
from pathlib import Path
from typing import List

import numpy as np
import pandas as pd
import yfinance as yf

from keras.models import load_model
from huggingface_hub import hf_hub_download
import torch

import pandas_ta as ta


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
logger = logging.getLogger("orchestrator")


ROOT = Path(__file__).resolve().parents[2]

TECHNICAL_MODEL_REPO = "Rishabhkapur/financial-analysis-upgrade-technical"
TECHNICAL_MODEL_FILE = "gru_stock_classifier-2.keras"
TECHNICAL_FEATURE_FILE = "feature_columns.json"

# Global cache for technical model and feature columns
TECH_MODEL = None
FEATURE_COLS = None
_TECH_MODEL_LOAD_FAILED = False


def _load_tech_model_and_features():
    global TECH_MODEL, FEATURE_COLS, _TECH_MODEL_LOAD_FAILED
    if TECH_MODEL is not None and FEATURE_COLS is not None:
        return TECH_MODEL, FEATURE_COLS
    if _TECH_MODEL_LOAD_FAILED:
        return None, FEATURE_COLS

    try:
        model_path = hf_hub_download(
            repo_id=TECHNICAL_MODEL_REPO,
            filename=TECHNICAL_MODEL_FILE,
            repo_type="model",
        )
        feat_path = hf_hub_download(
            repo_id=TECHNICAL_MODEL_REPO,
            filename=TECHNICAL_FEATURE_FILE,
            repo_type="model",
        )
        TECH_MODEL = load_model(model_path)
        FEATURE_COLS = json.loads(Path(feat_path).read_text())
    except Exception as e:
        logger.warning("Failed loading technical model from Hugging Face: %s", e)
        TECH_MODEL = None
        FEATURE_COLS = None
        _TECH_MODEL_LOAD_FAILED = True
    return TECH_MODEL, FEATURE_COLS


def fetch_price_data(ticker: str, period: str = "2y") -> pd.DataFrame:
    logger.info("Fetching %s price data (%s)", ticker, period)
    df = yf.download(ticker, period=period, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[['Open', 'High', 'Low', 'Close', 'Volume']]
    return df


def build_technical_features(df: pd.DataFrame, feature_cols: List[str]) -> pd.DataFrame:
    df = df.copy()
    logger.debug("Rows before feature engineering: %d", len(df))

    # Returns
    df['Log_Ret'] = ta.log_return(df['Close'])

    # Momentum (RSI lengths per notebook)
    for length in [5, 10, 14, 15]:
        df[f"rsi_{length}"] = ta.rsi(df['Close'], length=length)
    df['roc_10'] = ta.roc(df['Close'], length=10)
    df['mom_10'] = ta.mom(df['Close'], length=10)

    # Oscillators
    stochrsi = ta.stochrsi(df['Close'])
    if stochrsi is not None:
        df = pd.concat([df, stochrsi], axis=1)
    df['cci_20'] = ta.cci(df['High'], df['Low'], df['Close'], length=20)
    df['wr_14'] = ta.willr(df['High'], df['Low'], df['Close'], length=14)
    kst_df = ta.kst(df['Close'])
    if kst_df is not None:
        df = pd.concat([df, kst_df], axis=1)

    # MACD
    macd = ta.macd(df['Close'])
    if macd is not None:
        df = pd.concat([df, macd], axis=1)

    # Trend
    for length in [5, 10, 20]:
        df[f"sma_{length}"] = ta.sma(df['Close'], length=length)
        df[f"ema_{length}"] = ta.ema(df['Close'], length=length)
    df['vwma_20'] = ta.vwma(df['Close'], df['Volume'], length=20)

    # Volatility
    bb = ta.bbands(df['Close'], length=20)
    if bb is not None:
        df = pd.concat([df, bb], axis=1)
    df['atr_14'] = ta.atr(df['High'], df['Low'], df['Close'], length=14)
    kc = ta.kc(df['High'], df['Low'], df['Close'], length=20)
    if kc is not None:
        df = pd.concat([df, kc], axis=1)

    # Volume
    df['obv'] = ta.obv(df['Close'], df['Volume'])
    df['ad'] = ta.ad(df['High'], df['Low'], df['Close'], df['Volume'])
    df['efi'] = ta.efi(df['Close'], df['Volume'])
    nvi = ta.nvi(df['Close'], df['Volume'])
    if isinstance(nvi, pd.DataFrame):
        df = pd.concat([df, nvi], axis=1)
    pvi = ta.pvi(df['Close'], df['Volume'])
    if isinstance(pvi, pd.DataFrame):
        df = pd.concat([df, pvi], axis=1)

    # Ensure feature columns exist (create with NaN if missing)
    for col in feature_cols:
        if col not in df.columns:
            df[col] = pd.NA

    # Return features in requested order
    features_df = df[feature_cols].copy()
    logger.debug("Rows after feature computation (before NaN handling): %d", len(features_df))
    return features_df


def run_technical_model(price_df: pd.DataFrame) -> dict:
    model, feature_cols = _load_tech_model_and_features()
    if feature_cols is None:
        logger.warning('Feature columns not found; falling back to MA heuristic')
        ma20 = price_df['Close'].rolling(20).mean().iloc[-1]
        ma50 = price_df['Close'].rolling(50).mean().iloc[-1]
        score = float(np.clip(0.5 + np.sign(ma20 - ma50) * 0.25, 0.0, 1.0))
        sig = 'BUY' if ma20 > ma50 else ('SELL' if ma20 < ma50 else 'HOLD')
        conf = 'high' if abs(ma20 - ma50) / (ma50 + 1e-9) > 0.01 else 'medium'
        # Provide synthetic prob stubs so the fusion layer has consistent keys
        if sig == 'BUY':
            p_sell, p_hold, p_buy = 0.1, 1.0 - score, score
        elif sig == 'SELL':
            p_sell, p_hold, p_buy = 1.0 - score, score, 0.1
        else:
            p_sell, p_hold, p_buy = 0.25, 0.5, 0.25
        return {
            "technical_score": score, "signal": sig, "confidence": conf,
            "p_sell": p_sell, "p_hold": p_hold, "p_buy": p_buy,
        }

    feats_df = build_technical_features(price_df, feature_cols)
    window_size = 20

    logger.debug("feature columns count: %d", len(feature_cols))
    logger.debug("Rows available after feature build: %d", len(feats_df))

    if len(feats_df) == 0:
        logger.warning('No technical features produced; returning HOLD')
        return {
            "technical_score": 0.5, "signal": "HOLD", "confidence": "low",
            "p_sell": 0.25, "p_hold": 0.5, "p_buy": 0.25,
        }

    # Search for a NaN-free window from the end backwards
    valid_window = None
    for start in range(len(feats_df) - window_size, -1, -1):
        window = feats_df.iloc[start:start + window_size]
        if not window.isna().any().any():
            valid_window = window
            break

    if valid_window is None:
        logger.debug('No complete NaN-free window found; filling NaNs for last window')
        filled = feats_df.ffill().bfill()
        if len(filled) >= window_size:
            valid_window = filled.iloc[-window_size:]
        else:
            # pad by repeating first row
            to_pad = window_size - len(filled)
            pad_rows = pd.DataFrame([filled.iloc[0].values] * to_pad, columns=filled.columns)
            valid_window = pd.concat([pad_rows, filled])

    logger.info("Technical features: rows_before=%d, rows_after=%d, window_size=%d, feature_count=%d",
                len(price_df), len(feats_df), window_size, valid_window.shape[1])

    # Ensure numeric values and fill any remaining NAs conservatively
    valid_window_numeric = valid_window.apply(pd.to_numeric, errors='coerce').ffill().bfill().fillna(0.0)
    X_window = valid_window_numeric.to_numpy(dtype=np.float32)
    if X_window.shape[0] != window_size:
        # ensure correct shape
        if X_window.shape[0] < window_size:
            pad_top = np.repeat(X_window[0:1, :], window_size - X_window.shape[0], axis=0)
            X_window = np.vstack([pad_top, X_window])
        else:
            X_window = X_window[-window_size:]

    X_window = X_window.reshape((1, window_size, X_window.shape[1]))

    if model is None:
        if _TECH_MODEL_LOAD_FAILED:
            logger.info('Technical model unavailable; using heuristic fallback')
        else:
            logger.warning('Technical model not loaded; returning heuristic')
        ma20 = price_df['Close'].rolling(20).mean().iloc[-1]
        ma50 = price_df['Close'].rolling(50).mean().iloc[-1]
        score = float(np.clip(0.5 + np.sign(ma20 - ma50) * 0.25, 0.0, 1.0))
        sig = 'BUY' if ma20 > ma50 else ('SELL' if ma20 < ma50 else 'HOLD')
        conf = 'high' if abs(ma20 - ma50) / (ma50 + 1e-9) > 0.01 else 'medium'
        if sig == 'BUY':
            p_sell, p_hold, p_buy = 0.1, 1.0 - score, score
        elif sig == 'SELL':
            p_sell, p_hold, p_buy = 1.0 - score, score, 0.1
        else:
            p_sell, p_hold, p_buy = 0.25, 0.5, 0.25
        return {
            "technical_score": score, "signal": sig, "confidence": conf,
            "p_sell": p_sell, "p_hold": p_hold, "p_buy": p_buy,
        }

    preds = model.predict(X_window)

    # ── FIX: Preserve full probability distribution, use directional scoring ──
    if preds.ndim == 2 and preds.shape[-1] == 3:
        probs = torch.softmax(torch.tensor(preds[0]), dim=0).numpy()
        p_sell, p_hold, p_buy = float(probs[0]), float(probs[1]), float(probs[2])

        # Directional signal: net bull pressure, dampened by conviction.
        # net_direction ∈ [-1, +1]: positive = bullish, negative = bearish.
        # conviction    ∈ [0,  1]: near 0 when model is uncertain (high p_hold).
        # Old formula:  probs[2]*1 + probs[1]*0.5 + probs[0]*0  → asymmetric,
        #               an 80% SELL only scored ~0.10 while an 80% HOLD scored 0.50.
        net_direction = p_buy - p_sell          # [-1, +1]
        conviction    = 1.0 - p_hold            # [0,  1]
        weighted      = net_direction * conviction  # [-1, +1]

        # Map [-1, +1] → [0, 1] for the engine's score scale
        score = float(np.clip((weighted + 1.0) / 2.0, 0.0, 1.0))

        arg    = int(np.argmax(probs))
        labels = {0: 'SELL', 1: 'HOLD', 2: 'BUY'}
        signal = labels.get(arg, 'HOLD')
        confidence = 'high' if probs.max() > 0.7 else ('medium' if probs.max() > 0.5 else 'low')

        logger.info(
            "GRU probs — p_sell=%.3f p_hold=%.3f p_buy=%.3f → net_dir=%.3f "
            "conviction=%.3f score=%.4f signal=%s",
            p_sell, p_hold, p_buy, net_direction, conviction, score, signal,
        )
    else:
        # Scalar output fallback (non-3-class model)
        val   = float(preds.ravel()[-1])
        score = float(np.clip(val, 0.0, 1.0))
        signal = 'BUY' if score > 0.6 else ('SELL' if score < 0.4 else 'HOLD')
        confidence = 'medium'
        # Synthetic prob stubs for consistent fusion-layer keys
        if signal == 'BUY':
            p_sell, p_hold, p_buy = 0.1, 1.0 - score, score
        elif signal == 'SELL':
            p_sell, p_hold, p_buy = 1.0 - score, score, 0.1
        else:
            p_sell, p_hold, p_buy = 0.25, 0.5, 0.25

    return {
        "technical_score": score,
        "signal":          signal,
        "confidence":      confidence,
        # Raw probabilities preserved for the fusion layer (Fix #1)
        "p_sell":          p_sell,
        "p_hold":          p_hold,
        "p_buy":           p_buy,
    }


def tech_prediction_pipeline(ticker: str) -> dict:
    price_df = fetch_price_data(ticker)
    result = run_technical_model(price_df)
    return result