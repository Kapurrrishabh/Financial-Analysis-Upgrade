from __future__ import annotations

import json
import logging
import pickle
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
import pandas as pd
from huggingface_hub import hf_hub_download

from backend.utils.preprocessing import future_business_dates, history_payload, normalize_price_frame

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
TRANSFORMER_MODEL_REPO = "Rishabhkapur/financial-analysis-upgrade-transformer"


@dataclass(frozen=True)
class TransformerArtifacts:
    model_dir: Path
    metadata: Dict[str, Any]
    ticker_to_id: Dict[str, int]
    ticker_scalers: Dict[str, Any]
    context_length: int
    prediction_length: int
    history_length: int
    device: str


def _candidate_dirs() -> list[Path]:
    return [
        ROOT / "finintel_ts_transformer" / "exported_assets",
        ROOT / "backend" / "models" / "exported_assets",
    ]


def _load_artifacts_from_hf() -> Optional[TransformerArtifacts]:
    try:
        metadata_path = hf_hub_download(
            repo_id=TRANSFORMER_MODEL_REPO,
            filename="metadata.json",
            repo_type="model",
        )
        ticker_path = hf_hub_download(
            repo_id=TRANSFORMER_MODEL_REPO,
            filename="ticker_encoder.json",
            repo_type="model",
        )
        scalers_path = hf_hub_download(
            repo_id=TRANSFORMER_MODEL_REPO,
            filename="ticker_scalers.pkl",
            repo_type="model",
        )
        model_dir = Path(
            hf_hub_download(
                repo_id=TRANSFORMER_MODEL_REPO,
                filename="model/config.json",
                repo_type="model",
            )
        ).parent
        hf_hub_download(
            repo_id=TRANSFORMER_MODEL_REPO,
            filename="model/model.safetensors",
            repo_type="model",
        )

        metadata = json.loads(Path(metadata_path).read_text(encoding="utf-8"))
        ticker_to_id = json.loads(Path(ticker_path).read_text(encoding="utf-8"))
        with open(scalers_path, "rb") as handle:
            ticker_scalers = pickle.load(handle)

        return TransformerArtifacts(
            model_dir=model_dir,
            metadata=metadata,
            ticker_to_id=ticker_to_id,
            ticker_scalers=ticker_scalers,
            context_length=int(metadata.get("context_length", 60)),
            prediction_length=int(metadata.get("prediction_length", 30)),
            history_length=int(metadata.get("history_length", 67)),
            device="cuda" if _cuda_available() else "cpu",
        )
    except Exception as exc:
        logger.warning("Unable to load transformer artifacts from Hugging Face: %s", exc)
        return None


def _cuda_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False


@lru_cache(maxsize=1)
def _load_artifacts() -> Optional[TransformerArtifacts]:
    for candidate in _candidate_dirs():
        metadata_path = candidate / "metadata.json"
        ticker_path = candidate / "ticker_encoder.json"
        scalers_path = candidate / "ticker_scalers.pkl"
        model_dir = candidate / "model"
        if metadata_path.exists() and ticker_path.exists() and scalers_path.exists() and model_dir.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
                ticker_to_id = json.loads(ticker_path.read_text(encoding="utf-8"))
                with open(scalers_path, "rb") as handle:
                    ticker_scalers = pickle.load(handle)
                return TransformerArtifacts(
                    model_dir=model_dir,
                    metadata=metadata,
                    ticker_to_id=ticker_to_id,
                    ticker_scalers=ticker_scalers,
                    context_length=int(metadata.get("context_length", 60)),
                    prediction_length=int(metadata.get("prediction_length", 30)),
                    history_length=int(metadata.get("history_length", 67)),
                    device="cuda" if _cuda_available() else "cpu",
                )
            except Exception as exc:
                logger.warning("Unable to load transformer artifacts from %s: %s", candidate, exc)
    hf_artifacts = _load_artifacts_from_hf()
    if hf_artifacts is not None:
        return hf_artifacts
    logger.warning("Transformer artifact bundle not found; falling back to deterministic forecast.")
    return None


@lru_cache(maxsize=1)
def _load_model():
    artifacts = _load_artifacts()
    if artifacts is None:
        return None

    try:
        import torch
        from transformers import TimeSeriesTransformerForPrediction

        model = TimeSeriesTransformerForPrediction.from_pretrained(str(artifacts.model_dir))
        model.to(torch.device(artifacts.device))
        model.eval()
        return model
    except Exception as exc:
        logger.warning("Unable to load transformer model: %s", exc)
        return None


def _build_calendar_features(index: pd.DatetimeIndex) -> np.ndarray:
    day_of_week = index.dayofweek.astype(np.float32) / 6.0
    month = (index.month.astype(np.float32) - 1.0) / 11.0
    return np.column_stack([day_of_week, month]).astype(np.float32)


def _fit_or_reuse_scaler(artifacts: Optional[TransformerArtifacts], symbol: str, returns: pd.Series):
    if artifacts is not None:
        scaler = artifacts.ticker_scalers.get(symbol)
        if scaler is not None:
            return scaler

    from sklearn.preprocessing import StandardScaler

    scaler = StandardScaler()
    values = returns.dropna().to_numpy(dtype=np.float32).reshape(-1, 1)
    if len(values) == 0:
        values = np.zeros((1, 1), dtype=np.float32)
    scaler.fit(values)
    return scaler


def _fallback_forecast(price_frame: pd.DataFrame, horizon: int) -> Dict[str, Any]:
    close = price_frame["Close"].astype(np.float64)
    last_close = float(close.iloc[-1])
    log_returns = np.log(close).diff().dropna()
    drift = float(log_returns.tail(20).mean()) if not log_returns.empty else 0.0
    volatility = float(log_returns.tail(20).std()) if not log_returns.empty else 0.01
    horizon = max(1, int(horizon))
    projected_returns = np.clip(drift + np.linspace(0.0, volatility * 0.25, horizon), -0.25, 0.25)
    sequence = last_close * np.exp(np.cumsum(projected_returns))
    future_index = future_business_dates(pd.Timestamp(price_frame.index[-1]), horizon)
    lower = last_close * np.exp(np.cumsum(projected_returns - volatility * 1.96))
    upper = last_close * np.exp(np.cumsum(projected_returns + volatility * 1.96))
    confidence = float(np.clip(1.0 - min(0.9, volatility * 4.0), 0.0, 1.0))
    return {
        "sequence": sequence.tolist(),
        "curve": [{"time": ts.isoformat(), "predicted": round(float(value), 4)} for ts, value in zip(future_index, sequence)],
        "confidence": {
            "score": round(confidence, 4),
            "mean": sequence.tolist(),
            "lower": lower.tolist(),
            "upper": upper.tolist(),
            "average_band_width_pct": round(float(np.mean((upper - lower) / (sequence + 1e-9))), 4),
        },
        "forecast_close": sequence.tolist(),
        "future_dates": [ts.isoformat() for ts in future_index],
    }


def forecast_prices(symbol: str, price_frame: pd.DataFrame, horizon: int = 5) -> Dict[str, Any]:
    normalized = normalize_price_frame(price_frame)
    if normalized.empty:
        raise ValueError(f"No market data available for {symbol}.")

    artifacts = _load_artifacts()
    model = _load_model()
    horizon = max(1, int(horizon))
    output_horizon = min(horizon, int(artifacts.prediction_length) if artifacts else horizon)

    history = normalized.tail(int(artifacts.history_length) if artifacts else min(len(normalized), 67)).copy()
    if len(history) < 20:
        raise ValueError(f"Not enough historical data to forecast {symbol}.")

    if model is None or artifacts is None:
        forecast = _fallback_forecast(normalized, output_horizon)
        forecast["history"] = history_payload(normalized)
        forecast["last_close"] = round(float(normalized["Close"].iloc[-1]), 4)
        forecast["symbol"] = symbol
        forecast["period"] = None
        forecast["model_loaded"] = False
        return forecast

    try:
        import torch

        close = normalized["Close"].astype(np.float64)
        log_returns = np.log(close).diff().fillna(0.0)
        scaler = _fit_or_reuse_scaler(artifacts, symbol, log_returns)

        history_index = pd.DatetimeIndex(history.index)
        # Use full prediction_length for future, not output_horizon (model needs this internally)
        future_index = future_business_dates(pd.Timestamp(normalized.index[-1]), artifacts.prediction_length)
        
        # Compute log returns WITHOUT diff to keep same length as history
        close_prices = history["Close"].astype(np.float64)
        history_returns = np.log(close_prices / close_prices.shift(1)).fillna(0.0)
        history_scaled = scaler.transform(history_returns.to_numpy(dtype=np.float32).reshape(-1, 1)).reshape(-1)
        history_time_features = _build_calendar_features(history_index)
        
        # Both should now have the same length (67). Verify before passing to model.
        assert len(history_scaled) == history_time_features.shape[0], \
            f"Mismatch: history_scaled {len(history_scaled)} vs history_time_features {history_time_features.shape[0]}"
        
        last_close = float(close_prices.iloc[-1])
        # Generate future time features for FULL prediction_length, not output_horizon
        future_time_features = _build_calendar_features(future_index)

        model_inputs = {
            "past_values": torch.tensor(history_scaled, dtype=torch.float32, device=artifacts.device).unsqueeze(0),
            "past_time_features": torch.tensor(history_time_features, dtype=torch.float32, device=artifacts.device).unsqueeze(0),
            "future_time_features": torch.tensor(future_time_features, dtype=torch.float32, device=artifacts.device).unsqueeze(0),
            "past_observed_mask": torch.ones((1, len(history_scaled)), dtype=torch.float32, device=artifacts.device),
            "static_categorical_features": torch.tensor([[artifacts.ticker_to_id.get(symbol, 0)]], dtype=torch.long, device=artifacts.device),
        }

        # Debug: log shapes
        logger.info(f"Model input shapes for {symbol}:")
        logger.info(f"  past_values: {model_inputs['past_values'].shape}")
        logger.info(f"  past_time_features: {model_inputs['past_time_features'].shape}")
        logger.info(f"  future_time_features: {model_inputs['future_time_features'].shape}")
        logger.info(f"  output_horizon: {output_horizon}")

        with torch.no_grad():
            generated = model.generate(
                past_values=model_inputs["past_values"],
                past_time_features=model_inputs["past_time_features"],
                future_time_features=model_inputs["future_time_features"],
                past_observed_mask=model_inputs["past_observed_mask"],
                static_categorical_features=model_inputs["static_categorical_features"],
            )

        sequences = generated.sequences.detach().cpu().numpy()
        if sequences.ndim == 3:
            sequences = sequences[:, 0, :]
        if sequences.ndim == 1:
            sequences = sequences[np.newaxis, :]

        sampled_returns = scaler.inverse_transform(sequences.reshape(-1, 1)).reshape(sequences.shape)
        sampled_prices = last_close * np.exp(np.cumsum(sampled_returns, axis=1))
        mean_prices = sampled_prices.mean(axis=0)[:output_horizon]
        lower_prices = np.percentile(sampled_prices, 2.5, axis=0)[:output_horizon]
        upper_prices = np.percentile(sampled_prices, 97.5, axis=0)[:output_horizon]
        confidence_score = float(np.clip(1.0 - np.mean((upper_prices - lower_prices) / (mean_prices + 1e-9)) / 2.0, 0.0, 1.0))

        return {
            "symbol": symbol,
            "period": None,
            "model_loaded": True,
            "history": history_payload(normalized),
            "sequence": mean_prices.tolist(),
            "forecast_close": mean_prices.tolist(),
            "curve": [{"time": ts.isoformat(), "predicted": round(float(value), 4)} for ts, value in zip(future_index, mean_prices)],
            "confidence": {
                "score": round(confidence_score, 4),
                "mean": mean_prices.tolist(),
                "lower": lower_prices.tolist(),
                "upper": upper_prices.tolist(),
                "average_band_width_pct": round(float(np.mean((upper_prices - lower_prices) / (mean_prices + 1e-9))), 4),
            },
            "future_dates": [ts.isoformat() for ts in future_index],
            "last_close": round(last_close, 4),
        }
    except Exception as exc:
        logger.warning("Transformer inference failed for %s: %s", symbol, exc)
        forecast = _fallback_forecast(normalized, output_horizon)
        forecast["history"] = history_payload(normalized)
        forecast["last_close"] = round(float(normalized["Close"].iloc[-1]), 4)
        forecast["symbol"] = symbol
        forecast["period"] = None
        forecast["model_loaded"] = False
        forecast["fallback_reason"] = str(exc)
        return forecast


__all__ = ["forecast_prices"]
