import React from "react";

interface Pattern {
  pattern?: string;
  confidence?: number;
  trend?: string;
  key_levels?: { support?: number | null; resistance?: number | null };
}

interface Prediction {
  sequence?: number[];
  forecast_close?: number[];
  confidence?: { score?: number };
  future_dates?: string[];
}

export default function PatternCard({ pattern, prediction }: { pattern?: Pattern | null; prediction?: Prediction | null }) {
  const pat = pattern || {};
  const pred = prediction || {};
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Pattern</p>
        <p className="text-sm font-black">{pat.pattern || "N/A"}</p>
        <p className="text-xs text-gray-400 mt-2">Trend: {pat.trend || "neutral"} • Confidence: {(pat.confidence ?? 0) * 100 >= 0 ? `${Math.round((pat.confidence ?? 0) * 100)}%` : "—"}</p>
        {pat.key_levels && (
          <p className="text-xs text-gray-400 mt-1">Support: {pat.key_levels.support ?? "—"} · Resistance: {pat.key_levels.resistance ?? "—"}</p>
        )}
      </div>

      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
        <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mb-1">Forecast (next)</p>
        <p className="text-sm font-black">{pred.forecast_close && pred.forecast_close.length ? `${pred.forecast_close[0].toFixed(2)} → ${pred.forecast_close[pred.forecast_close.length - 1].toFixed(2)}` : "N/A"}</p>
        <p className="text-xs text-gray-400 mt-2">Horizon: {pred.forecast_close ? pred.forecast_close.length : "—"} days • Confidence: {pred.confidence?.score ? `${Math.round((pred.confidence.score ?? 0) * 100)}%` : "—"}</p>
        {pred.future_dates && pred.future_dates.length > 0 && (
          <p className="text-xs text-gray-400 mt-1 truncate">Till: {pred.future_dates[pred.future_dates.length - 1]}</p>
        )}
      </div>
    </div>
  );
}
