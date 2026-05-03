"""Fundamental financial data scraper.

Extracts structured annual financial data from Yahoo Finance via `yfinance`
and returns the fields needed by the fundamental and risk analysis pipeline.

Public entry point:
    get_financial_data(ticker: str) -> Dict[str, float]

Always returns a complete dictionary with safe float defaults.
"""

from __future__ import annotations

import importlib
import logging
import math
from functools import lru_cache
from typing import Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Schema & aliases
# ──────────────────────────────────────────────

DEFAULT_FINANCIAL_DATA: Dict[str, float] = {
    "rev_t":               0.0,
    "rev_prev":            0.0,
    "net_income":          0.0,
    "equity":              0.0,
    "debt":                0.0,
    "current_assets":      0.0,
    "current_liabilities": 0.0,
    "ebit":                0.0,
    "interest_expense":    0.0,
}

# Each key maps to candidate row names tried in order (first non-zero wins).
STATEMENT_ALIASES: Dict[str, List[str]] = {
    "revenue": ["Total Revenue", "totalRevenue", "Revenue"],
    "net_income": [
        "Net Income",
        "Net Income Common Stockholders",
        "Net Income Continuous Operations",
        "Net Income From Continuing Operation Net Minority Interest",
    ],
    "equity": [
        "Total Stockholder Equity",
        "Total Stockholders Equity",
        "Stockholders Equity",
        "Total Equity Gross Minority Interest",
    ],
    "debt": [
        "Total Debt",
        "Long Term Debt And Capital Lease Obligation",
        "Long Term Debt",
        "Short Long Term Debt",
    ],
    "current_assets":      ["Total Current Assets"],
    "current_liabilities": ["Total Current Liabilities"],
    "ebit":                ["EBIT", "Ebit", "Operating Income"],
    "interest_expense":    ["Interest Expense", "InterestExpense"],
}

# ──────────────────────────────────────────────
# Small utilities
# ──────────────────────────────────────────────

def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return default
        n = float(value)
        return default if (math.isnan(n) or math.isinf(n)) else n
    except (TypeError, ValueError):
        return default


def _is_invalid(value: object) -> bool:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return True
    return math.isnan(n) or math.isinf(n)


def _normalize_ticker(ticker: str) -> str:
    return str(ticker or "").strip().upper()


@lru_cache(maxsize=512)
def _cf(name: str) -> str:
    """Casefold a row name — cached so repeated calls are O(1)."""
    return str(name or "").strip().casefold()


def _default_output() -> Dict[str, float]:
    return dict(DEFAULT_FINANCIAL_DATA)


# ──────────────────────────────────────────────
# DataFrame helpers
# ──────────────────────────────────────────────

def _build_index(df) -> Dict[str, str]:
    """Return {casefolded_name: original_name} for every row in *df*."""
    try:
        return {_cf(idx): idx for idx in df.index}
    except Exception:
        return {}


def safe_get(df, key: str) -> float:
    """Return the latest valid value for *key* in *df*, or 0.0."""
    if df is None or getattr(df, "empty", True):
        return 0.0

    actual = _build_index(df).get(_cf(key))
    if actual is None:
        logger.debug("Missing financial field: %s", key)
        return 0.0

    try:
        row = df.loc[actual]
        if hasattr(row, "iloc"):
            series = row.dropna()
            return 0.0 if series.empty else _safe_float(series.iloc[0])
        return _safe_float(row)
    except Exception:
        logger.debug("Failed extracting financial field: %s", key)
        return 0.0


def _first_nonzero(df, keys: Sequence[str]) -> float:
    """Return the first non-zero value among *keys* in *df*."""
    idx = _build_index(df) if (df is not None and not getattr(df, "empty", True)) else {}
    for key in keys:
        actual = idx.get(_cf(key))
        if actual is None:
            continue
        try:
            row = df.loc[actual]
            series = row.dropna() if hasattr(row, "dropna") else row
            val = _safe_float(series.iloc[0] if hasattr(series, "iloc") else series)
            if val != 0.0:
                return val
        except Exception:
            continue
    return 0.0


def _latest_two(df, keys: Sequence[str]) -> Tuple[float, float]:
    """Return (latest, previous) for the first matching key in *df*."""
    if df is None or getattr(df, "empty", True):
        return 0.0, 0.0

    idx = _build_index(df)
    for key in keys:
        actual = idx.get(_cf(key))
        if actual is None:
            continue
        try:
            values = [v for v in df.loc[actual].tolist() if not _is_invalid(v)]
            if not values:
                continue
            latest   = _safe_float(values[0])
            previous = _safe_float(values[1]) if len(values) > 1 else 0.0
            return latest, previous
        except Exception:
            logger.debug("Failed reading recent values for %s", key)
    return 0.0, 0.0


# ──────────────────────────────────────────────
# yfinance loader (module-level singleton)
# ──────────────────────────────────────────────

_yf = None
_yf_tried = False


def _get_yfinance():
    global _yf, _yf_tried
    if _yf_tried:
        return _yf
    _yf_tried = True
    try:
        _yf = importlib.import_module("yfinance")
    except Exception as exc:
        logger.warning("yfinance unavailable; returning default financial data: %s", exc)
        _yf = None
    return _yf


# ──────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────

def get_financial_data(ticker: str) -> Dict[str, float]:
    """Fetch structured annual financial data for *ticker*.

    Falls back to zero-filled defaults if Yahoo Finance data cannot be loaded.
    """
    cleaned = _normalize_ticker(ticker)
    if not cleaned:
        logger.warning("Empty ticker supplied to get_financial_data")
        return _default_output()

    yf = _get_yfinance()
    if yf is None:
        return _default_output()

    try:
        obj          = yf.Ticker(cleaned)
        financials   = getattr(obj, "financials",   None)
        balance      = getattr(obj, "balance_sheet", None)
        cashflow     = getattr(obj, "cashflow",      None)

        rev_t, rev_prev = _latest_two(financials, STATEMENT_ALIASES["revenue"])
        net_income      = _first_nonzero(financials, STATEMENT_ALIASES["net_income"])
        equity          = _first_nonzero(balance,    STATEMENT_ALIASES["equity"])
        current_assets  = _first_nonzero(balance,    STATEMENT_ALIASES["current_assets"])
        current_liab    = _first_nonzero(balance,    STATEMENT_ALIASES["current_liabilities"])
        ebit            = _first_nonzero(financials, STATEMENT_ALIASES["ebit"])

        # Debt: try alias list first, then sum long+short as a fallback
        debt = _first_nonzero(balance, STATEMENT_ALIASES["debt"])
        if debt == 0.0 and balance is not None and not getattr(balance, "empty", True):
            debt = safe_get(balance, "Long Term Debt") + safe_get(balance, "Short Long Term Debt")

        # Interest expense: financials → cashflow fallback, always positive
        interest_expense = _first_nonzero(financials, STATEMENT_ALIASES["interest_expense"])
        if interest_expense == 0.0:
            interest_expense = _first_nonzero(cashflow, STATEMENT_ALIASES["interest_expense"])
        interest_expense = abs(interest_expense)

        output: Dict[str, float] = {
            "rev_t":               _safe_float(rev_t),
            "rev_prev":            _safe_float(rev_prev),
            "net_income":          _safe_float(net_income),
            "equity":              _safe_float(equity),
            "debt":                _safe_float(debt),
            "current_assets":      _safe_float(current_assets),
            "current_liabilities": _safe_float(current_liab),
            "ebit":                _safe_float(ebit),
            "interest_expense":    _safe_float(interest_expense),
        }

        missing = [k for k, v in output.items() if v == 0.0]
        if missing:
            logger.info("Zero/missing financial fields for %s: %s", cleaned, ", ".join(missing))

        logger.info("Financial data fetched for %s", cleaned)
        return output

    except Exception as exc:
        logger.exception("Failed to fetch financial data for %s: %s", cleaned, exc)
        return _default_output()


__all__ = ["DEFAULT_FINANCIAL_DATA", "get_financial_data", "safe_get"]