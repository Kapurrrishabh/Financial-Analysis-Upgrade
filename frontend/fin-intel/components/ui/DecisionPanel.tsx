import React from "react";

export default function DecisionPanel({ decision }: { decision?: any }) {
  if (!decision) return null;

  const shortTerm = decision.short_term || {};
  const longTerm = decision.long_term || {};
  const overall = decision.overall || {};

  const renderBlock = (title: string, block: any) => (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-gray-400 uppercase font-bold">{title}</div>
        <div className="text-sm font-black">{(block.decision||"HOLD").split(" ")[0]}</div>
      </div>
      <div className="text-[12px] text-gray-300 mb-1">Confidence: <span className="font-bold">{block.confidence ?? "-"}%</span></div>
      {block.reason && <div className="text-[11px] text-gray-500 mb-2">{block.reason}</div>}
      {block.weights && (
        <div className="text-[11px] text-gray-400">
          {Object.entries(block.weights).map(([k,v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="capitalize">{k}</span>
              <span className="font-bold">{Math.round(((typeof v === "number" ? v : 0) || 0) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full grid grid-cols-1 gap-2">
      <div className="grid grid-cols-3 gap-2">
        {renderBlock("Short Term", shortTerm)}
        {renderBlock("Long Term", longTerm)}
        {renderBlock("Overall", overall)}
      </div>
    </div>
  );
}
