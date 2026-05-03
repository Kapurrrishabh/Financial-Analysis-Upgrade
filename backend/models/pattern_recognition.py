from __future__ import annotations

import threading
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Mapping, Sequence

import numpy as np

from backend.utils.indicators import cosine_similarity, normalize_series, rolling_slope
from backend.utils.preprocessing import price_frame_fingerprint, to_builtin


_CACHE_LOCK = threading.Lock()
_PATTERN_CACHE: Dict[str, Dict[str, Any]] = {}
_HISTORICAL_TEMPLATES: Dict[str, Deque[np.ndarray]] = defaultdict(lambda: deque(maxlen=24))


def _as_series(price_series: Sequence[float] | Mapping[str, Any] | np.ndarray) -> np.ndarray:
    if isinstance(price_series, Mapping):
        if "close" in price_series:
            price_series = price_series["close"]
        elif "prices" in price_series:
            price_series = price_series["prices"]
        elif "series" in price_series:
            price_series = price_series["series"]

    values = np.asarray(price_series, dtype=np.float64)
    if values.ndim > 1:
        values = values.reshape(-1)
    values = values[np.isfinite(values)]
    if values.size < 4:
        return np.asarray([], dtype=np.float64)
    return values


def _candidate_levels(values: np.ndarray, peaks: np.ndarray, troughs: np.ndarray) -> Dict[str, float]:
    support = float(np.min(values))
    resistance = float(np.max(values))
    if troughs.size:
        support = float(np.median(values[troughs]))
    if peaks.size:
        resistance = float(np.median(values[peaks]))
    return {"support": round(support, 4), "resistance": round(resistance, 4)}


def _swing_points(values: np.ndarray, window: int | None = None) -> Dict[str, np.ndarray]:
    """Return meaningful swing highs/lows using a local window around each bar."""
    size = int(values.size)
    if size < 7:
        empty = np.array([], dtype=int)
        return {"peaks": empty, "troughs": empty}

    if window is None:
        window = int(np.clip(size // 30, 3, 5))
    window = max(3, min(5, int(window)))
    if size <= window * 2:
        empty = np.array([], dtype=int)
        return {"peaks": empty, "troughs": empty}

    peaks: List[int] = []
    troughs: List[int] = []

    for index in range(window, size - window):
        segment = values[index - window : index + window + 1]
        center = values[index]
        if not np.isfinite(center):
            continue
        if center == np.max(segment) and np.sum(segment == center) == 1:
            peaks.append(index)
        if center == np.min(segment) and np.sum(segment == center) == 1:
            troughs.append(index)

    return {
        "peaks": _prune_swing_points(np.asarray(peaks, dtype=int), values, is_peak=True, min_gap=window),
        "troughs": _prune_swing_points(np.asarray(troughs, dtype=int), values, is_peak=False, min_gap=window),
    }


def _prune_swing_points(indices: np.ndarray, values: np.ndarray, *, is_peak: bool, min_gap: int) -> np.ndarray:
    if indices.size < 2:
        return indices

    ordered = np.sort(np.unique(indices.astype(int)))
    selected: List[int] = [int(ordered[0])]

    for index in ordered[1:]:
        last = selected[-1]
        if index - last <= min_gap:
            last_value = float(values[last])
            current_value = float(values[index])
            if (is_peak and current_value > last_value) or (not is_peak and current_value < last_value):
                selected[-1] = int(index)
            continue
        selected.append(int(index))

    return np.asarray(selected, dtype=int)


def _line_from_points(indices: np.ndarray, values: np.ndarray) -> Dict[str, Any]:
    if indices.size < 2:
        return {}

    try:
        x = indices.astype(np.float64)
        y = values[indices].astype(np.float64)
        slope, intercept = np.polyfit(x, y, 1)
        x_start, x_end = float(x[0]), float(x[-1])
        y_start = float(slope * x_start + intercept)
        y_end = float(slope * x_end + intercept)
        return {
            "slope": float(slope),
            "intercept": float(intercept),
            "points": [
                {"x": round(x_start, 4), "y": round(y_start, 4)},
                {"x": round(x_end, 4), "y": round(y_end, 4)},
            ],
        }
    except Exception:
        return {}


def _line_value(line: Mapping[str, Any], x: float) -> float:
    slope = float(line.get("slope", 0.0) or 0.0)
    intercept = float(line.get("intercept", 0.0) or 0.0)
    return float(slope * x + intercept)


def _line_gap(start_x: float, end_x: float, support_line: Mapping[str, Any], resistance_line: Mapping[str, Any]) -> tuple[float, float]:
    return (
        float(_line_value(resistance_line, start_x) - _line_value(support_line, start_x)),
        float(_line_value(resistance_line, end_x) - _line_value(support_line, end_x)),
    )


def _line_is_flat(slope: float, price_norm: float) -> bool:
    return abs(float(slope)) <= price_norm * 0.0015


def _validate_geometry(name: str, support_line: Mapping[str, Any], resistance_line: Mapping[str, Any], values: np.ndarray) -> bool:
    if not support_line or not resistance_line:
        return False

    support_slope = float(support_line.get("slope", 0.0) or 0.0)
    resistance_slope = float(resistance_line.get("slope", 0.0) or 0.0)
    price_norm = float(np.mean(np.abs(values))) or 1.0
    start_x = float(min(support_line["points"][0]["x"], resistance_line["points"][0]["x"]))
    end_x = float(max(support_line["points"][-1]["x"], resistance_line["points"][-1]["x"]))
    start_gap, end_gap = _line_gap(start_x, end_x, support_line, resistance_line)
    converging = end_gap < start_gap * 0.95
    parallel_gap = abs(abs(support_slope) - abs(resistance_slope)) <= price_norm * 0.0006

    if name == "Falling Wedge":
        return (
            support_slope < 0
            and resistance_slope < 0
            and abs(support_slope) > abs(resistance_slope)
            and converging
        )

    if name == "Rising Wedge":
        return (
            support_slope > 0
            and resistance_slope > 0
            and abs(resistance_slope) > abs(support_slope)
            and converging
        )

    if name == "Ascending Triangle":
        return _line_is_flat(resistance_slope, price_norm) and support_slope > 0 and converging

    if name == "Descending Triangle":
        return _line_is_flat(support_slope, price_norm) and resistance_slope < 0 and converging

    if name == "Symmetrical Triangle":
        return support_slope > 0 and resistance_slope < 0 and converging

    if name == "Channel Up":
        return support_slope > 0 and resistance_slope > 0 and parallel_gap and not converging

    if name == "Channel Down":
        return support_slope < 0 and resistance_slope < 0 and parallel_gap and not converging

    if name == "Rectangle":
        return _line_is_flat(support_slope, price_norm) and _line_is_flat(resistance_slope, price_norm)

    if name in {"Double Top", "Double Bottom", "Triple Top", "Triple Bottom", "Head and Shoulders", "Inverse Head and Shoulders", "Flag", "Pennant"}:
        return True

    return False


def _fit_extrema_trend(values: np.ndarray, extrema: np.ndarray) -> float:
    if extrema.size < 2:
        return 0.0
    x = extrema.astype(np.float64)
    y = values[extrema]
    slope = np.polyfit(x, y, 1)[0]
    return float(slope)


def _range_contraction(values: np.ndarray) -> float:
    if values.size < 8:
        return 0.0
    first = values[: values.size // 2]
    second = values[values.size // 2 :]
    first_range = float(np.max(first) - np.min(first)) if first.size else 0.0
    second_range = float(np.max(second) - np.min(second)) if second.size else 0.0
    if first_range == 0:
        return 0.0
    return float(np.clip((first_range - second_range) / abs(first_range), -1.0, 1.0))


def _extract_line_points(line: Mapping[str, Any]) -> List[Dict[str, float]]:
    points = line.get("points") if line else None
    if not points:
        return []
    return [
        {"x": float(point["x"]), "y": float(point["y"])}
        for point in points
        if isinstance(point, Mapping) and "x" in point and "y" in point
    ]


def _build_trendlines(values: np.ndarray, peaks: np.ndarray, troughs: np.ndarray) -> Dict[str, Any]:
    support_line = _line_from_points(troughs, values)
    resistance_line = _line_from_points(peaks, values)
    lines: Dict[str, Any] = {}
    if support_line:
        support_points = _extract_line_points(support_line)
        if support_points:
            lines["support"] = support_points
    if resistance_line:
        resistance_points = _extract_line_points(resistance_line)
        if resistance_points:
            lines["resistance"] = resistance_points
    return lines


def _pattern_geometry_valid(pattern: str, values: np.ndarray, peaks: np.ndarray, troughs: np.ndarray) -> tuple[bool, Dict[str, Any]]:
    support_line = _line_from_points(troughs, values)
    resistance_line = _line_from_points(peaks, values)
    if not support_line or not resistance_line:
        return False, {}

    support_points = _extract_line_points(support_line)
    resistance_points = _extract_line_points(resistance_line)
    if len(support_points) < 2 or len(resistance_points) < 2:
        return False, {}

    support_slope = float(support_line.get("slope", 0.0) or 0.0)
    resistance_slope = float(resistance_line.get("slope", 0.0) or 0.0)
    price_norm = float(np.mean(np.abs(values))) or 1.0
    start_x = float(min(support_points[0]["x"], resistance_points[0]["x"]))
    end_x = float(max(support_points[-1]["x"], resistance_points[-1]["x"]))
    start_gap, end_gap = _line_gap(start_x, end_x, support_line, resistance_line)
    converging = end_gap < start_gap * 0.95

    if pattern == "Falling Wedge":
        valid = support_slope < 0 and resistance_slope < 0 and abs(support_slope) > abs(resistance_slope) and converging
    elif pattern == "Rising Wedge":
        valid = support_slope > 0 and resistance_slope > 0 and abs(resistance_slope) > abs(support_slope) and converging
    elif pattern == "Ascending Triangle":
        valid = _line_is_flat(resistance_slope, price_norm) and support_slope > 0 and converging
    elif pattern == "Descending Triangle":
        valid = _line_is_flat(support_slope, price_norm) and resistance_slope < 0 and converging
    elif pattern == "Symmetrical Triangle":
        valid = support_slope > 0 and resistance_slope < 0 and converging
    elif pattern == "Channel Up":
        valid = support_slope > 0 and resistance_slope > 0 and abs(abs(support_slope) - abs(resistance_slope)) <= price_norm * 0.0006 and not converging
    elif pattern == "Channel Down":
        valid = support_slope < 0 and resistance_slope < 0 and abs(abs(support_slope) - abs(resistance_slope)) <= price_norm * 0.0006 and not converging
    elif pattern == "Rectangle":
        valid = _line_is_flat(support_slope, price_norm) and _line_is_flat(resistance_slope, price_norm)
    else:
        valid = True

    return valid, {"support": support_points, "resistance": resistance_points}


def _score_candidate(name: str, values: np.ndarray, peaks: np.ndarray, troughs: np.ndarray) -> Dict[str, Any] | None:
    if values.size < 8:
        return None

    overall_slope = rolling_slope(values)
    peak_slope = _fit_extrema_trend(values, peaks)
    trough_slope = _fit_extrema_trend(values, troughs)
    range_contraction = _range_contraction(values)
    price_norm = float(np.mean(np.abs(values))) or 1.0
    volatility = float(np.std(np.diff(values)) / price_norm) if values.size > 2 else 0.0
    levels = _candidate_levels(values, peaks, troughs)

    if name == "Ascending Triangle":
        flat_resistance = abs(peak_slope) <= abs(overall_slope) * 0.2 + price_norm * 0.001
        rising_support = trough_slope > abs(overall_slope) * 0.15
        if flat_resistance and rising_support:
            confidence = np.clip(0.56 + 0.18 * range_contraction + 0.16 * min(1.0, abs(trough_slope) / (price_norm * 0.02 + 1e-9)), 0.0, 0.95)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}

    if name == "Descending Triangle":
        flat_support = abs(trough_slope) <= abs(overall_slope) * 0.2 + price_norm * 0.001
        falling_resistance = peak_slope < -abs(overall_slope) * 0.15
        if flat_support and falling_resistance:
            confidence = np.clip(0.56 + 0.18 * range_contraction + 0.16 * min(1.0, abs(peak_slope) / (price_norm * 0.02 + 1e-9)), 0.0, 0.95)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}

    if name == "Symmetrical Triangle":
        converging = peak_slope < 0 < trough_slope and abs(peak_slope) > abs(trough_slope) * 0.35
        if converging and range_contraction > 0:
            confidence = np.clip(0.55 + 0.2 * abs(range_contraction) + 0.1 * (1.0 - min(1.0, abs(overall_slope) / (price_norm * 0.03 + 1e-9))), 0.0, 0.92)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "neutral", "key_levels": levels}

    if name == "Channel Up":
        parallel = overall_slope > 0 and peak_slope > 0 and trough_slope > 0 and abs(peak_slope - trough_slope) <= max(abs(peak_slope), abs(trough_slope), 1e-9) * 0.45
        if parallel:
            confidence = np.clip(0.54 + 0.16 * min(1.0, abs(overall_slope) / (price_norm * 0.03 + 1e-9)) + 0.12 * (1.0 - min(1.0, volatility * 4.0)), 0.0, 0.9)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}

    if name == "Channel Down":
        parallel = overall_slope < 0 and peak_slope < 0 and trough_slope < 0 and abs(peak_slope - trough_slope) <= max(abs(peak_slope), abs(trough_slope), 1e-9) * 0.45
        if parallel:
            confidence = np.clip(0.54 + 0.16 * min(1.0, abs(overall_slope) / (price_norm * 0.03 + 1e-9)) + 0.12 * (1.0 - min(1.0, volatility * 4.0)), 0.0, 0.9)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}

    if name == "Rising Wedge":
        if overall_slope > 0 and peak_slope > 0 and trough_slope > 0 and peak_slope < trough_slope:
            confidence = np.clip(0.56 + 0.2 * (1.0 - min(1.0, abs(peak_slope - trough_slope) / (price_norm * 0.02 + 1e-9))) + 0.1 * range_contraction, 0.0, 0.92)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}

    if name == "Falling Wedge":
        if overall_slope < 0 and peak_slope < 0 and trough_slope < 0 and peak_slope > trough_slope:
            confidence = np.clip(0.56 + 0.2 * (1.0 - min(1.0, abs(peak_slope - trough_slope) / (price_norm * 0.02 + 1e-9))) + 0.1 * range_contraction, 0.0, 0.92)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}

    if name in {"Head and Shoulders", "Inverse Head and Shoulders"} and peaks.size >= 3 and troughs.size >= 2:
        peak_values = values[peaks]
        trough_values = values[troughs]
        if name == "Head and Shoulders":
            shoulder_gap = abs(peak_values[0] - peak_values[-1]) / (abs(np.mean(peak_values[[0, -1]])) + 1e-9)
            head_clearance = peak_values[1] - max(peak_values[0], peak_values[-1])
            neckline = float(np.mean(trough_values[:2])) if trough_values.size >= 2 else float(np.min(values))
            if shoulder_gap <= 0.12 and head_clearance > price_norm * 0.01 and peak_values[1] > neckline:
                confidence = np.clip(0.58 + 0.16 * min(1.0, head_clearance / (price_norm * 0.03 + 1e-9)), 0.0, 0.94)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}
        else:
            shoulder_gap = abs(trough_values[0] - trough_values[-1]) / (abs(np.mean(trough_values[[0, -1]])) + 1e-9)
            head_clearance = min(trough_values[0], trough_values[-1]) - trough_values[1]
            neckline = float(np.mean(peak_values[:2])) if peak_values.size >= 2 else float(np.max(values))
            if shoulder_gap <= 0.12 and head_clearance > price_norm * 0.01 and trough_values[1] < neckline:
                confidence = np.clip(0.58 + 0.16 * min(1.0, abs(head_clearance) / (price_norm * 0.03 + 1e-9)), 0.0, 0.94)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}

    if name in {"Double Top", "Double Bottom", "Triple Top", "Triple Bottom"}:
        if name == "Double Top" and peaks.size >= 2:
            similarity = 1.0 - min(1.0, abs(values[peaks[0]] - values[peaks[-1]]) / (price_norm * 0.02 + 1e-9))
            if similarity > 0.55 and rolling_slope(values) <= 0:
                confidence = np.clip(0.56 + 0.2 * similarity, 0.0, 0.93)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}
        if name == "Double Bottom" and troughs.size >= 2:
            similarity = 1.0 - min(1.0, abs(values[troughs[0]] - values[troughs[-1]]) / (price_norm * 0.02 + 1e-9))
            if similarity > 0.55 and rolling_slope(values) >= 0:
                confidence = np.clip(0.56 + 0.2 * similarity, 0.0, 0.93)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}
        if name == "Triple Top" and peaks.size >= 3:
            similarity = 1.0 - min(1.0, np.std(values[peaks[:3]]) / (price_norm * 0.02 + 1e-9))
            if similarity > 0.5 and rolling_slope(values) <= 0:
                confidence = np.clip(0.56 + 0.18 * similarity, 0.0, 0.93)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bearish", "key_levels": levels}
        if name == "Triple Bottom" and troughs.size >= 3:
            similarity = 1.0 - min(1.0, np.std(values[troughs[:3]]) / (price_norm * 0.02 + 1e-9))
            if similarity > 0.5 and rolling_slope(values) >= 0:
                confidence = np.clip(0.56 + 0.18 * similarity, 0.0, 0.93)
                return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "bullish", "key_levels": levels}

    if name in {"Flag", "Pennant"}:
        impulse = abs(rolling_slope(values[: max(5, values.size // 4)]))
        consolidation = float(np.std(np.diff(values[-max(5, values.size // 3):])))
        if impulse > price_norm * 0.008 and consolidation < price_norm * 0.008:
            trend = "bullish" if overall_slope >= 0 else "bearish"
            confidence = np.clip(0.54 + 0.18 * min(1.0, impulse / (price_norm * 0.02 + 1e-9)) + 0.08 * (1.0 - min(1.0, consolidation / (price_norm * 0.015 + 1e-9))), 0.0, 0.9)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": trend, "key_levels": levels}

    if name == "Rectangle":
        if abs(overall_slope) <= price_norm * 0.0015 and range_contraction >= -0.1:
            confidence = np.clip(0.52 + 0.16 * (1.0 - min(1.0, abs(overall_slope) / (price_norm * 0.003 + 1e-9))), 0.0, 0.88)
            return {"pattern": name, "confidence": round(float(confidence), 4), "trend": "neutral", "key_levels": levels}

    return None


def _historical_similarity(label: str, values: np.ndarray) -> float:
    template_store = _HISTORICAL_TEMPLATES.get(label)
    if not template_store:
        return 0.0
    comparisons = [cosine_similarity(values, template) for template in template_store]
    if not comparisons:
        return 0.0
    return float(np.clip((max(comparisons) + 1.0) / 2.0, 0.0, 1.0))


def _update_history(label: str, values: np.ndarray) -> None:
    if values.size < 4:
        return
    with _CACHE_LOCK:
        _HISTORICAL_TEMPLATES[label].append(normalize_series(values))


def detect_patterns(price_series: Sequence[float] | Mapping[str, Any] | np.ndarray) -> Dict[str, Any]:
    values = _as_series(price_series)
    if values.size < 8:
        return {
            "pattern": "None",
            "confidence": 0.0,
            "trend": "neutral",
            "key_levels": {"support": None, "resistance": None},
            "lines": {},
            "patterns": [],
        }

    fingerprint = price_frame_fingerprint(values)
    with _CACHE_LOCK:
        cached = _PATTERN_CACHE.get(fingerprint)
        if cached is not None:
            return cached.copy()

    swing = _swing_points(values)
    peaks = swing["peaks"]
    troughs = swing["troughs"]
    candidates: List[Dict[str, Any]] = []
    pattern_names = [
        "Ascending Triangle",
        "Descending Triangle",
        "Symmetrical Triangle",
        "Channel Up",
        "Channel Down",
        "Rising Wedge",
        "Falling Wedge",
        "Head and Shoulders",
        "Inverse Head and Shoulders",
        "Double Top",
        "Double Bottom",
        "Triple Top",
        "Triple Bottom",
        "Flag",
        "Pennant",
        "Rectangle",
    ]
    geometry_patterns = {
        "Ascending Triangle",
        "Descending Triangle",
        "Symmetrical Triangle",
        "Channel Up",
        "Channel Down",
        "Rising Wedge",
        "Falling Wedge",
        "Rectangle",
    }

    for name in pattern_names:
        candidate = _score_candidate(name, values, peaks, troughs)
        if candidate is None:
            continue
        candidate["similarity"] = round(_historical_similarity(candidate["pattern"], values), 4)
        candidate["confidence"] = round(float(np.clip(0.7 * candidate["confidence"] + 0.3 * candidate["similarity"], 0.0, 1.0)), 4)
        candidates.append(candidate)

    if candidates:
        candidates.sort(key=lambda item: item["confidence"], reverse=True)
        best = None
        lines: Dict[str, Any] = {}
        for candidate in candidates:
            pattern_name = str(candidate.get("pattern", "None"))
            valid_geometry, candidate_lines = _pattern_geometry_valid(pattern_name, values, peaks, troughs)
            if pattern_name in geometry_patterns and not valid_geometry:
                continue
            best = candidate.copy()
            lines = candidate_lines if candidate_lines else _build_trendlines(values, peaks, troughs)
            break

        if best is None:
            slope = rolling_slope(values)
            trend = "bullish" if slope > 0 else ("bearish" if slope < 0 else "neutral")
            best = {
                "pattern": "None",
                "confidence": 0.12,
                "trend": trend,
                "key_levels": {"support": round(float(np.min(values)), 4), "resistance": round(float(np.max(values)), 4)},
                "similarity": 0.0,
            }
            lines = {}
        else:
            _update_history(best["pattern"], values)
    else:
        slope = rolling_slope(values)
        trend = "bullish" if slope > 0 else ("bearish" if slope < 0 else "neutral")
        best = {
            "pattern": "None",
            "confidence": 0.12,
            "trend": trend,
            "key_levels": {"support": round(float(np.min(values)), 4), "resistance": round(float(np.max(values)), 4)},
            "similarity": 0.0,
        }
        lines = {}

    result = {
        "pattern": best["pattern"],
        "confidence": round(float(np.clip(best["confidence"], 0.0, 1.0)), 4),
        "trend": best["trend"],
        "key_levels": best["key_levels"],
        "lines": lines,
        "patterns": candidates,
        "metrics": {
            "slope": round(float(rolling_slope(values)), 6),
            "volatility": round(float(np.std(np.diff(values)) / (np.mean(np.abs(values)) + 1e-9)), 6),
            "range": round(float(np.max(values) - np.min(values)), 6),
            "peak_count": int(peaks.size),
            "trough_count": int(troughs.size),
        },
    }

    with _CACHE_LOCK:
        _PATTERN_CACHE[fingerprint] = result.copy()

    return result


def classify_pattern(window_data: Sequence[float] | Mapping[str, Any] | np.ndarray) -> str:
    return str(detect_patterns(window_data).get("pattern", "Insufficient Data"))


def match_with_historical_patterns(current_pattern: Sequence[float] | Mapping[str, Any] | np.ndarray) -> float:
    if isinstance(current_pattern, Mapping) and "series" in current_pattern:
        values = _as_series(current_pattern["series"])
        label = str(current_pattern.get("pattern") or current_pattern.get("label") or "")
    else:
        values = _as_series(current_pattern)
        label = classify_pattern(values)
    if values.size < 4:
        return 0.0
    return round(_historical_similarity(label, values), 4)


__all__ = ["detect_patterns", "classify_pattern", "match_with_historical_patterns"]
