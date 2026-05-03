"""
Stock Data Scraper for FinIntel-Engine
Fetches OHLCV data from yfinance and adds technical indicators.
Used by the technical model for stock classification (Buy/Hold/Sell).

Optimizations over v1:
  - Batch yfinance download (single HTTP round-trip for multiple tickers)
  - ThreadPoolExecutor for parallel per-ticker feature computation
  - pandas_ta Strategy (single-pass indicator computation per DataFrame)
  - Module-level yfinance import (no repeated importlib overhead)
  - Lazy date defaults computed once at call-time, not instance creation
  - adx_14 extracted from the ADX result frame instead of a second ta.adx call
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import pandas_ta as ta
import yfinance as yf

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────

TECHNICAL_FEATURES: List[str] = [
    "rsi_5", "rsi_10", "rsi_14", "rsi_15",
    "roc_10", "mom_10",
    "STOCHRSIk_14_14_3_3", "STOCHRSId_14_14_3_3",
    "cci_20", "wr_14",
    "KST_10_15_20_30_10_10_10_15", "KSTs_9",
    "MACD_12_26_9", "MACDh_12_26_9", "MACDs_12_26_9",
    "sma_5", "ema_5", "sma_10", "ema_10", "sma_20", "ema_20",
    "vwma_20",
    "BBL_20_2.0_2.0", "BBM_20_2.0_2.0", "BBU_20_2.0_2.0",
    "BBB_20_2.0_2.0", "BBP_20_2.0_2.0",
    "KC_20_2", "KCL_20_2", "KCB_20_2", "KCUe_20_2",
    "adr_14",
    "obv", "vpt",
    "ad", "adx_14",
]

STOCK_LIST: List[str] = [
    # Tech
    "AAPL", "MSFT", "NVDA", "AVGO", "ADBE", "CRM", "CSCO", "IBM", "INTC", "INTU",
    "ORCL", "QCOM", "TXN", "AMD", "NOW", "PLTR", "MU", "PANW", "AMAT", "LRCX",
    # Internet/Media
    "GOOGL", "GOOG", "META", "DIS", "NFLX", "T", "VZ", "CMCSA", "TMUS", "CHTR",
    # Finance
    "JPM", "BAC", "WFC", "GS", "MS", "AXP", "V", "MA", "BRK-B", "BLK",
    "C", "COF", "SCHW", "MET", "PYPL",
    # Healthcare
    "JNJ", "UNH", "LLY", "ABBV", "PFE", "MRK", "TMO", "ABT", "DHR", "MDT",
    "GILD", "BMY", "ISRG", "AMGN", "CVS",
    # Retail/Consumer
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TGT", "BKNG",
    # Industrial
    "GM", "ABNB", "F", "BA", "CAT", "HON", "GE", "UNP", "UPS", "LMT",
    "RTX", "FDX", "DE", "MMM", "EMR", "GD",
    # Consumer Staples
    "PG", "KO", "PEP", "COST",
]

# pandas_ta Strategy — computes all indicators in a single pass per DataFrame.
# Defining it once at module level avoids rebuilding it on every call.
_TA_STRATEGY = ta.Strategy(
    name="fintel_38",
    ta=[
        {"kind": "rsi",      "length": 5,  "col_names": ("rsi_5",)},
        {"kind": "rsi",      "length": 10, "col_names": ("rsi_10",)},
        {"kind": "rsi",      "length": 14, "col_names": ("rsi_14",)},
        {"kind": "rsi",      "length": 15, "col_names": ("rsi_15",)},
        {"kind": "roc",      "length": 10, "col_names": ("roc_10",)},
        {"kind": "mom",      "length": 10, "col_names": ("mom_10",)},
        {"kind": "stochrsi", "length": 14, "rsi_length": 14, "k": 3, "d": 3},
        {"kind": "cci",      "length": 20, "col_names": ("cci_20",)},
        {"kind": "willr",    "length": 14, "col_names": ("wr_14",)},
        {"kind": "kst",      "roc1": 10, "roc2": 15, "roc3": 20, "roc4": 30,
                              "signal": 9},
        {"kind": "macd",     "fast": 12, "slow": 26, "signal": 9},
        {"kind": "sma",      "length": 5,  "col_names": ("sma_5",)},
        {"kind": "ema",      "length": 5,  "col_names": ("ema_5",)},
        {"kind": "sma",      "length": 10, "col_names": ("sma_10",)},
        {"kind": "ema",      "length": 10, "col_names": ("ema_10",)},
        {"kind": "sma",      "length": 20, "col_names": ("sma_20",)},
        {"kind": "ema",      "length": 20, "col_names": ("ema_20",)},
        {"kind": "vwma",     "length": 20, "col_names": ("vwma_20",)},
        {"kind": "bbands",   "length": 20, "std": 2.0},
        {"kind": "kc",       "length": 20, "scalar": 2},
        {"kind": "atr",      "length": 14, "col_names": ("adr_14",)},
        {"kind": "obv",      "col_names": ("obv",)},
        {"kind": "vpt",      "col_names": ("vpt",)},
        {"kind": "ad",       "col_names": ("ad",)},
        {"kind": "adx",      "length": 14},
    ],
)

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _default_date_range() -> Tuple[str, str]:
    today = datetime.now()
    return (today - timedelta(days=730)).strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")


def _flatten_multiindex(df: pd.DataFrame) -> pd.DataFrame:
    """Drop the ticker level from a MultiIndex column frame returned by yfinance."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _add_technical_features(df: pd.DataFrame, ticker: str = "") -> pd.DataFrame:
    """
    Compute all 38 technical indicators in a single pandas_ta strategy pass.

    Column-name fixes are applied post-hoc for the few indicators whose
    default names differ from the model's expected names.
    """
    df = df.copy()
    df.columns = df.columns.str.capitalize()

    # Run every indicator in one pass
    df.ta.strategy(_TA_STRATEGY)

    # ── Rename columns that pandas_ta names differently from our schema ──

    # StochRSI → STOCHRSIk_14_14_3_3 / STOCHRSId_14_14_3_3
    srsi_k = next((c for c in df.columns if c.startswith("STOCHRSIk")), None)
    srsi_d = next((c for c in df.columns if c.startswith("STOCHRSId")), None)
    if srsi_k and srsi_k != "STOCHRSIk_14_14_3_3":
        df.rename(columns={srsi_k: "STOCHRSIk_14_14_3_3"}, inplace=True)
    if srsi_d and srsi_d != "STOCHRSId_14_14_3_3":
        df.rename(columns={srsi_d: "STOCHRSId_14_14_3_3"}, inplace=True)

    # KST
    kst_val = next((c for c in df.columns if c.startswith("KST_") and "s" not in c.lower()), None)
    kst_sig = next((c for c in df.columns if c.startswith("KSTs")), None)
    if kst_val and kst_val != "KST_10_15_20_30_10_10_10_15":
        df.rename(columns={kst_val: "KST_10_15_20_30_10_10_10_15"}, inplace=True)
    if kst_sig and kst_sig != "KSTs_9":
        df.rename(columns={kst_sig: "KSTs_9"}, inplace=True)

    # MACD: pandas_ta emits MACD_12_26_9, MACDh_12_26_9, MACDs_12_26_9 — usually fine.

    # Bollinger Bands: pandas_ta uses BBL_20_2.0, BBM_20_2.0, BBU_20_2.0,
    # BBB_20_2.0, BBP_20_2.0 — rename to include the trailing "_2.0".
    for stub, target in [
        ("BBL_20_2.0", "BBL_20_2.0_2.0"),
        ("BBM_20_2.0", "BBM_20_2.0_2.0"),
        ("BBU_20_2.0", "BBU_20_2.0_2.0"),
        ("BBB_20_2.0", "BBB_20_2.0_2.0"),
        ("BBP_20_2.0", "BBP_20_2.0_2.0"),
    ]:
        if stub in df.columns and target not in df.columns:
            df.rename(columns={stub: target}, inplace=True)

    # Keltner Channel
    for stub, target in [
        ("KCL_20_2", "KCL_20_2"),
        ("KCM_20_2", "KC_20_2"),
        ("KCU_20_2", "KCUe_20_2"),
        ("KCB_20_2", "KCB_20_2"),
    ]:
        if stub in df.columns and target not in df.columns:
            df.rename(columns={stub: target}, inplace=True)

    # ADX: pandas_ta emits ADX_14, DMP_14, DMN_14; we only need adx_14
    adx_col = next((c for c in df.columns if c.upper().startswith("ADX_")), None)
    if adx_col and adx_col != "adx_14":
        df.rename(columns={adx_col: "adx_14"}, inplace=True)
    # Drop DMP/DMN if present
    df.drop(columns=[c for c in df.columns if c.startswith(("DMP_", "DMN_"))],
            inplace=True, errors="ignore")

    logger.debug("Technical features added for %s", ticker or "stock")
    return df


# ──────────────────────────────────────────────
# Public API — module-level functions
# (used by complete_pipeline.py via dynamic import)
# ──────────────────────────────────────────────

def fetch_price_data(ticker: str, period: str = "2y") -> pd.DataFrame:
    """Fetch raw OHLCV data for a single ticker (pipeline-compatible interface)."""
    try:
        df = yf.download(ticker, period=period, progress=False, repair=True)
        df = _flatten_multiindex(df)
        if df.empty:
            logger.warning("No price data for %s", ticker)
            return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        return df[["Open", "High", "Low", "Close", "Volume"]]
    except Exception as exc:
        logger.exception("fetch_price_data failed for %s: %s", ticker, exc)
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def run_technical_model(price_df: pd.DataFrame) -> Optional[dict]:
    """
    Thin shim called by complete_pipeline.run_technical_model.
    Loads the GRU model and returns {technical_score, signal, confidence}.
    Returns None to signal the pipeline to use its own fallback.
    """
    # Import here to avoid mandatory keras dependency at module load time.
    try:
        import json
        from pathlib import Path

        import numpy as np
        import tensorflow as tf  # type: ignore

        root = Path(__file__).resolve().parents[2]
        model_path   = root / "models" / "technical_model" / "gru_stock_classifier-2.keras"
        feature_path = root / "models" / "technical_model" / "feature_columns.json"

        if not model_path.exists() or not feature_path.exists():
            return None

        with open(feature_path) as f:
            feature_cols = json.load(f)

        model = tf.keras.models.load_model(str(model_path))

        df_feat = _add_technical_features(price_df).dropna(subset=feature_cols)
        if df_feat.empty or len(df_feat) < 30:
            return None

        X = df_feat[feature_cols].values[-30:].reshape(1, 30, len(feature_cols))
        probs = model.predict(X, verbose=0)[0]           # [sell, hold, buy]
        pred  = int(np.argmax(probs))
        score = float(probs[2])                          # P(BUY)
        signal_map = {0: "SELL", 1: "HOLD", 2: "BUY"}
        confidence = "high" if max(probs) > 0.7 else ("medium" if max(probs) > 0.5 else "low")

        return {
            "technical_score": score,
            "signal": signal_map[pred],
            "confidence": confidence,
            "probabilities": probs.tolist(),
        }
    except Exception as exc:
        logger.warning("run_technical_model failed: %s", exc)
        return None


# ──────────────────────────────────────────────
# StockScraper class (batch training / data-prep use)
# ──────────────────────────────────────────────

class StockScraper:
    """
    Fetches OHLCV data from yfinance and computes 38 technical indicators.

    For single-ticker lookups the pipeline should call `fetch_price_data`
    directly.  This class is designed for bulk training-data generation.
    """

    TECHNICAL_FEATURES = TECHNICAL_FEATURES
    STOCK_LIST         = STOCK_LIST

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date:   Optional[str] = None,
        max_workers: int = 8,
    ) -> None:
        default_start, default_end = _default_date_range()
        self.start_date  = start_date or default_start
        self.end_date    = end_date   or default_end
        self.max_workers = max_workers
        self._cache: Dict[str, pd.DataFrame] = {}
        logger.info("StockScraper initialised: %s → %s", self.start_date, self.end_date)

    # ── Fetching ──────────────────────────────

    def fetch_stock_data(self, ticker: str) -> Optional[pd.DataFrame]:
        """Fetch OHLCV for one ticker (single HTTP call)."""
        if ticker in self._cache:
            return self._cache[ticker].copy()
        try:
            df = yf.download(
                ticker,
                start=self.start_date,
                end=self.end_date,
                progress=False,
                repair=True,
            )
            df = _flatten_multiindex(df)
            if df.empty:
                logger.warning("No data for %s", ticker)
                return None
            df["Ticker"] = ticker
            self._cache[ticker] = df
            logger.info("Fetched %d rows for %s", len(df), ticker)
            return df.copy()
        except Exception as exc:
            logger.error("Error fetching %s: %s", ticker, exc)
            return None

    def fetch_multiple_stocks(
        self, tickers: Optional[List[str]] = None
    ) -> Dict[str, pd.DataFrame]:
        """
        Batch-download multiple tickers in a *single* yfinance call,
        then split the result per ticker.  Falls back to per-ticker
        downloads for any tickers that return no data.
        """
        tickers = tickers or self.STOCK_LIST
        uncached = [t for t in tickers if t not in self._cache]

        if uncached:
            try:
                raw = yf.download(
                    uncached,
                    start=self.start_date,
                    end=self.end_date,
                    progress=False,
                    repair=True,
                    group_by="ticker",
                )
                for ticker in uncached:
                    try:
                        df = raw[ticker].dropna(how="all")
                        if not df.empty:
                            df = _flatten_multiindex(df.copy())
                            df["Ticker"] = ticker
                            self._cache[ticker] = df
                    except KeyError:
                        pass  # will retry individually below
            except Exception as exc:
                logger.warning("Batch download failed, retrying individually: %s", exc)

            # Retry any still-missing tickers individually
            missing = [t for t in uncached if t not in self._cache]
            for ticker in missing:
                self.fetch_stock_data(ticker)

        result = {t: self._cache[t].copy() for t in tickers if t in self._cache}
        logger.info("Fetched %d/%d tickers", len(result), len(tickers))
        return result

    # ── Feature computation ───────────────────

    @staticmethod
    def add_technical_features(
        df: pd.DataFrame, ticker: Optional[str] = None
    ) -> pd.DataFrame:
        return _add_technical_features(df, ticker or "")

    # ── Combined fetch + features ─────────────

    def process_stock(self, ticker: str) -> Optional[pd.DataFrame]:
        df = self.fetch_stock_data(ticker)
        return _add_technical_features(df, ticker) if df is not None else None

    def process_multiple_stocks(
        self, tickers: Optional[List[str]] = None
    ) -> Dict[str, pd.DataFrame]:
        """
        Batch-fetch all tickers (one HTTP call), then compute indicators
        for each ticker in parallel using a thread pool.
        """
        tickers = tickers or self.STOCK_LIST
        raw_data = self.fetch_multiple_stocks(tickers)

        processed: Dict[str, pd.DataFrame] = {}

        def _compute(ticker: str, df: pd.DataFrame):
            return ticker, _add_technical_features(df, ticker)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(_compute, t, df): t
                for t, df in raw_data.items()
            }
            for future in as_completed(futures):
                try:
                    ticker, result_df = future.result()
                    processed[ticker] = result_df
                except Exception as exc:
                    logger.error("Feature computation failed for %s: %s",
                                 futures[future], exc)

        logger.info("Processed %d/%d tickers", len(processed), len(tickers))
        return processed

    # ── I/O ──────────────────────────────────

    def save_to_csv(
        self, data: Dict[str, pd.DataFrame], output_dir: str = "stock_data"
    ) -> None:
        os.makedirs(output_dir, exist_ok=True)
        for ticker, df in data.items():
            path = os.path.join(output_dir, f"{ticker}_data.csv")
            df.to_csv(path)
            logger.info("Saved %s → %s", ticker, path)

    def get_cached_data(self, ticker: str) -> Optional[pd.DataFrame]:
        return self._cache.get(ticker)


# ──────────────────────────────────────────────
# CLI demo
# ──────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    scraper = StockScraper(start_date="2022-01-01", end_date="2024-12-31")

    print("\n── Single stock ──")
    aapl = scraper.process_stock("AAPL")
    if aapl is not None:
        print(f"Shape: {aapl.shape}")
        print(aapl[TECHNICAL_FEATURES].tail(3))

    print("\n── Batch (5 tickers) ──")
    batch = scraper.process_multiple_stocks(["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"])
    print(f"Processed {len(batch)} tickers")

    print("\n── Save ──")
    scraper.save_to_csv(batch, output_dir="backend/datasets/technical_dataset/raw_data")