import React from 'react';
import { InstrumentBundle } from '../types/ashare';

interface BundleSelectorProps {
  bundles: InstrumentBundle[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const BundleSelector: React.FC<BundleSelectorProps> = ({ bundles, activeId, onSelect }) => {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      <span className="font-semibold text-slate-300">测试组合</span>
      <select
        value={activeId}
        onChange={(e) => onSelect(e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
      >
        {bundles.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}（{b.items.length} 标的）
          </option>
        ))}
      </select>
    </label>
  );
};
