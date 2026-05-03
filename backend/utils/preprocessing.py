from __future__ import annotations

import hashlib
from typing import Any, Iterable

import numpy as np
import pandas as pd


def clean_symbol(symbol: str) -> str:
    return str(symbol or "").strip().upper()


def to_builtin(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: to_builtin(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_builtin(item) for item in value]
    if isinstance(value, tuple):
        return [to_builtin(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def price_frame_fingerprint(values: Iterable[float], precision: int = 4) -> str:
    rounded = [f"{float(value):.{precision}f}" for value in values if np.isfinite(float(value))]
    payload = "|".join(rounded).encode("utf-8")
    return hashlib.sha1(payload).hexdigest()


def normalize_price_frame(price_frame: pd.DataFrame) -> pd.DataFrame:
    if price_frame is None or price_frame.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    frame = price_frame.copy()
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)

    frame.index = pd.to_datetime(frame.index)
    frame = frame.sort_index()

    required_columns = ["Open", "High", "Low", "Close", "Volume"]
    missing = [column for column in required_columns if column not in frame.columns]
    if missing:
        raise ValueError(f"Missing required market columns: {missing}")

    frame = frame[required_columns].apply(pd.to_numeric, errors="coerce")
    frame = frame.dropna(subset=["Close"])
    return frame


def load_price_history(symbol: str, period: str = "2y") -> pd.DataFrame:
    cleaned_symbol = clean_symbol(symbol)

    try:
        from backend.preprocessing.stock_feature_scraper import fetch_price_data

        frame = fetch_price_data(cleaned_symbol, period=period)
        if isinstance(frame, pd.DataFrame) and not frame.empty:
            return normalize_price_frame(frame)
    except Exception:
        pass

    try:
        import yfinance as yf

        frame = yf.download(cleaned_symbol, period=period, progress=False)
        return normalize_price_frame(frame)
    except Exception as exc:
        raise RuntimeError(f"Unable to load price history for {cleaned_symbol}: {exc}") from exc


def history_payload(price_frame: pd.DataFrame, limit: int = 120) -> list[dict[str, Any]]:
    frame = normalize_price_frame(price_frame).tail(limit)
    return [
        {"time": pd.Timestamp(index).isoformat(), "close": round(float(row["Close"]), 4)}
        for index, row in frame.iterrows()
    ]


def future_business_dates(last_timestamp: pd.Timestamp, periods: int) -> pd.DatetimeIndex:
    start = pd.Timestamp(last_timestamp) + pd.offsets.BDay(1)
    return pd.bdate_range(start=start, periods=max(1, int(periods)))
