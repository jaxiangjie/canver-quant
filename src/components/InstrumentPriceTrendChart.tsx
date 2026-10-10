import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { AShareBar } from '../types/ashare';
import { TrendingUp, Activity, BarChart2 } from 'lucide-react';

interface InstrumentPriceTrendChartProps {
  bars: AShareBar[];
  instrumentName: string;
  instrumentCode: string;
  currentPrice: number;
}

export const InstrumentPriceTrendChart: React.FC<InstrumentPriceTrendChartProps> = ({
  bars = [],
  instrumentName,
  instrumentCode,
  currentPrice
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoveredBar, setHoveredBar] = useState<AShareBar | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || bars.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 640;
    const height = 280;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 35, bottom: 35, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Slice last 180 bars for cleaner visual resolution
    const displayBars = bars.slice(-180);

    const minPrice = d3.min(displayBars, d => Math.min(d.low, d.ma250 || d.close)) || 0;
    const maxPrice = d3.max(displayBars, d => Math.max(d.high, d.ma250 || d.close)) || 10;
    const yPad = (maxPrice - minPrice) * 0.08;

    const xScale = d3.scaleLinear()
      .domain([0, displayBars.length - 1])
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain([Math.max(0, minPrice - yPad), maxPrice + yPad])
      .range([innerHeight, 0]);

    // Grid lines
    g.append('g')
      .attr('class', 'grid')
      .call(
        d3.axisLeft(yScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .attr('stroke-opacity', 0.1)
      .attr('color', '#64748b');

    // Axes
    const yAxis = d3.axisLeft(yScale).ticks(5).tickFormat(d => `¥${Number(d).toFixed(2)}`);
    g.append('g')
      .call(yAxis)
      .attr('color', '#475569')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#94a3b8');

    // Date X Axis
    const step = Math.floor(displayBars.length / 5);
    const tickIndices = [0, step, step * 2, step * 3, step * 4, displayBars.length - 1];
    const xAxis = d3.axisBottom(xScale)
      .tickValues(tickIndices)
      .tickFormat(idx => {
        const bar = displayBars[Number(idx)];
        return bar?.tradeDate ? bar.tradeDate.slice(5) : '';
      });

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .attr('color', '#475569')
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('fill', '#94a3b8');

    // Price Line Generator
    const priceLine = d3.line<AShareBar>()
      .x((_, i) => xScale(i))
      .y(d => yScale(d.close))
      .curve(d3.curveMonotoneX);

    // Area Generator for Subtle Gradient
    const priceArea = d3.area<AShareBar>()
      .x((_, i) => xScale(i))
      .y0(innerHeight)
      .y1(d => yScale(d.close))
      .curve(d3.curveMonotoneX);

    // Defs: Area Gradient
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient')
      .attr('id', 'price-grad')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#10b981').attr('stop-opacity', 0.25);
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#10b981').attr('stop-opacity', 0.0);

    g.append('path')
      .datum(displayBars)
      .attr('fill', 'url(#price-grad)')
      .attr('d', priceArea);

    // Draw MA250 (Annual Bear/Bull Line - Orange dashed)
    const validMA250 = displayBars.map((d, i) => ({ i, val: d.ma250 })).filter(d => d.val !== undefined && d.val > 0);
    if (validMA250.length > 1) {
      const ma250Line = d3.line<{ i: number; val?: number }>()
        .x(d => xScale(d.i))
        .y(d => yScale(d.val || 0))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(validMA250)
        .attr('fill', 'none')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .attr('d', ma250Line);
    }

    // Draw MA60 (Medium Line - Cyan)
    const validMA60 = displayBars.map((d, i) => ({ i, val: d.ma60 })).filter(d => d.val !== undefined && d.val > 0);
    if (validMA60.length > 1) {
      const ma60Line = d3.line<{ i: number; val?: number }>()
        .x(d => xScale(d.i))
        .y(d => yScale(d.val || 0))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(validMA60)
        .attr('fill', 'none')
        .attr('stroke', '#06b6d4')
        .attr('stroke-width', 1.2)
        .attr('opacity', 0.75)
        .attr('d', ma60Line);
    }

    // Draw Close Price Line (Emerald solid)
    g.append('path')
      .datum(displayBars)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2)
      .attr('d', priceLine);

    // Overlay Mouse Tracker
    const overlay = g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('class', 'cursor-crosshair');

    overlay.on('mousemove', (event) => {
      const [mouseX, mouseY] = d3.pointer(event);
      const rawIdx = Math.round(xScale.invert(mouseX));
      const idx = Math.max(0, Math.min(displayBars.length - 1, rawIdx));
      const bar = displayBars[idx];
      setHoveredBar(bar);
      setTooltipPos({ x: mouseX + margin.left, y: mouseY + margin.top });
    });

    overlay.on('mouseleave', () => {
      setHoveredBar(null);
    });

  }, [bars]);

  return (
    <div className="flex flex-col bg-slate-900/80 border border-slate-800 rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-800 gap-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <h4 className="text-sm font-semibold text-slate-100">
            {instrumentName} ({instrumentCode}) 价格走势与均线动量通道
          </h4>
          <span className="font-mono text-xs text-emerald-400 font-bold ml-1">
            ¥{currentPrice.toFixed(3)}
          </span>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-3 h-0.5 bg-emerald-400" />
            <span>收盘价 (Close)</span>
          </div>
          <div className="flex items-center gap-1.5 text-cyan-400">
            <span className="w-3 h-0.5 bg-cyan-400" />
            <span>MA60 季度生命线</span>
          </div>
          <div className="flex items-center gap-1.5 text-amber-400">
            <span className="w-3 h-0.5 border-t border-dashed border-amber-400" />
            <span>MA250 牛熊年线</span>
          </div>
        </div>
      </div>

      <div ref={containerRef} className="relative w-full overflow-hidden mt-2">
        <svg ref={svgRef} className="w-full h-[280px]" />

        {hoveredBar && tooltipPos && (
          <div
            className="absolute z-10 pointer-events-none bg-slate-950/90 border border-slate-700 text-slate-200 text-xs p-2.5 rounded shadow-lg font-mono"
            style={{
              left: `${Math.min(containerRef.current?.clientWidth ? containerRef.current.clientWidth - 190 : 250, tooltipPos.x + 10)}px`,
              top: `${Math.max(10, tooltipPos.y - 70)}px`
            }}
          >
            <div className="text-slate-400 text-[11px] border-b border-slate-800 pb-1 mb-1 font-bold">
              日期: {hoveredBar.tradeDate}
            </div>
            <div className="flex justify-between gap-4">
              <span>收盘价:</span>
              <span className="font-bold text-white">¥{hoveredBar.close.toFixed(3)}</span>
            </div>
            {hoveredBar.ma60 && (
              <div className="flex justify-between gap-4 text-cyan-400">
                <span>MA60:</span>
                <span>¥{hoveredBar.ma60.toFixed(3)}</span>
              </div>
            )}
            {hoveredBar.ma250 && (
              <div className="flex justify-between gap-4 text-amber-400">
                <span>MA250:</span>
                <span>¥{hoveredBar.ma250.toFixed(3)}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 text-slate-400 text-[10px] pt-1 border-t border-slate-800/80">
              <span>涨跌幅:</span>
              <span className={hoveredBar.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                {hoveredBar.changePct >= 0 ? `+${hoveredBar.changePct}%` : `${hoveredBar.changePct}%`}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
