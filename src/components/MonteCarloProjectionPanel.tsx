import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CarverSettings, PortfolioSummaryStats } from '../types/ashare';
import { 
  Sparkles, 
  TrendingUp, 
  ShieldCheck, 
  Sliders, 
  HelpCircle,
  RefreshCw,
  Coins
} from 'lucide-react';

interface MonteCarloProjectionProps {
  settings: CarverSettings;
  summary: PortfolioSummaryStats;
}

interface PercentileSeries {
  p95: number[];
  p75: number[];
  p50: number[];
  p25: number[];
  p05: number[];
}

export const MonteCarloProjectionPanel: React.FC<MonteCarloProjectionProps> = ({
  settings,
  summary,
}) => {
  const [horizonYears, setHorizonYears] = useState<number>(3); // 1, 3, 5 年
  const [useIDMCompensated, setUseIDMCompensated] = useState<boolean>(true);
  const [simSeed, setSimSeed] = useState<number>(42);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Parameters derived from Carver system state
  // If useIDMCompensated is true, use effective annual vol (~15-18%), expected return ~12.5-14%
  // If false, use uncompensated vol (~8-10%), expected return ~6.8%
  const effectiveVol = useIDMCompensated 
    ? (summary.effectiveAnnualVol || (settings.targetAnnualVol * 100)) / 100 
    : (summary.portfolioAnnualVol || 10.0) / 100;
  
  const expectedAnnualReturn = useIDMCompensated
    ? (summary.expectedAnnualReturn || 12.8) / 100
    : 0.068; // 6.8% uncompensated return

  const totalCapital = settings.totalCapital || 1000000;
  const numSteps = horizonYears * 250; // 250 trading days per year
  const numPaths = 2000; // 2,000 simulation paths

  // Generate percentile curves using Geometric Brownian Motion (GBM)
  const simulationResults = useMemo(() => {
    const dt = 1 / 250;
    const mu = expectedAnnualReturn;
    const sigma = effectiveVol;
    const drift = (mu - 0.5 * sigma * sigma) * dt;
    const volStep = sigma * Math.sqrt(dt);

    // Track distributions at each step (sampled at 50 intervals to optimize memory)
    const sampleInterval = Math.max(1, Math.floor(numSteps / 60));
    const sampleIndices: number[] = [];
    for (let i = 0; i <= numSteps; i += sampleInterval) {
      sampleIndices.push(i);
    }
    if (sampleIndices[sampleIndices.length - 1] !== numSteps) {
      sampleIndices.push(numSteps);
    }

    // Seeded pseudo-random normal distribution generator (Box-Muller)
    let seed = simSeed;
    const pseudoRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const randomNormal = () => {
      let u = 0, v = 0;
      while (u === 0) u = pseudoRandom();
      while (v === 0) v = pseudoRandom();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    // Paths collection at each sampled time step
    const stepEquities: number[][] = Array.from({ length: sampleIndices.length }, () => []);

    for (let p = 0; p < numPaths; p++) {
      let currentEquity = totalCapital;
      let samplePtr = 0;

      for (let s = 0; s <= numSteps; s++) {
        if (s === sampleIndices[samplePtr]) {
          stepEquities[samplePtr].push(currentEquity);
          samplePtr++;
        }
        if (s < numSteps) {
          const z = randomNormal();
          currentEquity *= Math.exp(drift + volStep * z);
        }
      }
    }

    // Compute percentiles at each sampled point
    const p95: number[] = [];
    const p75: number[] = [];
    const p50: number[] = [];
    const p25: number[] = [];
    const p05: number[] = [];

    stepEquities.forEach(vals => {
      vals.sort((a, b) => a - b);
      const n = vals.length;
      p05.push(vals[Math.floor(n * 0.05)]);
      p25.push(vals[Math.floor(n * 0.25)]);
      p50.push(vals[Math.floor(n * 0.50)]);
      p75.push(vals[Math.floor(n * 0.75)]);
      p95.push(vals[Math.floor(n * 0.95)]);
    });

    const finalVals = stepEquities[stepEquities.length - 1];
    const winCount = finalVals.filter(v => v >= totalCapital).length;
    const winRate = (winCount / finalVals.length) * 100;
    
    // Median CAGR
    const finalMedian = p50[p50.length - 1];
    const medianCAGR = ((Math.pow(finalMedian / totalCapital, 1 / horizonYears) - 1) * 100);

    return {
      sampleIndices,
      percentiles: { p95, p75, p50, p25, p05 },
      finalP95: p95[p95.length - 1],
      finalP75: p75[p75.length - 1],
      finalP50: p50[p50.length - 1],
      finalP25: p25[p25.length - 1],
      finalP05: p05[p05.length - 1],
      winRate: Number(winRate.toFixed(1)),
      medianCAGR: Number(medianCAGR.toFixed(1)),
    };
  }, [horizonYears, effectiveVol, expectedAnnualReturn, totalCapital, simSeed]);

  // Render Fan Chart / Cone of Uncertainty on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const padLeft = 70;
    const padRight = 30;
    const padTop = 20;
    const padBottom = 30;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const { percentiles, sampleIndices } = simulationResults;
    const stepsCount = sampleIndices.length;

    let minVal = Math.min(...percentiles.p05) * 0.92;
    let maxVal = Math.max(...percentiles.p95) * 1.05;

    // Horizontal grid
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748B';
    ctx.font = '10px monospace';

    for (let i = 0; i <= 5; i++) {
      const v = minVal + ((maxVal - minVal) * (i / 5));
      const y = padTop + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(`¥${(v / 10000).toFixed(0)}万`, 12, y + 3);
    }

    // Capital line (100万)
    const capitalY = padTop + chartH - ((totalCapital - minVal) / (maxVal - minVal)) * chartH;
    ctx.strokeStyle = '#475569';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, capitalY);
    ctx.lineTo(width - padRight, capitalY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#94A3B8';
    ctx.fillText('初始本金线', width - padRight - 65, capitalY - 5);

    // 1. Fill Outer Cloud (5% to 95%) - Low opacity cyan/indigo
    ctx.fillStyle = 'rgba(99, 102, 241, 0.12)';
    ctx.beginPath();
    for (let i = 0; i < stepsCount; i++) {
      const x = padLeft + (i / (stepsCount - 1)) * chartW;
      const y = padTop + chartH - ((percentiles.p95[i] - minVal) / (maxVal - minVal)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = stepsCount - 1; i >= 0; i--) {
      const x = padLeft + (i / (stepsCount - 1)) * chartW;
      const y = padTop + chartH - ((percentiles.p05[i] - minVal) / (maxVal - minVal)) * chartH;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // 2. Fill Inner Cloud (25% to 75%) - Higher opacity emerald
    ctx.fillStyle = 'rgba(16, 185, 129, 0.20)';
    ctx.beginPath();
    for (let i = 0; i < stepsCount; i++) {
      const x = padLeft + (i / (stepsCount - 1)) * chartW;
      const y = padTop + chartH - ((percentiles.p75[i] - minVal) / (maxVal - minVal)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = stepsCount - 1; i >= 0; i--) {
      const x = padLeft + (i / (stepsCount - 1)) * chartW;
      const y = padTop + chartH - ((percentiles.p25[i] - minVal) / (maxVal - minVal)) * chartH;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Helper to draw percentile line
    const drawPercentileLine = (series: number[], color: string, lineWidth: number, isDashed: boolean = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (isDashed) ctx.setLineDash([3, 3]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < stepsCount; i++) {
        const x = padLeft + (i / (stepsCount - 1)) * chartW;
        const y = padTop + chartH - ((series[i] - minVal) / (maxVal - minVal)) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    drawPercentileLine(percentiles.p95, '#818CF8', 1.5, true);
    drawPercentileLine(percentiles.p75, '#34D399', 1.5, true);
    drawPercentileLine(percentiles.p50, '#10B981', 2.5, false); // Central median trajectory
    drawPercentileLine(percentiles.p25, '#34D399', 1.5, true);
    drawPercentileLine(percentiles.p05, '#F87171', 1.5, true);

    // X-axis time marks
    ctx.fillStyle = '#64748B';
    for (let yIdx = 0; yIdx <= horizonYears; yIdx++) {
      const x = padLeft + (yIdx / horizonYears) * chartW;
      const label = yIdx === 0 ? '当前' : `第 ${yIdx} 年`;
      ctx.fillText(label, x - (yIdx === 0 ? 0 : 15), height - 10);
    }

  }, [simulationResults, totalCapital, horizonYears]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部控制面板 */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white">
              蒙特卡洛未来财富概率锥 (Monte Carlo Projection · 2000条GBM路径)
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            基于伊藤引理与几何布朗运动（GBM），结合卡弗 IDM 修正后实际年化波动率（{(effectiveVol * 100).toFixed(1)}%）与理论夏普比率推演。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* 年限切换 */}
          <div className="flex items-center bg-slate-950 p-1 rounded border border-slate-800 font-mono">
            {[1, 3, 5].map(yr => (
              <button
                key={yr}
                onClick={() => setHorizonYears(yr)}
                className={`px-3 py-1 rounded transition-colors ${
                  horizonYears === yr
                    ? 'bg-indigo-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                未来 {yr} 年
              </button>
            ))}
          </div>

          {/* IDM 补偿开关对比 */}
          <button
            onClick={() => setUseIDMCompensated(!useIDMCompensated)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border transition-colors ${
              useIDMCompensated
                ? 'bg-emerald-950 text-emerald-300 border-emerald-700 font-semibold'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
          >
            <span>IDM 波动补偿 {useIDMCompensated ? '已开启 (13%年化)' : '已关闭 (6%年化)'}</span>
          </button>

          {/* 重新采样扰动 */}
          <button
            onClick={() => setSimSeed(prev => prev + 17)}
            title="更换随机数种子重新模拟2000条路径"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 核心展示区：左侧概率锥画布，右侧关键概率分位数 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white">未来 {horizonYears} 年资产净值概率分布锥 (Cone of Uncertainty)</span>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-mono text-slate-400">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2 bg-indigo-500/40 inline-block rounded-xs" /> 90% 置信区间 (5%-95%)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2 bg-emerald-500/50 inline-block rounded-xs" /> 50% 核心置信带 (25%-75%)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block" /> 中位期望中轴</span>
            </div>
          </div>

          <div className="relative w-full h-[320px] bg-slate-950/80 rounded border border-slate-800/80 overflow-hidden">
            <canvas
              ref={canvasRef}
              width={720}
              height={320}
              className="w-full h-full block"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-800">
            <span>模拟引擎：GBM 随机微分方程采样（N={numPaths} 路径）</span>
            <span className="font-mono text-emerald-400">
              年化复合预期 (CAGR 中位数): +{simulationResults.medianCAGR}%
            </span>
          </div>
        </div>

        {/* 右侧：概率分位结果卡片 */}
        <div className="flex flex-col gap-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-3">
            <h3 className="text-xs font-bold text-white flex items-center justify-between">
              <span>未来 {horizonYears} 年终值概率分位数</span>
              <span className="text-[10px] text-slate-500 font-mono">本金: ¥100万</span>
            </h3>

            <div className="flex flex-col gap-2 font-mono text-xs">
              {/* 95% 极度乐观 */}
              <div className="p-2.5 rounded bg-slate-950/70 border border-indigo-900/40 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-indigo-400 font-sans font-semibold">95% 极佳行情分位</div>
                  <div className="text-sm font-bold text-white tabular-nums">
                    ¥{Math.round(simulationResults.finalP95).toLocaleString('zh-CN')}
                  </div>
                </div>
                <span className="text-xs text-indigo-400 font-bold">
                  +{(((simulationResults.finalP95 / totalCapital) - 1) * 100).toFixed(1)}%
                </span>
              </div>

              {/* 75% 乐观预期 */}
              <div className="p-2.5 rounded bg-slate-950/70 border border-emerald-900/40 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-emerald-400 font-sans font-semibold">75% 偏强预期分位</div>
                  <div className="text-sm font-bold text-white tabular-nums">
                    ¥{Math.round(simulationResults.finalP75).toLocaleString('zh-CN')}
                  </div>
                </div>
                <span className="text-xs text-emerald-400 font-bold">
                  +{(((simulationResults.finalP75 / totalCapital) - 1) * 100).toFixed(1)}%
                </span>
              </div>

              {/* 50% 中位期望 (基准) */}
              <div className="p-3 rounded bg-emerald-950/40 border border-emerald-600/60 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-emerald-300 font-sans font-bold flex items-center gap-1">
                    <span>50% 中位数基准期望</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-900 text-emerald-200">最可能</span>
                  </div>
                  <div className="text-base font-bold text-white tabular-nums">
                    ¥{Math.round(simulationResults.finalP50).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-sm text-emerald-400 font-bold">
                    +{(((simulationResults.finalP50 / totalCapital) - 1) * 100).toFixed(1)}%
                  </span>
                  <div className="text-[10px] text-slate-400 font-mono">
                    CAGR: +{simulationResults.medianCAGR}%
                  </div>
                </div>
              </div>

              {/* 25% 弱市偏低 */}
              <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 font-sans">25% 偏弱预期分位</div>
                  <div className="text-sm font-bold text-slate-300 tabular-nums">
                    ¥{Math.round(simulationResults.finalP25).toLocaleString('zh-CN')}
                  </div>
                </div>
                <span className={`text-xs font-semibold ${simulationResults.finalP25 >= totalCapital ? 'text-slate-300' : 'text-rose-400'}`}>
                  {simulationResults.finalP25 >= totalCapital ? '+' : ''}{(((simulationResults.finalP25 / totalCapital) - 1) * 100).toFixed(1)}%
                </span>
              </div>

              {/* 5% 悲观极端大底 */}
              <div className="p-2.5 rounded bg-slate-950/70 border border-rose-950/50 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-rose-400 font-sans font-semibold">5% 极度悲观大底</div>
                  <div className="text-sm font-bold text-rose-300 tabular-nums">
                    ¥{Math.round(simulationResults.finalP05).toLocaleString('zh-CN')}
                  </div>
                </div>
                <span className="text-xs text-rose-400 font-bold">
                  {(((simulationResults.finalP05 / totalCapital) - 1) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* 概率统计胜率卡 */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-950/80 rounded-md border border-emerald-800/60 text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs text-slate-400">持仓 {horizonYears} 年盈利胜率 P(收益&gt;0)</span>
                <div className="text-lg font-bold text-white font-mono mt-0.5">
                  {simulationResults.winRate}%
                </div>
              </div>
            </div>
            <div className="text-right text-[11px] text-slate-400 font-mono">
              <div>回撤可承受</div>
              <div className="text-emerald-400 font-semibold">长跑胜率高</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
