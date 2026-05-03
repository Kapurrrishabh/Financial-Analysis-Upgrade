"""
FinIntel FastAPI Backend
========================
Production-grade backend with async execution, proper caching,
error handling, input validation, typed responses, and clean architecture.

Fixes applied (v2.2):
  - _fetch_ticker_info: replaced _get_price_data (which returned None/empty)
    with a direct yf.download call — same approach as fetch_price_data in
    stock_scraper.py but inline so we control the period and column handling.
  - prices list: was silently empty when price_df was None; now falls back
    to a second yf.download attempt before giving up.
  - MultiIndex columns from yf.download are now flattened before iterrows().
  - fundamental_score surfaced from pipeline result (was missing from response).
  - technical_score: pipeline result key corrected
    ("technical" → result["technical"]["technical_score"]).
  - safe_json: pd.Timestamp handling extended to tz-aware timestamps.
  - /news/market route: fixed — FastAPI matched /news/{ticker} first because
    the literal route was defined after the path-param route. Moved above.
"""

from __future__ import annotations

import asyncio
import math
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

import httpx
import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException, Path, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.scraper.news_scraper import get_news
from backend.preprocessing.sentiment_model_scoring import run_sentiment_model
from backend.orchestration.complete_pipeline import run_complete_pipeline
from backend.services.pattern_service import get_pattern_analysis
from backend.services.prediction_service import get_prediction
from backend.services.decision_service import get_final_decision

# ─────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────

CACHE_TTL_STOCK  = 300
CACHE_TTL_MARKET = 60
CACHE_TTL_NEWS   = 600
CACHE_TTL_SEARCH = 3600

MARKET_TICKERS = [
    "^NSEI", "^BSESN",
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
    "AAPL", "NVDA", "MSFT", "TSLA",
]

TICKER_DISPLAY = {
    "^NSEI":  "NIFTY 50",
    "^BSESN": "SENSEX",
}

MAX_NEWS_ITEMS = 12

# ─────────────────────────────────────────────
# CACHE
# ─────────────────────────────────────────────

class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if not entry:
                return None
            if time.monotonic() - entry["ts"] > entry["ttl"]:
                del self._store[key]
                return None
            return entry["data"]

    async def set(self, key: str, data: Any, ttl: int) -> None:
        async with self._lock:
            self._store[key] = {"data": data, "ts": time.monotonic(), "ttl": ttl}

    async def invalidate(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def stats(self) -> dict:
        async with self._lock:
            return {"entries": len(self._store)}


cache = TTLCache()

# ─────────────────────────────────────────────
# LIFESPAN
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 FinIntel API starting — warming market cache…")
    try:
        data = await _fetch_market_data()
        await cache.set("market:global", data, CACHE_TTL_MARKET)
        print("✅ Market cache ready.")
    except Exception as exc:
        print(f"⚠️  Market warmup failed: {exc}")
    yield
    print("🛑 FinIntel API shutting down.")


# ─────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────

app = FastAPI(
    title="FinIntel API",
    version="2.2.0",
    description="AI-powered financial intelligence backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────
# PYDANTIC MODELS
# ─────────────────────────────────────────────

class PortfolioItem(BaseModel):
    symbol:   str   = Field(..., min_length=1, max_length=20)
    quantity: int   = Field(..., gt=0)
    price:    float = Field(..., gt=0)


class HealthResponse(BaseModel):
    status:        str
    version:       str
    cache_entries: int
    timestamp:     float


# ─────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────

def safe_json(data: Any) -> Any:
    """Recursively sanitise data for JSON serialisation."""
    if isinstance(data, dict):
        return {k: safe_json(v) for k, v in data.items()}
    if isinstance(data, (list, tuple)):
        return [safe_json(v) for v in data]
    if isinstance(data, np.generic):
        return data.item()
    if isinstance(data, float) and (math.isnan(data) or math.isinf(data)):
        return 0.0
    if isinstance(data, pd.Timestamp):
        # Handle both tz-aware and tz-naive timestamps (fix: tz-aware crashed)
        try:
            return str(data.date())
        except Exception:
            return str(data)
    return data


def _norm(ticker: str) -> str:
    return ticker.strip().upper()


def _display_name(sym: str) -> str:
    return TICKER_DISPLAY.get(sym, sym.replace(".NS", "").replace(".BO", ""))


def _is_indian(sym: str) -> bool:
    return sym.endswith(".NS") or sym.endswith(".BO") or sym.startswith("^")


def _currency(sym: str) -> str:
    return "INR" if _is_indian(sym) else "USD"


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten MultiIndex columns that yf.download returns for single tickers."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


# ─────────────────────────────────────────────
# PRICE DATA FETCHER  (fix #1 — the root cause)
# ─────────────────────────────────────────────

def _fetch_price_df(ticker: str, period: str = "1y") -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV data for *ticker* and return a clean DataFrame with a
    DatetimeIndex and at least a 'Close' column.

    This replaces the broken _get_price_data() import from complete_pipeline
    which was returning None for most tickers.

    Strategy:
      1. yf.download with period= (fast, no date arithmetic needed)
      2. If that returns empty, try yf.Ticker.history as a fallback
      3. Flatten MultiIndex columns (yfinance quirk for single-ticker calls)
      4. Return None only if both attempts fail
    """
    try:
        df = yf.download(ticker, period=period, progress=False, repair=True)
        df = _flatten_columns(df)
        if not df.empty and "Close" in df.columns:
            return df
    except Exception as exc:
        print(f"⚠️  yf.download failed for {ticker}: {exc}")

    # Fallback: Ticker.history (different code path in yfinance)
    try:
        df = yf.Ticker(ticker).history(period=period)
        df = _flatten_columns(df)
        if not df.empty and "Close" in df.columns:
            return df
    except Exception as exc:
        print(f"⚠️  Ticker.history fallback also failed for {ticker}: {exc}")

    return None


def _build_prices_list(price_df: Optional[pd.DataFrame]) -> list[dict]:
    """
    Convert a price DataFrame → list of {date, close} dicts for the frontend.

    Takes the most recent 365 trading days so the chart has enough history
    for all period filters (1W/1M/3M/6M/1Y/ALL).
    """
    if price_df is None or price_df.empty:
        return []

    prices: list[dict] = []
    for idx, row in price_df.tail(365).iterrows():
        try:
            close_val = float(row["Close"])
            if math.isnan(close_val) or math.isinf(close_val) or close_val == 0.0:
                continue
            # idx may be a tz-aware Timestamp — normalise to a plain date string
            if isinstance(idx, pd.Timestamp):
                date_str = str(idx.date())
            else:
                date_str = str(idx)
            prices.append({"date": date_str, "close": round(close_val, 4)})
        except Exception:
            continue

    return prices


# ─────────────────────────────────────────────
# MARKET DATA BUILDER
# ─────────────────────────────────────────────

async def _fetch_market_data() -> dict:
    loop = asyncio.get_event_loop()

    def _download():
        return yf.download(
            MARKET_TICKERS,
            period="5d",
            interval="1d",
            group_by="ticker",
            progress=False,
            threads=True,
        )

    data = await loop.run_in_executor(None, _download)

    result: dict[str, list] = {"ticker": [], "trending": [], "insights": []}

    for sym in MARKET_TICKERS:
        try:
            df = (data[sym] if isinstance(data.columns, pd.MultiIndex) else data).dropna()
            if df.empty or "Close" not in df.columns:
                continue

            current = float(df["Close"].iloc[-1])
            prev    = float(df["Close"].iloc[-2]) if len(df) >= 2 else current
            change  = round(((current - prev) / prev) * 100, 2) if prev else 0.0
            display = _display_name(sym)
            cur     = "₹" if _is_indian(sym) else "$"

            result["ticker"].append({
                "symbol": display,
                "price":  f"{cur}{current:,.2f}",
                "change": change,
            })

            if sym not in ("^NSEI", "^BSESN"):
                history = [round(float(x), 2) for x in df["Close"].tolist()[-8:]]
                result["trending"].append({
                    "symbol":   sym,
                    "name":     display,
                    "price":    f"{cur}{current:,.2f}",
                    "change":   f"{'+' if change >= 0 else ''}{change}%",
                    "isUp":     change >= 0,
                    "history":  history,
                    "category": "indian" if _is_indian(sym) else "us",
                })
        except Exception as exc:
            print(f"⚠️  Skipping {sym}: {exc}")

    nifty_change = next(
        (t["change"] for t in result["ticker"] if "NIFTY" in t["symbol"]), 0.0
    )
    bullish = nifty_change >= 0
    result["insights"] = [{
        "label":   "Market Sentiment",
        "value":   "Bullish" if bullish else "Bearish",
        "color":   "text-emerald-400" if bullish else "text-rose-400",
        "bg":      "bg-emerald-400/10" if bullish else "bg-rose-400/10",
        "conf":    min(round(abs(nifty_change) * 40 + 55), 95),
        "icon":    "📈" if bullish else "📉",
        "signal":  "buy" if bullish else "sell",
        "risk":    "medium",
        "trend":   "up" if bullish else "down",
        "tooltip": f"Based on NIFTY 50 movement of {nifty_change:+.2f}% today.",
    }]

    return result


# ─────────────────────────────────────────────
# PORTFOLIO STORE
# ─────────────────────────────────────────────

_portfolio: list[dict] = []
_portfolio_lock = asyncio.Lock()


# ─────────────────────────────────────────────
# ROUTES — HEALTH
# ─────────────────────────────────────────────

@app.get("/", response_model=HealthResponse)
async def health_check() -> dict:
    stats = await cache.stats()
    return {
        "status":        "ok",
        "version":       "2.2.0",
        "cache_entries": stats["entries"],
        "timestamp":     time.time(),
    }


@app.get("/ping")
async def ping():
    return {"message": "pong"}


# ─────────────────────────────────────────────
# ROUTES — MARKET
# ─────────────────────────────────────────────

@app.get("/market")
async def get_market_data() -> dict:
    cached = await cache.get("market:global")
    if cached:
        return {**cached, "cached": True}

    try:
        data = await _fetch_market_data()
        result = safe_json(data)
        await cache.set("market:global", result, CACHE_TTL_MARKET)
        return {**result, "cached": False}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Market data unavailable: {exc}",
        )


# ─────────────────────────────────────────────
# ROUTES — STOCK ANALYSIS
# ─────────────────────────────────────────────

@app.get("/stock/{ticker}")
async def get_stock_analysis(
    ticker: str = Path(..., min_length=1, max_length=20),
) -> dict:
    ticker    = _norm(ticker)
    cache_key = f"stock:{ticker}"

    cached = await cache.get(cache_key)
    if cached:
        print(f"⚡ Cache hit: {ticker}")
        return {**cached, "cached": True}

    print(f"🔬 Cache miss — running pipeline for {ticker}…")
    loop = asyncio.get_event_loop()

    try:
        # Run ML pipeline, pattern & prediction services and price+info fetch concurrently
        pipeline_task   = loop.run_in_executor(None, run_complete_pipeline, ticker)
        info_task       = loop.run_in_executor(None, _fetch_ticker_info, ticker)
        pattern_task    = loop.run_in_executor(None, get_pattern_analysis, ticker, "1y")
        prediction_task = loop.run_in_executor(None, get_prediction, ticker, "2y", 5)

        result, (info, price_df), pattern, prediction = await asyncio.gather(
            pipeline_task,
            info_task,
            pattern_task,
            prediction_task,
        )

    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analysis failed for {ticker}: {exc}",
        )

    # ── Price history (fix #1 + #2) ────────────────────────────────────
    prices = _build_prices_list(price_df)

    # If _fetch_ticker_info somehow returned no price data, try once more
    # directly (defensive fallback — should not normally be needed)
    if not prices:
        print(f"⚠️  Price data empty for {ticker} after primary fetch, retrying…")
        fallback_df = await loop.run_in_executor(
            None, lambda: _fetch_price_df(ticker, period="1y")
        )
        prices = _build_prices_list(fallback_df)

    if not prices:
        print(f"❌ Could not fetch any price data for {ticker}")

    # ── Fundamentals ───────────────────────────────────────────────────
    fundamentals: dict[str, Any] = {
        "roe": None, "debt_equity": None, "revenue_growth": None,
        "profit_margin": None, "market_cap": None, "pe_ratio": None,
        "eps": None, "beta": None, "dividend_yield": None,
        "avg_volume": None, "sector": None, "industry": None,
        "name": None, "website": None,
        "52w_high": None, "52w_low": None,
    }

    try:
        metrics = result["fundamental"]["details"]["fundamental"]["metrics"]
        roe        = metrics.get("return_on_equity")
        rev_growth = metrics.get("revenue_growth")
        margin     = metrics.get("net_profit_margin")
        fundamentals.update({
            "roe":            round(roe * 100, 2)        if roe        is not None else None,
            "revenue_growth": round(rev_growth * 100, 2) if rev_growth is not None else None,
            "profit_margin":  round(margin * 100, 2)     if margin     is not None else None,
            "debt_equity":    metrics.get("debt_to_equity"),
        })
    except Exception:
        pass

    # Merge yfinance info (market_cap, pe, eps, beta, etc.)
    fundamentals.update({k: v for k, v in info.items() if v is not None})

    # ── Scores (fix #3 — key path was wrong) ──────────────────────────
    tech   = result.get("technical", {})
    sent   = result.get("sentiment", {})
    fund   = result.get("fundamental", {})

    # technical_score lives at result["technical"]["technical_score"]
    technical_score  = tech.get("technical_score", 0.0) or 0.0
    sentiment_score  = sent.get("sentiment_score", 0.5) or 0.5
    # fundamental_score was never included in response before (fix #4)
    fundamental_score = (
        fund.get("fundamental_score")
        or fund.get("details", {}).get("fundamental", {}).get("score")
        or 0.0
    )
    final_score = result.get("final_score", 0.5) or 0.5
    signal      = tech.get("signal", "neutral")

    # Compute dual-horizon decision (short_term, long_term, overall)
    try:
        decision_struct = get_final_decision(ticker, period="2y", horizon=5)
        overall_decision = decision_struct.get("overall", {}).get("decision", result.get("decision", "HOLD"))
    except Exception:
        decision_struct = {}
        overall_decision = result.get("decision", "HOLD")

    explanation = (
        f"Decision: {overall_decision}\n"
        f"Technical Signal: {signal}\n"
        f"Sentiment Score: {sentiment_score:.2f}\n"
        f"Final Score: {final_score:.2f}"
    )

    response = safe_json({
        "symbol":             ticker,
        "name":               fundamentals.get("name") or ticker,
        "currency":           _currency(ticker),
        "prices":             prices,
        "pattern":            pattern,
        "prediction":         prediction,
        "technical_score":    round(float(technical_score),   4),
        "technical_signal":   signal,
        "sentiment_score":    round(float(sentiment_score),   4),
        "fundamental_score":  round(float(fundamental_score), 4),
        "fundamentals":       fundamentals,
        "final_score":        round(float(final_score),       4),
        "decision":           overall_decision,
        "decision_details":   decision_struct,
        "explanation":        explanation.strip(),
        "generated_at":       time.time(),
    })

    await cache.set(cache_key, response, CACHE_TTL_STOCK)
    return {**response, "cached": False}


async def _get_pattern_analysis_response(ticker: str, period: str) -> dict:
    cache_key = f"pattern:{_norm(ticker)}:{period}"
    cached = await cache.get(cache_key)
    if cached:
        return {**cached, "cached": True}

    loop = asyncio.get_event_loop()
    try:
        payload = await loop.run_in_executor(None, get_pattern_analysis, ticker, period)
        response = safe_json(payload)
        await cache.set(cache_key, response, CACHE_TTL_STOCK)
        return {**response, "cached": False}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Pattern analysis failed for {ticker}: {exc}",
        )


@app.get("/pattern-analysis")
async def get_pattern_analysis_route(
    symbol: str = Query(..., min_length=1, max_length=20),
    period: str = Query("1y", min_length=1, max_length=8),
) -> dict:
    return await _get_pattern_analysis_response(symbol, period)


@app.get("/pattern-analysis/{ticker}")
async def get_pattern_analysis_route_legacy(
    ticker: str = Path(..., min_length=1, max_length=20),
    period: str = Query("1y", min_length=1, max_length=8),
) -> dict:
    return await _get_pattern_analysis_response(ticker, period)


def _fetch_ticker_info(ticker: str) -> tuple[dict, Optional[pd.DataFrame]]:
    """
    Blocking: fetch yfinance .info metadata + price history.

    Price history now uses _fetch_price_df() instead of the broken
    _get_price_data() import from complete_pipeline (fix #1).
    """
    info_out: dict[str, Any] = {}

    # ── Price data (fix #1) ────────────────────────────────────────────
    price_df = _fetch_price_df(ticker, period="1y")

    # ── Info / metadata ────────────────────────────────────────────────
    try:
        stock = yf.Ticker(ticker)
        info  = {}
        try:
            info = stock.info or {}
        except Exception:
            pass

        fast = {}
        try:
            fast = stock.fast_info or {}
        except Exception:
            pass

        # 52-week range: prefer info dict, fall back to fast_info attributes
        w52_high = (
            info.get("fiftyTwoWeekHigh")
            or getattr(fast, "fifty_two_week_high", None)
        )
        w52_low = (
            info.get("fiftyTwoWeekLow")
            or getattr(fast, "fifty_two_week_low", None)
        )

        info_out = {
            "market_cap":     info.get("marketCap") or getattr(fast, "market_cap", None),
            "pe_ratio":       info.get("trailingPE") or info.get("forwardPE"),
            "eps":            info.get("trailingEps") or info.get("forwardEps"),
            "beta":           info.get("beta"),
            "dividend_yield": info.get("dividendYield"),
            "avg_volume":     info.get("averageVolume") or getattr(fast, "ten_day_average_volume", None),
            "sector":         info.get("sector"),
            "industry":       info.get("industry"),
            "name":           info.get("longName") or info.get("shortName"),
            "website":        info.get("website"),
            "52w_high":       float(w52_high) if w52_high is not None else None,
            "52w_low":        float(w52_low)  if w52_low  is not None else None,
        }
    except Exception as exc:
        print(f"⚠️  yfinance info failed for {ticker}: {exc}")

    return info_out, price_df


# ─────────────────────────────────────────────
# ROUTES — SEARCH
# ─────────────────────────────────────────────

@app.get("/search/{query}")
async def search_stocks(
    query: str = Path(..., min_length=1, max_length=50),
) -> list[dict]:
    query     = query.strip().upper()
    cache_key = f"search:{query}"

    cached = await cache.get(cache_key)
    if cached:
        return cached

    url = (
        f"https://query1.finance.yahoo.com/v1/finance/search"
        f"?q={query}&quotesCount=10&newsCount=0"
    )
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; FinIntel/2.2)",
        "Accept":     "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()

        results = [
            {
                "symbol":   q["symbol"],
                "name":     q.get("shortname") or q.get("longname", ""),
                "exchange": q.get("exchange", ""),
                "type":     q.get("quoteType", "EQUITY"),
            }
            for q in r.json().get("quotes", [])
            if "symbol" in q
        ][:10]

        await cache.set(cache_key, results, CACHE_TTL_SEARCH)
        return results

    except httpx.TimeoutException:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Search timed out.")
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Search failed: {exc}")


# ─────────────────────────────────────────────
# ROUTES — NEWS
# NOTE: /news/market MUST be defined before /news/{ticker} so FastAPI
#       doesn't swallow "market" as a ticker value (fix #5).
# ─────────────────────────────────────────────

def _format_news_items(raw_news: list[dict]) -> tuple[list[dict], list[str]]:
    formatted: list[dict] = []
    texts:     list[str]  = []

    for i, item in enumerate(raw_news[:MAX_NEWS_ITEMS]):
        title = item.get("title") or ""
        text  = item.get("text",  "") or ""
        url   = item.get("url",   "") or item.get("link", "")

        if not title or not url:
            continue

        texts.append(text)
        formatted.append({
            "id":        i + 1,
            "title":     title,
            "url":       url,
            "time":      item.get("date", ""),
            "source":    item.get("source", "News"),
            "text":      text[:300],
            "sentiment": None,
        })

    return formatted, texts


async def _get_news_response(ticker: str) -> dict:
    loop = asyncio.get_event_loop()
    raw_news = await loop.run_in_executor(None, get_news, ticker)

    if not raw_news:
        return {"news": [], "sentiment": {}, "ticker": ticker}

    formatted, texts = _format_news_items(raw_news)

    sentiments: dict = {}
    if texts:
        try:
            sentiments = await loop.run_in_executor(None, run_sentiment_model, texts)
            labels = sentiments.get("labels", []) if isinstance(sentiments, dict) else []
            for i, label in enumerate(labels):
                if i < len(formatted):
                    formatted[i]["sentiment"] = label.lower() if isinstance(label, str) else None
        except Exception as exc:
            print(f"⚠️  Sentiment scoring failed for {ticker}: {exc}")

    return safe_json({"news": formatted, "sentiment": sentiments, "ticker": ticker})


# ── /news/market FIRST (fix #5) ───────────────────────────────────────────────
@app.get("/news/market")
async def get_market_news() -> dict:
    cache_key = "news:market"

    cached = await cache.get(cache_key)
    if cached:
        return {**cached, "cached": True}

    try:
        response = await _get_news_response("MARKET")
        await cache.set(cache_key, response, CACHE_TTL_NEWS)
        return {**response, "cached": False}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Market news failed: {exc}",
        )


@app.get("/news/{ticker}")
async def get_stock_news(
    ticker: str = Path(..., min_length=1, max_length=20),
) -> dict:
    ticker    = _norm(ticker)
    cache_key = f"news:{ticker}"

    cached = await cache.get(cache_key)
    if cached:
        return {**cached, "cached": True}

    try:
        response = await _get_news_response(ticker)
        await cache.set(cache_key, response, CACHE_TTL_NEWS)
        return {**response, "cached": False}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"News fetch failed for {ticker}: {exc}",
        )


# ─────────────────────────────────────────────
# ROUTES — PORTFOLIO
# ─────────────────────────────────────────────

@app.get("/portfolio")
async def get_portfolio() -> list[dict]:
    loop = asyncio.get_event_loop()

    async def _enrich(item: dict) -> dict:
        sym, qty, buy = item["symbol"], item["quantity"], item["price"]
        try:
            fast    = await loop.run_in_executor(None, lambda: yf.Ticker(sym).fast_info)
            current = float(getattr(fast, "last_price", None) or buy)
        except Exception:
            current = buy

        pnl     = round((current - buy) * qty, 4)
        pnl_pct = round(((current - buy) / buy) * 100, 2) if buy else 0.0
        return {
            "symbol":        sym,
            "quantity":      qty,
            "buy_price":     buy,
            "current_price": round(current, 4),
            "pnl":           pnl,
            "pnl_percent":   pnl_pct,
            "added_at":      item.get("added_at"),
        }

    async with _portfolio_lock:
        snapshot = list(_portfolio)

    enriched = await asyncio.gather(*[_enrich(item) for item in snapshot])
    return safe_json(list(enriched))


@app.post("/portfolio/add", status_code=status.HTTP_201_CREATED)
async def add_to_portfolio(item: PortfolioItem) -> dict:
    entry = {
        "symbol":   _norm(item.symbol),
        "quantity": item.quantity,
        "price":    item.price,
        "added_at": time.time(),
    }
    async with _portfolio_lock:
        _portfolio.append(entry)
    return {"message": "Added successfully.", "data": entry}


@app.delete("/portfolio/remove/{symbol}")
async def remove_from_portfolio(
    symbol: str = Path(..., min_length=1, max_length=20),
) -> dict:
    sym = _norm(symbol)
    async with _portfolio_lock:
        before = len(_portfolio)
        _portfolio[:] = [p for p in _portfolio if p["symbol"] != sym]
        removed = before - len(_portfolio)

    if not removed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{sym} not found in portfolio.",
        )
    return {"message": f"{sym} removed successfully."}


# ─────────────────────────────────────────────
# ROUTES — CACHE MANAGEMENT
# ─────────────────────────────────────────────

@app.delete("/cache/{key}")
async def invalidate_cache(key: str) -> dict:
    await cache.invalidate(key)
    return {"message": f"Cache entry '{key}' invalidated."}


@app.get("/cache/stats")
async def cache_stats_route() -> dict:
    return await cache.stats()