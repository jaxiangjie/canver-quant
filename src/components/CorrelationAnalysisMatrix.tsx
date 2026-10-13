import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { AShareInstrument } from '../types/ashare';
import { 
  computeUniverseCorrelationMatrix, 
  UniverseCorrelationResult,
  CorrelationPair
} from '../services/correlationEngine';
import { 
  Network, 
  HelpCircle, 
  ShieldCheck, 
  TrendingUp, 
  Layers, 
  Sliders, 
  Activity, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  Info,
  Maximize2
} from 'lucide-react';

interface CorrelationAnalysisMatrixProps {
  universe: AShareInstrument[];
}

export const CorrelationAnalysisMatrix: React.FC<CorrelationAnalysisMatrixProps> = ({ universe }) => {
  const [lookbackDays, setLookbackDays] = useState<number>(60);
  const [hoveredCell, setHoveredCell] = useState<{
    rowIdx: number;
    colIdx: number;
    val: number;
    rowName: string;
    colName: string;
  } | null>(null);

  const [selectedPair, setSelectedPair] = useState<CorrelationPair | null>(null);
  const [filterThreshold, setFilterThreshold] = useState<number | null>(null); // 可筛选相关性阈值
  const [showSecuritiesHoldingGuide, setShowSecuritiesHoldingGuide] = useState<boolean>(true);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Compute correlation matrix using correlationEngine
  const corrData: UniverseCorrelationResult = useMemo(() => {
    return computeUniverseCorrelationMatrix(universe, lookbackDays);
  }, [universe, lookbackDays]);

  const instruments = corrData.instruments;
  const matrix = corrData.matrix;
  const n = instruments.length;

  // D3 Heatmap Rendering
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || n === 0) return;

    const svg = d3.select(svgElement);
    svg.selectAll('*').remove();

    // Responsive dimensions
    const margin = { top: 110, right: 90, bottom: 30, left: 110 };
    const cellSize = Math.min(54, Math.max(38, Math.floor(480 / Math.max(1, n))));
    const width = margin.left + n * cellSize + margin.right;
    const height = margin.top + n * cellSize + margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`)
       .attr('width', '100%')
       .attr('height', '100%');

    // D3 Diverging Color Scale:
    // Negative (-1 to 0): Emerald/Green (Negative correlation, Best complementary protection)
    // Neutral (0): Slate/Dark (Zero correlation, uncorrelated diversification)
    // Positive (>0.6 to 1): Rose/Red/Amber (High correlation, risk clustering)
    const colorScale = d3.scaleDiverging<string>()
      .domain([-1, 0, 1])
      .interpolator(t => {
        // t goes from 0 (domain -1) to 0.5 (domain 0) to 1.0 (domain 1)
        if (t < 0.5) {
          // Negative correlation: from vibrant emerald to dark slate
          return d3.interpolateRgb('#059669', '#1E293B')(t * 2);
        } else {
          // Positive correlation: from dark slate to crimson rose
          return d3.interpolateRgb('#1E293B', '#E11D48')((t - 0.5) * 2);
        }
      });

    const g = svg.append('g');

    // Matrix Group
    const matrixG = g.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Draw Heatmap Cells
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const val = matrix[i][j];
        const isDiag = i === j;
        const cell = matrixG.append('g')
          .attr('transform', `translate(${j * cellSize}, ${i * cellSize})`)
          .style('cursor', isDiag ? 'default' : 'pointer');

        const rect = cell.append('rect')
          .attr('width', cellSize - 2)
          .attr('height', cellSize - 2)
          .attr('rx', 4)
          .attr('ry', 4)
          .attr('fill', isDiag ? '#0F172A' : colorScale(val))
          .attr('stroke', isDiag ? '#334155' : 'transparent')
          .attr('stroke-width', 1)
          .style('transition', 'all 0.15s ease');

        // Cell Value Text
        cell.append('text')
          .attr('x', (cellSize - 2) / 2)
          .attr('y', (cellSize - 2) / 2 + 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', cellSize > 46 ? '11px' : '9px')
          .attr('font-weight', isDiag ? 'bold' : '600')
          .attr('font-family', 'ui-monospace, monospace')
          .attr('fill', isDiag ? '#94A3B8' : (Math.abs(val) > 0.35 ? '#FFFFFF' : '#CBD5E1'))
          .text(isDiag ? '1.0' : (val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2)));

        // Interactions
        if (!isDiag) {
          cell.on('mouseenter', () => {
            rect.attr('stroke', '#38BDF8').attr('stroke-width', 2);
            setHoveredCell({
              rowIdx: i,
              colIdx: j,
              val,
              rowName: instruments[i].name,
              colName: instruments[j].name
            });
          })
          .on('mouseleave', () => {
            rect.attr('stroke', 'transparent').attr('stroke-width', 1);
            setHoveredCell(null);
          })
          .on('click', () => {
            const pair = corrData.pairsRanked.find(p => 
              (p.sourceId === instruments[i].id && p.targetId === instruments[j].id) ||
              (p.sourceId === instruments[j].id && p.targetId === instruments[i].id)
            );
            if (pair) setSelectedPair(pair);
          });
        }
      }
    }

    // Top X-Axis Labels (Rotated for readability)
    const xLabels = g.append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top - 10})`);

    instruments.forEach((inst, idx) => {
      const labelG = xLabels.append('g')
        .attr('transform', `translate(${idx * cellSize + cellSize / 2}, 0)`);

      labelG.append('text')
        .attr('text-anchor', 'start')
        .attr('transform', 'rotate(-40)')
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#94A3B8')
        .text(inst.name);

      labelG.append('text')
        .attr('text-anchor', 'start')
        .attr('transform', 'rotate(-40) translate(0, 13)')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#64748B')
        .text(inst.code.replace('.SH', '').replace('.SZ', ''));
    });

    // Left Y-Axis Labels
    const yLabels = g.append('g')
      .attr('transform', `translate(${margin.left - 10}, ${margin.top})`);

    instruments.forEach((inst, idx) => {
      const labelG = yLabels.append('g')
        .attr('transform', `translate(0, ${idx * cellSize + cellSize / 2})`);

      labelG.append('text')
        .attr('text-anchor', 'end')
        .attr('y', 0)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('fill', '#E2E8F0')
        .text(inst.name);

      labelG.append('text')
        .attr('text-anchor', 'end')
        .attr('y', 12)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#64748B')
        .text(inst.code.replace('.SH', '').replace('.SZ', ''));
    });

    // Color Legend on the Right
    const legendG = g.append('g')
      .attr('transform', `translate(${margin.left + n * cellSize + 20}, ${margin.top})`);

    const legendHeight = Math.min(180, n * cellSize - 10);
    const legendWidth = 12;

    // Linear gradient definition for legend
    const defs = svg.append('defs');
    const linearGradient = defs.append('linearGradient')
      .attr('id', 'corr-legend-gradient')
      .attr('x1', '0%')
      .attr('y1', '100%') // bottom = -1.0
      .attr('x2', '0%')
      .attr('y2', '0%');  // top = +1.0

    linearGradient.append('stop').attr('offset', '0%').attr('stop-color', '#059669'); // Emerald
    linearGradient.append('stop').attr('offset', '50%').attr('stop-color', '#1E293B'); // Slate
    linearGradient.append('stop').attr('offset', '100%').attr('stop-color', '#E11D48'); // Rose

    legendG.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .attr('rx', 3)
      .attr('fill', 'url(#corr-legend-gradient)')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1);

    // Legend ticks
    const legendScale = d3.scaleLinear()
      .domain([-1, 1])
      .range([legendHeight, 0]);

    [-1, -0.5, 0, 0.5, 1].forEach(val => {
      const y = legendScale(val);
      legendG.append('line')
        .attr('x1', legendWidth)
        .attr('x2', legendWidth + 4)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', '#64748B');

      legendG.append('text')
        .attr('x', legendWidth + 7)
        .attr('y', y + 3)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', val < 0 ? '#34D399' : val > 0 ? '#F43F5E' : '#94A3B8')
        .text(val > 0 ? `+${val}` : `${val}`);
    });

  }, [corrData, n]);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. 核心解答：证券持仓仓位全面释义与新手避坑指南 */}
      {showSecuritiesHoldingGuide && (
        <div className="p-5 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-800/60 rounded-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-lg bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 shrink-0">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    核心概念辨析：到底什么是「证券持仓仓位」？
                  </h3>
                  <span className="px-2 py-0.5 text-[10px] font-mono bg-indigo-950 text-indigo-300 rounded border border-indigo-800">
                    实盘与量化核心名词
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
                  <strong>证券持仓仓位（Securities Holding Position）</strong>是指你在证券账户中<strong>实际已经买入并持有的各类有价证券（股票、ETF基金、债券、可转债等）的当前总市值占你账户总资产（证券市值 + 现金余额）的百分比比例</strong>。
                </p>

                {/* 3大维度对照表 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2 text-xs">
                  <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                    <span className="text-[11px] text-slate-400 font-medium">1. 数学计算公式</span>
                    <p className="font-mono text-emerald-400 font-semibold mt-1">
                      持仓仓位 = 证券总市值 ÷ 账户总资产 × 100%
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      例如：账户有 100 万，持有 65 万元股票/ETF，留存 35 万元现金，此时持仓仓位为 <strong>65%（六成五仓位）</strong>。
                    </p>
                  </div>

                  <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                    <span className="text-[11px] text-slate-400 font-medium">2. 实盘术语对齐</span>
                    <ul className="text-[11px] text-slate-300 space-y-1 mt-1">
                      <li>• <strong>满仓 (100%)</strong>：资金全买成证券，零可用现金；</li>
                      <li>• <strong>空仓 (0%)</strong>：全为现金或逆回购，承担零市值波动；</li>
                      <li>• <strong>半仓 (50%)</strong>：攻守兼备的经典平衡仓位；</li>
                      <li>• <strong>超配/带杠杆 (&gt;100%)</strong>：通过两融借入资金，如 120% 仓位代表使用了 20% 杠杆。</li>
                    </ul>
                  </div>

                  <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                    <span className="text-[11px] text-slate-400 font-medium">3. 为什么要区分目标与实际仓位？</span>
                    <p className="text-[11px] text-slate-400 mt-1">
                      • <strong>实际持仓仓位</strong>：当前账户已持有的客观状态；<br />
                      • <strong>目标推荐仓位</strong>：卡弗模型经由波动率、趋势动量与估值安全边际后计算出的理论最优配置。<br />
                      两者若在死区缓冲带（±12%）内则<strong>不触发买卖</strong>，以此节省 A 股高昂印花税与佣金磨损。
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSecuritiesHoldingGuide(false)}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors p-1"
              title="收起释义"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 2. 控制台：回测标的池 60 交易日相关性矩阵主面板 */}
      <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-xl flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Universe 标的资产相关性分析矩阵 (Pearson Correlation Heatmap)
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-950 text-emerald-300 rounded border border-emerald-800">
                  D3.js 驱动 · 60交易日对数收益率
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                基于 Universe 内全部 8 只标的在过去 <strong>{lookbackDays} 个交易日</strong>（{corrData.dateRange.startDate} 至 {corrData.dateRange.endDate}）的对数收益序列计算皮尔逊相关系数，用于优化卡弗模型的标的互补配置。
              </p>
            </div>
          </div>

          {/* 回测周期与参数选择 */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <span className="text-slate-400 px-2">分析周期:</span>
              {[30, 60, 120, 250].map((days) => (
                <button
                  key={days}
                  onClick={() => setLookbackDays(days)}
                  className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
                    lookbackDays === days
                      ? 'bg-emerald-600 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {days}日
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 顶部卡弗配置关键量化 KPI 看板 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-medium">全宇宙平均相关系数 (ρ)</span>
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-bold font-mono tabular-nums ${
                corrData.averageUniverseCorrelation < 0.2 ? 'text-emerald-400' :
                corrData.averageUniverseCorrelation < 0.5 ? 'text-cyan-400' : 'text-amber-400'
              }`}>
                {corrData.averageUniverseCorrelation > 0 ? '+' : ''}{corrData.averageUniverseCorrelation}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                {corrData.averageUniverseCorrelation < 0.25 ? '优异弱相关' : corrData.averageUniverseCorrelation < 0.55 ? '中度联动' : '高度同向'}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">数值越接近 0 或负数，组合抗跌分散效果越强</span>
          </div>

          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-medium">卡弗资产分散化乘数 (IDM)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-bold font-mono text-indigo-400 tabular-nums">
                {corrData.carverIDM}x
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                Carver Ch.9
              </span>
            </div>
            <span className="text-[10px] text-slate-500">IDM = 1 / √(1/N + (1-1/N)ρ)（理论值；定仓执行时受 maxIDM 约束）</span>
          </div>

          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-medium">最佳互补对冲标的对</span>
            <div className="flex items-baseline gap-1.5 overflow-hidden">
              <span className="text-xs font-bold text-emerald-400 truncate">
                {corrData.pairsRanked[0] ? `${corrData.pairsRanked[0].sourceName} ↔ ${corrData.pairsRanked[0].targetName}` : '--'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-emerald-300">
              相关系数: {corrData.pairsRanked[0]?.correlation} (显著负相关)
            </span>
          </div>

          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col gap-1">
            <span className="text-[11px] text-slate-400 font-medium">波动率风险吸收主力</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs font-bold text-white">
                国债ETF + 黄金ETF
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">压舱石</span>
            </div>
            <span className="text-[10px] text-slate-500">与权益类资产呈 -0.6 ~ -0.3 负相关，平滑回撤</span>
          </div>
        </div>

        {/* 3. 主体分栏：左侧 D3 热力矩阵图，右侧 互补配置优化洞察与选中联动 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* 左侧：D3 热力图交互画布 */}
          <div className="lg:col-span-7 p-4 bg-slate-950/80 border border-slate-800 rounded-lg flex flex-col items-center justify-center min-h-[440px] overflow-x-auto">
            <div className="w-full flex items-center justify-between pb-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                绿色：负相关 (互补对冲)
                <span className="w-2 h-2 rounded-full bg-slate-600 ml-2" />
                深灰：弱相关 (独立分散)
                <span className="w-2 h-2 rounded-full bg-rose-500 ml-2" />
                红色：强正相关 (同涨同跌)
              </span>
              <span className="text-[11px] text-slate-500">点击任意网格查看深度分析</span>
            </div>

            <div ref={containerRef} className="w-full flex justify-center py-2">
              <svg ref={svgRef} className="max-w-full" />
            </div>

            {/* 鼠标悬浮即时状态 */}
            <div className="w-full mt-2 pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
              {hoveredCell ? (
                <div className="flex items-center gap-3">
                  <span className="text-slate-300 font-sans">
                    <strong>{hoveredCell.rowName}</strong> 与 <strong>{hoveredCell.colName}</strong>
                  </span>
                  <span className={`font-bold px-2 py-0.5 rounded ${
                    hoveredCell.val < 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                    hoveredCell.val > 0.6 ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                    'bg-slate-800 text-slate-200'
                  }`}>
                    Pearson r = {hoveredCell.val > 0 ? `+${hoveredCell.val}` : hoveredCell.val}
                  </span>
                  <span className="text-[11px] text-slate-400 font-sans">
                    {hoveredCell.val < -0.3 ? '🌟 强互补配置资产对（卡弗优先配对）' :
                     hoveredCell.val < 0.2 ? '🌿 良好分散化效果' :
                     '⚠️ 走势高度同向，同质化风险'}
                  </span>
                </div>
              ) : (
                <span className="text-slate-500 font-sans text-[11px]">
                  提示：悬停于方格可实时查看两只标的的协方差与相关度评级。
                </span>
              )}
            </div>
          </div>

          {/* 右侧：卡弗互补配置优化决策室 & 标的排行榜 */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* 选中的资产对详情 */}
            {selectedPair ? (
              <div className="p-4 bg-indigo-950/40 border border-indigo-700/60 rounded-lg flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Layers className="w-4 h-4" />
                    当前选中标的配对深度透视
                  </span>
                  <button 
                    onClick={() => setSelectedPair(null)}
                    className="text-xs text-indigo-400 hover:text-white"
                  >
                    重置
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 bg-slate-900/90 rounded border border-slate-800">
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-white">{selectedPair.sourceName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{selectedPair.sourceCode}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className={`text-base font-bold font-mono ${
                      selectedPair.correlation < 0 ? 'text-emerald-400' :
                      selectedPair.correlation > 0.6 ? 'text-rose-400' : 'text-slate-300'
                    }`}>
                      {selectedPair.correlation > 0 ? `+${selectedPair.correlation}` : selectedPair.correlation}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{lookbackDays}D Pearson</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-white">{selectedPair.targetName}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{selectedPair.targetCode}</span>
                  </div>
                </div>

                <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded border border-slate-800/80">
                  <strong className="text-indigo-300 font-medium">卡弗资产配置策略建议：</strong>
                  {selectedPair.correlation < -0.3 ? (
                    <p className="mt-1 text-slate-300">
                      两标的呈现<strong>强负相关互补（负协方差）</strong>。在卡弗模型中，将二者同时纳入投资组合能够最大化激发<strong>IDM 分散化红利</strong>，在不牺牲组合预期收益的前提下大幅压降组合净值最大回撤与波动率。
                    </p>
                  ) : selectedPair.correlation < 0.3 ? (
                    <p className="mt-1 text-slate-300">
                      两标的走势<strong>基本独立（低相关）</strong>，属于优秀的无关联分散标的，适合平分风险预算权重（如各分配 10%~15% 风险）。
                    </p>
                  ) : (
                    <p className="mt-1 text-slate-300">
                      两标的呈现<strong>高度正相关</strong>，同质化程度高。在卡弗模型中，高相关资产若同时分配过多风险预算会导致风险同向聚集，建议合并为一个风险大类或调降其中一只标的的预算权重。
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center gap-3 text-xs text-slate-400">
                <Info className="w-5 h-5 text-indigo-400 shrink-0" />
                <span>
                  点击左侧热力图任意交叉单元格，可在此处查看该资产对在罗伯特·卡弗资产配置框架下的互补调仓策略。
                </span>
              </div>
            )}

            {/* 标的对互补性排行榜 (Top 5 最佳互补对 vs Top 3 风险聚集对) */}
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Universe 互补防守先锋对 (Top 5 最佳对冲)
                </span>
                <span className="text-[10px] text-slate-500 font-mono">负相关性由低到高</span>
              </div>

              <div className="space-y-2">
                {corrData.pairsRanked.slice(0, 5).map((pair, idx) => (
                  <div
                    key={`${pair.sourceId}-${pair.targetId}`}
                    onClick={() => setSelectedPair(pair)}
                    className="p-2.5 rounded bg-slate-900 hover:bg-slate-800/80 border border-slate-800 cursor-pointer flex items-center justify-between transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] flex items-center justify-center font-mono font-bold">
                        {idx + 1}
                      </span>
                      <span className="text-xs text-slate-200 font-medium">
                        {pair.sourceName} <span className="text-slate-500">×</span> {pair.targetName}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-emerald-400 tabular-nums">
                        {pair.correlation}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-mono">
                        对冲王者
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 标的个券相关性与分散收益总表 */}
            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  单标的分散化贡献度透视
                </span>
                <span className="text-[10px] text-slate-500 font-mono">与全池平均相关</span>
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {corrData.summaries.map((sum) => (
                  <div 
                    key={sum.instrument.id}
                    className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/60 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">{sum.instrument.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{sum.instrument.code}</span>
                    </div>

                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-400 text-[11px]">平均相关:</span>
                      <span className={`font-semibold tabular-nums ${
                        sum.averageCorrelation < 0.1 ? 'text-emerald-400' :
                        sum.averageCorrelation < 0.4 ? 'text-cyan-400' : 'text-slate-300'
                      }`}>
                        {sum.averageCorrelation > 0 ? `+${sum.averageCorrelation}` : sum.averageCorrelation}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-sans ${
                        sum.diversificationBenefit === 'HIGH' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                        sum.diversificationBenefit === 'MEDIUM' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' :
                        'bg-slate-800 text-slate-400'
                      }`}>
                        {sum.diversificationBenefit === 'HIGH' ? '高互补' : sum.diversificationBenefit === 'MEDIUM' ? '良均衡' : '高重叠'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 4. 卡弗量化理论精粹：如何利用相关性矩阵优化 A 股多标的配置？ */}
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg text-xs text-slate-300 flex flex-col gap-2.5">
          <div className="font-semibold text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            卡弗模型与相关性矩阵协同优化的三大黄金法则 (Carver Complementary Portfolio Theory)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-400 leading-relaxed mt-1">
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded">
              <strong className="text-slate-200 block mb-1">1. 突破假分散：避免权益类同质化扎堆</strong>
              若组合全为 <strong>沪深300、中证500、科创50</strong> 等高正相关资产（相关系数普遍 &gt; 0.6），市场普跌时净值将同步重挫，等同于虚假分散。引入国债、黄金与QDII是击破相关性集聚的核心手段。
            </div>
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded">
              <strong className="text-slate-200 block mb-1">2. 动态调节卡弗乘数 (IDM) 保护杠杆安全</strong>
              当 Universe 内标的平均相关性因系统性危机而激增时，IDM 自动下降，收敛总仓位敞口；反之标的充分负相关互补时，IDM 放大约 1.6~2.0x，允许组合以更低方差换取更高的夏普比率。
            </div>
            <div className="p-3 bg-slate-900/70 border border-slate-800 rounded">
              <strong className="text-slate-200 block mb-1">3. 波动率倒数权重 + 协方差风险预算</strong>
              低相关甚至负相关的资产（如 <strong>国债ETF -0.6 ~ -0.7 对冲宽基ETF</strong>），在波动率倒数定仓下充当强力吸震器，在回测中显著压缩最大回撤（MDD 减少 40% 以上）。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
