import React, { useState, useEffect } from 'react';
import { InstrumentBundle } from '../types/ashare';
import { 
  Coins, 
  ArrowRightLeft, 
  History, 
  Check, 
  Layers,
  Sparkles,
  Info
} from 'lucide-react';

interface BundleSelectorProps {
  bundles: InstrumentBundle[];
  activeId: string;
  activeBundle?: InstrumentBundle;
  totalCapital: number;
  actualHoldingsSum?: number;
  onSelect: (id: string) => void;
  onUpdateCapital?: (capital: number) => void;
  onOpenLedger?: () => void;
  rebalanceCount?: number;
}

export const BundleSelector: React.FC<BundleSelectorProps> = ({
  bundles,
  activeId,
  activeBundle,
  totalCapital,
  actualHoldingsSum = 0,
  onSelect,
  onUpdateCapital,
  onOpenLedger,
  rebalanceCount = 0,
}) => {
  const [inputVal, setInputVal] = useState<string>(String(totalCapital || 1000000));
  const [isSavedToast, setIsSavedToast] = useState(false);

  // 当外部资金改变时同步输入框
  useEffect(() => {
    setInputVal(String(totalCapital || 1000000));
  }, [totalCapital]);

  const handleCapitalBlurOrSubmit = () => {
    const num = Math.max(1000, Math.round(Number(inputVal) || totalCapital));
    setInputVal(String(num));
    if (onUpdateCapital && num !== totalCapital) {
      onUpdateCapital(num);
      setIsSavedToast(true);
      setTimeout(() => setIsSavedToast(false), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCapitalBlurOrSubmit();
    }
  };

  const handleAlignWithActual = () => {
    if (actualHoldingsSum > 0 && onUpdateCapital) {
      const rounded = Math.round(actualHoldingsSum);
      setInputVal(String(rounded));
      onUpdateCapital(rounded);
      setIsSavedToast(true);
      setTimeout(() => setIsSavedToast(false), 2000);
    }
  };

  const hasCapitalDifference = actualHoldingsSum > 0 && Math.abs(actualHoldingsSum - totalCapital) > 500;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs w-full">
      {/* 左侧：组合选择器与专属资金设定 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 组合下拉选框 */}
        <label className="flex items-center gap-2">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>自选/预置组合:</span>
          </span>
          <select
            value={activeId}
            onChange={(e) => onSelect(e.target.value)}
            className="bg-slate-900 border border-slate-700/90 rounded px-2.5 py-1 text-xs text-white font-medium focus:outline-none focus:border-cyan-500 shadow-sm cursor-pointer"
          >
            {bundles.map((b) => {
              const capText = b.targetCapital ? `¥${(b.targetCapital / 10000).toFixed(0)}万` : '未定额';
              return (
                <option key={b.id} value={b.id}>
                  {b.name}（{b.items.length} 标的 · {capText}）
                </option>
              );
            })}
          </select>
        </label>

        {/* 组合总金额独立输入控制 */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700/80 rounded px-2 py-0.5 shadow-sm">
          <span className="text-slate-400 font-sans text-[11px] whitespace-nowrap flex items-center gap-1">
            <Coins className="w-3 h-3 text-emerald-400" />
            <span>组合总资金:</span>
          </span>
          <span className="text-slate-500 font-mono text-xs">¥</span>
          <input
            type="number"
            min="10000"
            step="10000"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={handleCapitalBlurOrSubmit}
            onKeyDown={handleKeyDown}
            className="w-24 bg-transparent text-right font-mono text-emerald-400 font-bold text-xs outline-none focus:text-emerald-300"
            title="点击输入任意自定义金额（如 420000），回车或移开自动保存并按该资金重构目标仓位"
          />
          {isSavedToast ? (
            <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 font-medium animate-pulse ml-0.5">
              <Check className="w-3 h-3" /> 已保存
            </span>
          ) : (
            <button
              type="button"
              onClick={handleCapitalBlurOrSubmit}
              className="text-[10px] text-slate-400 hover:text-emerald-300 px-1 py-0.2 rounded hover:bg-slate-800 transition-colors"
              title="确认保存并对齐组合"
            >
              更新
            </button>
          )}
        </div>

        {/* 一键对齐实盘市值快捷操作 */}
        {hasCapitalDifference && (
          <button
            type="button"
            onClick={handleAlignWithActual}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-600/60 rounded font-medium transition-colors whitespace-nowrap shadow-sm"
            title={`当前实盘持仓市值为 ¥${Math.round(actualHoldingsSum).toLocaleString('zh-CN')}，点击将管理总资金对齐为此金额`}
          >
            <ArrowRightLeft className="w-3 h-3" />
            <span>对齐当前持仓市值 (¥{Math.round(actualHoldingsSum).toLocaleString('zh-CN')})</span>
          </button>
        )}
      </div>

      {/* 右侧：组合调仓历史总账本入口与描述 */}
      <div className="flex items-center gap-3">
        {onOpenLedger && (
          <button
            type="button"
            onClick={onOpenLedger}
            className="flex items-center gap-1.5 px-3 py-1 bg-slate-800/90 hover:bg-slate-750 text-cyan-300 border border-slate-700/80 rounded font-medium text-xs transition-colors shadow-sm whitespace-nowrap"
            title="查看所有历史调仓轨迹、换手金额与再平衡事件记录"
          >
            <History className="w-3.5 h-3.5 text-cyan-400" />
            <span>调仓历史账本{rebalanceCount > 0 ? ` (${rebalanceCount})` : ''}</span>
          </button>
        )}
      </div>
    </div>
  );
};
