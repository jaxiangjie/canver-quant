import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { InstrumentAnalyticsItem } from '../types/ashare';
import { Target, Sparkles, AlertTriangle, ShieldCheck, Compass } from 'lucide-react';

interface ValueMomentumScatterMatrixProps {
  items: InstrumentAnalyticsItem[];
  selectedId: string;
  onSelectItem: (id: string) => void;
}

export const ValueMomentumScatterMatrix: React.FC<ValueMomentumScatterMatrixProps> = ({
  items,
  selectedId,
  onSelectItem
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredItem, setHoveredItem] = useState<InstrumentAnalyticsItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || items.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 640;
    const height = 400;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 30, right: 35, bottom: 45, left: 55 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Scales (0 to 100 for both Value & Momentum)
    const xScale = d3.scaleLinear().domain([0, 100]).range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);

    // 4 Quadrants Background Fills
    // Top-Right: Golden Resonance (Value >= 50, Momentum >= 50)
    g.append('rect')
      .attr('x', xScale(50))
      .attr('y', 0)
      .attr('width', innerWidth - xScale(50))
      .attr('height', yScale(50))
      .attr('fill', 'rgba(16, 185, 129, 0.07)')
      .attr('rx', 4);

    // Top-Left: Trend Momentum (Value < 50, Momentum >= 50)
    g.append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', xScale(50))
      .attr('height', yScale(50))
      .attr('fill', 'rgba(245, 158, 11, 0.05)')
      .attr('rx', 4);

    // Bottom-Right: Value Defensive (Value >= 50, Momentum < 50)
    g.append('rect')
      .attr('x', xScale(50))
      .attr('y', yScale(50))
      .attr('width', innerWidth - xScale(50))
      .attr('height', innerHeight - yScale(50))
      .attr('fill', 'rgba(6, 182, 212, 0.05)')
      .attr('rx', 4);

    // Bottom-Left: Avoid Risk (Value < 50, Momentum < 50)
    g.append('rect')
      .attr('x', 0)
      .attr('y', yScale(50))
      .attr('width', xScale(50))
      .attr('height', innerHeight - yScale(50))
      .attr('fill', 'rgba(244, 63, 94, 0.05)')
      .attr('rx', 4);

    // Center Crosshair Lines (x=50, y=50)
    g.append('line')
      .attr('x1', xScale(50))
      .attr('x2', xScale(50))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,4');

    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(50))
      .attr('y2', yScale(50))
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,4');

    // Quadrant Corner Labels
    const quadrantHeaders = [
      { text: '🟩 双优黄金共振区 (低估+强趋势)', x: innerWidth - 10, y: 18, anchor: 'end', color: '#34d399' },
      { text: '🟧 趋势博弈区 (偏贵+强动量)', x: 12, y: 18, anchor: 'start', color: '#fbbf24' },
      { text: '🟦 左侧潜伏区 (低估+弱动量)', x: innerWidth - 10, y: innerHeight - 12, anchor: 'end', color: '#38bdf8' },
      { text: '🟥 双杀防守区 (偏贵+破位弱势)', x: 12, y: innerHeight - 12, anchor: 'start', color: '#f87171' }
    ];

    quadrantHeaders.forEach(q => {
      g.append('text')
        .attr('x', q.x)
        .attr('y', q.y)
        .attr('text-anchor', q.anchor)
        .attr('fill', q.color)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .attr('font-family', 'sans-serif')
        .attr('opacity', 0.85)
        .text(q.text);
    });

    // Grid lines & Axes
    const xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d => `${d}分`);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `${d}分`);

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .attr('color', '#475569')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#94a3b8');

    g.append('g')
      .call(yAxis)
      .attr('color', '#475569')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#94a3b8');

    // Axis Title
    g.append('text')
      .attr('x', innerWidth / 2)
      .attr('y', innerHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text('价值安全边际评分 (PE/PB历史极低估值、高股息、高ERP风险溢价 →)');

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -innerHeight / 2)
      .attr('y', -38)
      .attr('text-anchor', 'middle')
      .attr('fill', '#94a3b8')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .text('卡弗动量与风控评分 (多周期EWMAC趋势标量、年线均线上方、低波平价 →)');

    // Render Data Points for Instruments
    items.forEach(item => {
      const isSelected = item.instrument.id === selectedId;
      const cx = xScale(item.valueScore);
      const cy = yScale(item.momentumRiskScore);

      // Node Group
      const node = g.append('g')
        .attr('class', 'cursor-pointer')
        .on('click', () => onSelectItem(item.instrument.id))
        .on('mouseenter', (event) => {
          setHoveredItem(item);
          const rect = container.getBoundingClientRect();
          setTooltipPos({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
          });
        })
        .on('mouseleave', () => {
          setHoveredItem(null);
        });

      // Highlight Ring if Selected
      if (isSelected) {
        node.append('circle')
          .attr('cx', cx)
          .attr('cy', cy)
          .attr('r', 16)
          .attr('fill', 'none')
          .attr('stroke', '#10b981')
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '3,3')
          .attr('opacity', 0.9);
      }

      // Fill Color based on Quadrant
      let fillColor = '#10b981';
      if (item.quadrant === 'TREND_MOMENTUM') fillColor = '#f59e0b';
      else if (item.quadrant === 'VALUE_DEFENSIVE') fillColor = '#06b6d4';
      else if (item.quadrant === 'AVOID_RISK') fillColor = '#f43f5e';

      // Inner Circle
      node.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', isSelected ? 9 : 7)
        .attr('fill', fillColor)
        .attr('stroke', '#0f172a')
        .attr('stroke-width', 2);

      // Instrument Name Tag
      node.append('text')
        .attr('x', cx + (item.valueScore > 75 ? -12 : 12))
        .attr('y', cy + (item.momentumRiskScore > 80 ? 14 : -6))
        .attr('text-anchor', item.valueScore > 75 ? 'end' : 'start')
        .attr('fill', isSelected ? '#ffffff' : '#cbd5e1')
        .attr('font-size', isSelected ? '12px' : '11px')
        .attr('font-weight', isSelected ? '700' : '500')
        .attr('font-family', 'sans-serif')
        .text(item.instrument.name);
    });

  }, [items, selectedId, onSelectItem]);

  return (
    <div className="relative flex flex-col bg-slate-900/80 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            价值估值 × 卡弗动量风控 · 四象限全景定位矩阵
          </h3>
          <span className="text-[11px] text-slate-400 font-mono">
            (共 {items.length} 只标的实时期现分布)
          </span>
        </div>
        <div className="text-[11px] text-slate-400">
          点击圆点或标签可穿透下方单标的深度体检
        </div>
      </div>

      <div ref={containerRef} className="relative w-full overflow-hidden mt-2">
        <svg ref={svgRef} className="w-full h-[400px]" />

        {/* Hover Tooltip */}
        {hoveredItem && tooltipPos && (
          <div
            className="absolute z-20 pointer-events-none bg-slate-950/95 border border-slate-700 text-slate-200 text-xs p-3 rounded shadow-xl font-sans min-w-[240px]"
            style={{
              left: `${Math.min(containerRef.current?.clientWidth ? containerRef.current.clientWidth - 260 : 350, tooltipPos.x + 15)}px`,
              top: `${Math.max(10, tooltipPos.y - 70)}px`
            }}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 font-bold">
              <span className="text-white text-sm">{hoveredItem.instrument.name}</span>
              <span className="font-mono text-emerald-400">{hoveredItem.instrument.code}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 py-1.5 text-[11px]">
              <div>价值安全得分: <span className="font-bold text-cyan-300 font-mono">{hoveredItem.valueScore}分</span></div>
              <div>动量风控得分: <span className="font-bold text-amber-300 font-mono">{hoveredItem.momentumRiskScore}分</span></div>
              <div>PE历史分位: <span className="font-mono">{hoveredItem.pePercentile}%</span></div>
              <div>卡弗预测标量: <span className="font-mono font-bold text-emerald-300">{hoveredItem.carverForecastScalar > 0 ? `+${hoveredItem.carverForecastScalar}` : hoveredItem.carverForecastScalar}</span></div>
              <div>股债溢价 ERP: <span className="font-mono text-indigo-300">{hoveredItem.equityRiskPremium}%</span></div>
              <div>当前年化波动: <span className="font-mono">{(hoveredItem.annualizedVol * 100).toFixed(1)}%</span></div>
            </div>
            <div className="mt-1 pt-1.5 border-t border-slate-800 text-[11px] leading-relaxed text-slate-300">
              <span className="text-emerald-400 font-semibold">{hoveredItem.quadrantLabel}</span>: {hoveredItem.quadrantAdvice}
            </div>
          </div>
        )}
      </div>

      {/* Footer Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-800 text-[11px]">
        <div className="flex items-center gap-1.5 text-emerald-300 bg-emerald-950/30 px-2 py-1 rounded border border-emerald-900/40">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          <span>双优共振: 低估+强趋势(戴维斯双击)</span>
        </div>
        <div className="flex items-center gap-1.5 text-amber-300 bg-amber-950/30 px-2 py-1 rounded border border-amber-900/40">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
          <span>动量博弈: 顺势持有+折价防泡沫</span>
        </div>
        <div className="flex items-center gap-1.5 text-cyan-300 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-900/40">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shrink-0" />
          <span>左侧潜伏: 深度低估+底仓控仓防飞刀</span>
        </div>
        <div className="flex items-center gap-1.5 text-rose-300 bg-rose-950/30 px-2 py-1 rounded border border-rose-900/40">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-400 shrink-0" />
          <span>双杀防守: 破位偏贵+避险清仓</span>
        </div>
      </div>
    </div>
  );
};
