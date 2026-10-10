import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AShareInstrument } from '../types/ashare';
import { 
  StrategyParamGroup, 
  DEFAULT_STRATEGY_A, 
  DEFAULT_STRATEGY_B, 
  STRATEGY_PRESETS,
  runStrategyComparison,
  StrategyComparisonResult
} from '../services/strategyComparisonEngine';
import { 
  GitCompare, 
  Sliders, 
  Trophy, 
  TrendingUp, 
  TrendingDown, 
  ShieldCheck, 
  Zap, 
  RotateCcw, 
  BarChart3, 
  Layers, 
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface StrategyComparisonPanelProps {
  universe: AShareInstrument[];
}

export const StrategyComparisonPanel: React.FC<StrategyComparisonPanelProps> = ({ universe }) => {
  const [paramA, setParamA] = useState<StrategyParamGroup>(DEFAULT_STRATEGY_A);
  const [paramB, setParamB] = useState<StrategyParamGroup>(DEFAULT_STRATEGY_B);
  const [chartMetric, setChartMetric] = useState<'return' | 'drawdown' | 'spread'>('return');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Run comparative backtest whenever universe or parameters change
  const comparisonResult: StrategyComparisonResult = useMemo(() => {
    return runStrategyComparison(universe, paramA, paramB, 120);
  }, [universe, paramA, paramB]);

  const { series, metricsA, metricsB, sharpeDiff, returnDiff, maxDrawdownDiff, winnerId, attributionNotes } = comparisonResult;

  // Apply a preset
  const handleApplyPreset = (index: number) => {
    const preset = STRATEGY_PRESETS[index];
    if (!preset) return;
    setParamA(prev => ({ ...prev, ...preset.groupA }));
    setParamB(prev => ({ ...prev, ...preset.groupB }));
  };

  // Reset to default
  const handleResetDefaults = () => {
    setParamA(DEFAULT_STRATEGY_A);
    setParamB(DEFAULT_STRATEGY_B);
  };

  // Render Canvas Chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || series.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    // Padding
    const padLeft = 55;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    let minVal = 0;
    let maxVal = 0;

    if (chartMetric === 'return') {
      minVal = Math.min(
        ...series.map(s => Math.min(s.strategyAReturnPct, s.strategyBReturnPct, s.benchmarkReturnPct))
      );
      maxVal = Math.max(
        ...series.map(s => Math.max(s.strategyAReturnPct, s.strategyBReturnPct, s.benchmarkReturnPct))
      );
      // Give some breathing room
      minVal = Math.floor((minVal - 2) / 5) * 5;
      maxVal = Math.ceil((maxVal + 2) / 5) * 5;
      if (maxVal === minVal) {
        maxVal += 10;
        minVal -= 5;
      }
    } else if (chartMetric === 'drawdown') {
      minVal = Math.min(
        ...series.map(s => Math.min(s.strategyADrawdownPct, s.strategyBDrawdownPct))
      );
      minVal = Math.floor((minVal - 2) / 5) * 5;
      maxVal = 0;
    } else {
      // spread
      minVal = Math.min(...series.map(s => s.spreadReturnPct));
      maxVal = Math.max(...series.map(s => s.spreadReturnPct));
      minVal = Math.floor((minVal - 1) / 2) * 2;
      maxVal = Math.ceil((maxVal + 1) / 2) * 2;
      if (maxVal === minVal) {
        maxVal += 4;
        minVal -= 4;
      }
    }

    // Grid lines
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748B';
    ctx.font = '10px monospace';

    const gridSteps = 5;
    for (let i = 0; i <= gridSteps; i++) {
      const val = minVal + ((maxVal - minVal) * (i / gridSteps));
      const y = padTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      const label = `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`;
      ctx.fillText(label, 8, y + 3);
    }

    // Draw baseline (0%) if in range
    if (minVal <= 0 && maxVal >= 0) {
      const zeroY = padTop + chartH - ((0 - minVal) / (maxVal - minVal)) * chartH;
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, zeroY);
      ctx.lineTo(width - padRight, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Line drawing helper
    const drawSeriesLine = (
      getValue: (p: typeof series[0]) => number, 
      color: string, 
      lineWidth: number = 2.5, 
      dashed: boolean = false
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (dashed) ctx.setLineDash([4, 3]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      series.forEach((p, idx) => {
        const val = getValue(p);
        const x = padLeft + (idx / Math.max(1, series.length - 1)) * chartW;
        const y = padTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    };

    if (chartMetric === 'return') {
      // 1. Benchmark CSI 300 (Rose/Red dashed)
      drawSeriesLine(p => p.benchmarkReturnPct, '#F43F5E', 1.5, true);
      // 2. Strategy B (Amber #F59E0B)
      drawSeriesLine(p => p.strategyBReturnPct, '#F59E0B', 2.5);
      // 3. Strategy A (Indigo #6366F1)
      drawSeriesLine(p => p.strategyAReturnPct, '#6366F1', 2.5);
    } else if (chartMetric === 'drawdown') {
      // Fill under Strategy A
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)';
      ctx.beginPath();
      ctx.moveTo(padLeft, padTop + chartH - ((0 - minVal) / (maxVal - minVal)) * chartH);
      series.forEach((p, idx) => {
        const x = padLeft + (idx / Math.max(1, series.length - 1)) * chartW;
        const y = padTop + chartH - ((p.strategyADrawdownPct - minVal) / (maxVal - minVal)) * chartH;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(padLeft + chartW, padTop + chartH - ((0 - minVal) / (maxVal - minVal)) * chartH);
      ctx.closePath();
      ctx.fill();

      // Lines
      drawSeriesLine(p => p.strategyBDrawdownPct, '#F59E0B', 2);
      drawSeriesLine(p => p.strategyADrawdownPct, '#6366F1', 2.5);
    } else {
      // Spread Alpha (A - B)
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      const zeroY = padTop + chartH - ((0 - minVal) / (maxVal - minVal)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, zeroY);
      series.forEach((p, idx) => {
        const x = padLeft + (idx / Math.max(1, series.length - 1)) * chartW;
        const y = padTop + chartH - ((p.spreadReturnPct - minVal) / (maxVal - minVal)) * chartH;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(padLeft + chartW, zeroY);
      ctx.closePath();
      ctx.fill();

      drawSeriesLine(p => p.spreadReturnPct, '#10B981', 2.5);
    }

    // X-Axis Date Ticks
    ctx.fillStyle = '#64748B';
    const dateStep = Math.max(1, Math.floor(series.length / 5));
    for (let i = 0; i < series.length; i += dateStep) {
      const x = padLeft + (i / Math.max(1, series.length - 1)) * chartW;
      const dStr = series[i].date ? series[i].date.substring(5) : `T+${i}`;
      ctx.fillText(dStr, x - 12, height - 10);
    }

    // Hover Crosshair
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < series.length) {
      const x = padLeft + (hoverIndex / Math.max(1, series.length - 1)) * chartW;
      ctx.strokeStyle = '#94A3B8';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, height - padBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [series, chartMetric, hoverIndex]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || series.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - 55;
    const chartW = canvas.clientWidth - 75;
    const idx = Math.max(0, Math.min(series.length - 1, Math.round((x / chartW) * (series.length - 1))));
    setHoverIndex(idx);
  };

  const currentHover = hoverIndex !== null && series[hoverIndex] 
    ? series[hoverIndex] 
    : series[series.length - 1];

  return (
    <div className="flex flex-col gap-6">
      {/* 1. 顶部预设快捷切换横幅 */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white">
              典型量化参数对比预设 (Quick Preset Comparisons)
            </h3>
          </div>
          <button
            onClick={handleResetDefaults}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 恢复默认参数
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2.5">
          {STRATEGY_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => handleApplyPreset(idx)}
              className="text-left p-3 rounded bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/50 transition-all flex flex-col gap-1 group"
            >
              <div className="text-xs font-semibold text-slate-200 group-hover:text-indigo-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                {preset.title}
              </div>
              <div className="text-[11px] text-slate-400 line-clamp-2">
                {preset.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 2. 双策略参数配置卡片 (并排对比) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 策略参数组 A */}
        <div className="p-5 bg-slate-900/80 border border-indigo-500/40 rounded-lg flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-bl-full pointer-events-none" />
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-full bg-indigo-500 shadow-sm shadow-indigo-500/50" />
              <div>
                <input
                  type="text"
                  value={paramA.name}
                  onChange={(e) => setParamA({ ...paramA, name: e.target.value })}
                  className="bg-transparent text-sm font-bold text-white border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none"
                />
                <span className="text-[11px] text-indigo-400 block">{paramA.tag}</span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
              参数组 A
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            {/* 快线周期 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>EWMAC 快线周期 (Fast)</span>
                <span className="font-bold text-indigo-400">{paramA.fastPeriod} 日</span>
              </div>
              <select
                value={paramA.fastPeriod}
                onChange={(e) => setParamA({ ...paramA, fastPeriod: Number(e.target.value) })}
                className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value={4}>4 日 (极速)</option>
                <option value={8}>8 日 (短周期推荐)</option>
                <option value={12}>12 日 (中短周期)</option>
                <option value={16}>16 日 (标准稳健)</option>
                <option value={24}>24 日 (中慢速)</option>
              </select>
            </div>

            {/* 慢线周期 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>EWMAC 慢线周期 (Slow)</span>
                <span className="font-bold text-indigo-400">{paramA.slowPeriod} 日</span>
              </div>
              <select
                value={paramA.slowPeriod}
                onChange={(e) => setParamA({ ...paramA, slowPeriod: Number(e.target.value) })}
                className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
              >
                <option value={16}>16 日 (紧贴跟踪)</option>
                <option value={32}>32 日 (经典 8/32 对)</option>
                <option value={64}>64 日 (季度大波段 16/64)</option>
                <option value={128}>128 日 (半年度慢趋势 32/128)</option>
              </select>
            </div>

            {/* 目标波动率 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>目标年化波动率</span>
                <span className="font-bold text-indigo-400">{(paramA.targetVol * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.08"
                max="0.24"
                step="0.01"
                value={paramA.targetVol}
                onChange={(e) => setParamA({ ...paramA, targetVol: Number(e.target.value) })}
                className="accent-indigo-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-sans">
                <span>8% (防守)</span>
                <span>15%</span>
                <span>24% (激进)</span>
              </div>
            </div>

            {/* 调仓缓冲带 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>调仓死区缓冲比例</span>
                <span className="font-bold text-indigo-400">{(paramA.bufferBand * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.30"
                step="0.05"
                value={paramA.bufferBand}
                onChange={(e) => setParamA({ ...paramA, bufferBand: Number(e.target.value) })}
                className="accent-indigo-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-sans">
                <span>5% (紧敏)</span>
                <span>15%</span>
                <span>30% (宽平)</span>
              </div>
            </div>
          </div>

          {/* 开关：年线趋势过滤 */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              启用 120 日趋势均线防下行过滤
            </span>
            <button
              onClick={() => setParamA({ ...paramA, trendFilter: !paramA.trendFilter })}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                paramA.trendFilter
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {paramA.trendFilter ? '已开启' : '已关闭'}
            </button>
          </div>
        </div>

        {/* 策略参数组 B */}
        <div className="p-5 bg-slate-900/80 border border-amber-500/40 rounded-lg flex flex-col gap-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full pointer-events-none" />
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50" />
              <div>
                <input
                  type="text"
                  value={paramB.name}
                  onChange={(e) => setParamB({ ...paramB, name: e.target.value })}
                  className="bg-transparent text-sm font-bold text-white border-b border-transparent hover:border-slate-700 focus:border-amber-500 focus:outline-none"
                />
                <span className="text-[11px] text-amber-400 block">{paramB.tag}</span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
              参数组 B
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            {/* 快线周期 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>EWMAC 快线周期 (Fast)</span>
                <span className="font-bold text-amber-400">{paramB.fastPeriod} 日</span>
              </div>
              <select
                value={paramB.fastPeriod}
                onChange={(e) => setParamB({ ...paramB, fastPeriod: Number(e.target.value) })}
                className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500"
              >
                <option value={4}>4 日 (极速)</option>
                <option value={8}>8 日 (短周期推荐)</option>
                <option value={12}>12 日 (中短周期)</option>
                <option value={16}>16 日 (标准稳健)</option>
                <option value={24}>24 日 (中慢速)</option>
              </select>
            </div>

            {/* 慢线周期 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>EWMAC 慢线周期 (Slow)</span>
                <span className="font-bold text-amber-400">{paramB.slowPeriod} 日</span>
              </div>
              <select
                value={paramB.slowPeriod}
                onChange={(e) => setParamB({ ...paramB, slowPeriod: Number(e.target.value) })}
                className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500"
              >
                <option value={16}>16 日 (紧贴跟踪)</option>
                <option value={32}>32 日 (经典 8/32 对)</option>
                <option value={64}>64 日 (季度大波段 16/64)</option>
                <option value={128}>128 日 (半年度慢趋势 32/128)</option>
              </select>
            </div>

            {/* 目标波动率 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>目标年化波动率</span>
                <span className="font-bold text-amber-400">{(paramB.targetVol * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.08"
                max="0.24"
                step="0.01"
                value={paramB.targetVol}
                onChange={(e) => setParamB({ ...paramB, targetVol: Number(e.target.value) })}
                className="accent-amber-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-sans">
                <span>8% (防守)</span>
                <span>15%</span>
                <span>24% (激进)</span>
              </div>
            </div>

            {/* 调仓缓冲带 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-slate-300 font-sans text-[11px]">
                <span>调仓死区缓冲比例</span>
                <span className="font-bold text-amber-400">{(paramB.bufferBand * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.30"
                step="0.05"
                value={paramB.bufferBand}
                onChange={(e) => setParamB({ ...paramB, bufferBand: Number(e.target.value) })}
                className="accent-amber-500 bg-slate-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-500 font-sans">
                <span>5% (紧敏)</span>
                <span>15%</span>
                <span>30% (宽平)</span>
              </div>
            </div>
          </div>

          {/* 开关：年线趋势过滤 */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-300 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              启用 120 日趋势均线防下行过滤
            </span>
            <button
              onClick={() => setParamB({ ...paramB, trendFilter: !paramB.trendFilter })}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                paramB.trendFilter
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {paramB.trendFilter ? '已开启' : '已关闭'}
            </button>
          </div>
        </div>
      </div>

      {/* 3. 核心量化绩效与夏普比率对比看板 */}
      <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-5">
        {/* 胜出策略裁定横幅 */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${
              winnerId === 'A' ? 'bg-indigo-950 text-indigo-400 border border-indigo-700/60' :
              winnerId === 'B' ? 'bg-amber-950 text-amber-400 border border-amber-700/60' :
              'bg-slate-800 text-slate-300'
            }`}>
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>夏普比率表现评定 (Sharpe Comparison)</span>
                <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">无风险利率 2.0%</span>
              </div>
              <div className="text-base font-bold text-white mt-0.5">
                {winnerId === 'A' && (
                  <span>
                    <span className="text-indigo-400 font-extrabold">{paramA.name}</span> 风险调整后收益显著占优 (夏普高出 <span className="text-emerald-400 font-mono">+{sharpeDiff}</span>)
                  </span>
                )}
                {winnerId === 'B' && (
                  <span>
                    <span className="text-amber-400 font-extrabold">{paramB.name}</span> 风险调整后收益显著占优 (夏普高出 <span className="text-emerald-400 font-mono">+{Math.abs(sharpeDiff)}</span>)
                  </span>
                )}
                {winnerId === 'TIE' && (
                  <span>两组策略夏普比率旗鼓相当 (Δ Sharpe ≈ 0.00)，综合性价比相近</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 font-mono text-sm tabular-nums">
            <div className="flex flex-col items-end">
              <span className="text-xs text-slate-400 font-sans">夏普比率 (A vs B)</span>
              <span className="font-bold">
                <span className="text-indigo-400">{metricsA.sharpeRatio.toFixed(2)}</span>
                <span className="text-slate-500 mx-1.5">vs</span>
                <span className="text-amber-400">{metricsB.sharpeRatio.toFixed(2)}</span>
              </span>
            </div>

            <div className="flex flex-col items-end">
              <span className="text-xs text-slate-400 font-sans">累计收益率 (A vs B)</span>
              <span className="font-bold">
                <span className={metricsA.totalReturnPct >= 0 ? 'text-indigo-400' : 'text-rose-400'}>
                  {metricsA.totalReturnPct >= 0 ? '+' : ''}{metricsA.totalReturnPct}%
                </span>
                <span className="text-slate-500 mx-1.5">vs</span>
                <span className={metricsB.totalReturnPct >= 0 ? 'text-amber-400' : 'text-rose-400'}>
                  {metricsB.totalReturnPct >= 0 ? '+' : ''}{metricsB.totalReturnPct}%
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* 关键绩效指标网格对比 */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 font-mono text-xs tabular-nums">
          {/* 夏普比率 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">夏普比率 (Sharpe)</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.sharpeRatio}</span>
              <span className="text-amber-400 font-bold">{metricsB.sharpeRatio}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              Δ {sharpeDiff >= 0 ? `+${sharpeDiff}` : sharpeDiff}
            </span>
          </div>

          {/* 累计收益率 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">累计收益率</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.totalReturnPct}%</span>
              <span className="text-amber-400 font-bold">{metricsB.totalReturnPct}%</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              Δ {returnDiff >= 0 ? `+${returnDiff}` : returnDiff}%
            </span>
          </div>

          {/* 年化收益率 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">年化收益率</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.annualizedReturnPct}%</span>
              <span className="text-amber-400 font-bold">{metricsB.annualizedReturnPct}%</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              年化复合回报
            </span>
          </div>

          {/* 年化波动率 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">年化波动率</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.annualizedVolPct}%</span>
              <span className="text-amber-400 font-bold">{metricsB.annualizedVolPct}%</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              实际实现波动
            </span>
          </div>

          {/* 最大回撤 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">最大回撤 (MaxDD)</span>
            <div className="flex justify-between items-baseline">
              <span className="text-rose-400 font-bold">{metricsA.maxDrawdownPct}%</span>
              <span className="text-rose-400 font-bold">{metricsB.maxDrawdownPct}%</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              Δ {maxDrawdownDiff >= 0 ? `+${maxDrawdownDiff}` : maxDrawdownDiff}%
            </span>
          </div>

          {/* 卡玛比率 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">卡玛比率 (Calmar)</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.calmarRatio}</span>
              <span className="text-amber-400 font-bold">{metricsB.calmarRatio}</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              年化/最大回撤
            </span>
          </div>

          {/* 年化换手与调仓次数 */}
          <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
            <span className="text-slate-400 font-sans text-[11px]">年化换手率 / 调仓</span>
            <div className="flex justify-between items-baseline">
              <span className="text-indigo-400 font-bold">{metricsA.annualTurnoverPct}%</span>
              <span className="text-amber-400 font-bold">{metricsB.annualTurnoverPct}%</span>
            </div>
            <span className="text-[10px] text-slate-500 font-sans">
              触发 {metricsA.rebalanceCount}次 vs {metricsB.rebalanceCount}次
            </span>
          </div>
        </div>
      </div>

      {/* 4. 折线图对比展示区 */}
      <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">
              双策略净值与绩效曲线对比 (120个交易日回测历史)
            </h3>
          </div>

          {/* 图表类型切换 */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setChartMetric('return')}
              className={`px-3 py-1 rounded transition-colors ${
                chartMetric === 'return' 
                  ? 'bg-indigo-600 text-white font-semibold' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              📈 累计收益率曲线
            </button>
            <button
              onClick={() => setChartMetric('drawdown')}
              className={`px-3 py-1 rounded transition-colors ${
                chartMetric === 'drawdown' 
                  ? 'bg-rose-600 text-white font-semibold' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              📉 水下回撤对比
            </button>
            <button
              onClick={() => setChartMetric('spread')}
              className={`px-3 py-1 rounded transition-colors ${
                chartMetric === 'spread' 
                  ? 'bg-emerald-600 text-white font-semibold' 
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              📊 策略 A-B 相对超额剪刀差
            </button>
          </div>
        </div>

        {/* 图例 */}
        <div className="flex flex-wrap items-center gap-5 text-xs font-mono border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span className="text-white font-semibold">
              {paramA.name}: {chartMetric === 'return' ? `${(currentHover?.strategyAReturnPct ?? 0) >= 0 ? '+' : ''}${currentHover?.strategyAReturnPct}%` : `${currentHover?.strategyADrawdownPct}%`}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-amber-400 font-semibold">
              {paramB.name}: {chartMetric === 'return' ? `${(currentHover?.strategyBReturnPct ?? 0) >= 0 ? '+' : ''}${currentHover?.strategyBReturnPct}%` : `${currentHover?.strategyBDrawdownPct}%`}
            </span>
          </div>

          {chartMetric === 'return' && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 border-t border-dashed border-rose-500" />
              <span className="text-rose-400">
                沪深300基准: {(currentHover?.benchmarkReturnPct ?? 0) >= 0 ? '+' : ''}{currentHover?.benchmarkReturnPct}%
              </span>
            </div>
          )}

          {chartMetric === 'spread' && (
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="text-emerald-400 font-bold">
                超额差值 (A - B): {(currentHover?.spreadReturnPct ?? 0) >= 0 ? '+' : ''}{currentHover?.spreadReturnPct}%
              </span>
            </div>
          )}

          <div className="ml-auto text-slate-500 text-[11px]">
            交易日：{currentHover?.date || '最新'}
          </div>
        </div>

        {/* Canvas 折线图 */}
        <div className="h-72 w-full relative">
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIndex(null)}
            className="w-full h-full cursor-crosshair"
          />
        </div>
      </div>

      {/* 5. 量化归因与参数敏感度深度解析 */}
      <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-lg flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <Zap className="w-4 h-4 text-amber-400" />
          <span>卡弗量化模型参数敏感度与归因深度解析 (Quantitative Attribution & Sensitivity)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {attributionNotes.map((note, idx) => (
            <div key={idx} className="p-3 bg-slate-800/40 rounded border border-slate-800/80 text-slate-300 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{note}</span>
            </div>
          ))}
        </div>

        <div className="p-3 rounded bg-slate-950/60 border border-slate-800/60 text-[11px] text-slate-400 leading-relaxed flex items-start gap-2 mt-1">
          <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <span>
            <strong>Robert Carver《系统化交易》量化法则验证：</strong> 
            动量周期的选取并非越快越好，快周期动量（如 8/32）虽然在单边突破行情中捕捉更早，但在 A 股宽幅震荡与存量博弈中会导致高额换手率与滑点摩擦；
            适当放宽调仓缓冲死区（Buffer Band 15%~25%）能将有效夏普比率提升 0.2~0.4，避免在噪音区间做无效再平衡。
          </span>
        </div>
      </div>
    </div>
  );
};
