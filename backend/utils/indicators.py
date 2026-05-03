from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Tuple

import numpy as np


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(numeric):
        return default
    return numeric


def safe_ratio(numerator: float, denominator: float) -> float:
    denominator = float(denominator)
    if denominator == 0 or not np.isfinite(denominator):
        return 0.0
    value = float(numerator) / denominator
    return value if np.isfinite(value) else 0.0


def normalize_series(values: Iterable[float]) -> np.ndarray:
    array = np.asarray(list(values), dtype=np.float64)
    array = array[np.isfinite(array)]
    if array.size == 0:
        return np.zeros(1, dtype=np.float64)
    mean = float(np.mean(array))
    std = float(np.std(array)) or 1.0
    return (array - mean) / std


def linear_fit(values: Iterable[float]) -> Tuple[float, float]:
    array = np.asarray(list(values), dtype=np.float64)
    array = array[np.isfinite(array)]
    if array.size < 2:
        return 0.0, float(array[0]) if array.size else 0.0
    x = np.arange(array.size, dtype=np.float64)
    slope, intercept = np.polyfit(x, array, 1)
    return float(slope), float(intercept)


def rolling_slope(values: Iterable[float]) -> float:
    slope, _ = linear_fit(values)
    return slope


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    left_array = normalize_series(left)
    right_array = normalize_series(right)
    length = min(left_array.size, right_array.size)
    if length == 0:
        return 0.0
    left_slice = left_array[-length:]
    right_slice = right_array[-length:]
    denominator = float(np.linalg.norm(left_slice) * np.linalg.norm(right_slice))
    if denominator == 0 or not np.isfinite(denominator):
        return 0.0
    value = float(np.dot(left_slice, right_slice) / denominator)
    return float(np.clip(value, -1.0, 1.0))


@dataclass(frozen=True)
class Extremes:
    peaks: np.ndarray
    troughs: np.ndarray


def local_extremes(values: Iterable[float], min_distance: int = 4) -> Extremes:
    array = np.asarray(list(values), dtype=np.float64)
    array = array[np.isfinite(array)]
    if array.size < 3:
        empty = np.array([], dtype=int)
        return Extremes(peaks=empty, troughs=empty)

    try:
        from scipy.signal import find_peaks

        peaks, _ = find_peaks(array, distance=max(1, int(min_distance)))
        troughs, _ = find_peaks(-array, distance=max(1, int(min_distance)))
        return Extremes(peaks=peaks, troughs=troughs)
    except Exception:
        peaks = []
        troughs = []
        for index in range(1, array.size - 1):
            if array[index] >= array[index - 1] and array[index] >= array[index + 1]:
                peaks.append(index)
            if array[index] <= array[index - 1] and array[index] <= array[index + 1]:
                troughs.append(index)
        return Extremes(peaks=np.asarray(peaks, dtype=int), troughs=np.asarray(troughs, dtype=int))
