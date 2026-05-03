from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict

from backend.models.transformer_model import forecast_prices
from backend.utils.preprocessing import clean_symbol, load_price_history, to_builtin


@lru_cache(maxsize=256)
def _cached_prediction(symbol: str, period: str, horizon: int) -> Dict[str, Any]:
    price_frame = load_price_history(symbol, period=period)
    result = forecast_prices(symbol, price_frame, horizon=horizon)
    result["period"] = period
    return to_builtin(result)


def get_prediction(symbol: str, period: str = "2y", horizon: int = 5) -> Dict[str, Any]:
    cleaned_symbol = clean_symbol(symbol)
    payload = _cached_prediction(cleaned_symbol, period, int(horizon))
    return dict(payload)


__all__ = ["get_prediction"]
