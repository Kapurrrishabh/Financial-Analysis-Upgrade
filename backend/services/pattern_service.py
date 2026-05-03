from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict

from backend.models.pattern_recognition import detect_patterns
from backend.utils.preprocessing import clean_symbol, load_price_history, to_builtin


@lru_cache(maxsize=256)
def _cached_pattern(symbol: str, period: str) -> Dict[str, Any]:
    price_frame = load_price_history(symbol, period=period)
    result = detect_patterns(price_frame["Close"].to_numpy())
    result["symbol"] = symbol
    result["period"] = period
    return to_builtin(result)


def get_pattern_analysis(symbol: str, period: str = "2y") -> Dict[str, Any]:
    cleaned_symbol = clean_symbol(symbol)
    payload = dict(_cached_pattern(cleaned_symbol, period))
    payload["market_implication"] = payload.get("trend", "neutral")
    return payload


__all__ = ["get_pattern_analysis"]
