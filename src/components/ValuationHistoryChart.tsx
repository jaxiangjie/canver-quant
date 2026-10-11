import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { HistoricalValuationPoint } from '../types/ashare';
import { 
  TrendingUp, 
  TrendingDown, 
  Layers, 
  Calendar, 
  Maximize2 
} from 'lucide-react';

interface ValuationHistoryChartProps {
  data: HistoricalValuationPoint[];
  instrumentName: string;
  instrumentCode: string;
  isCommodityOrBond: boolean;
  currentPEPercentile: number;
  currentPBPercentile: number;
  currentComposite: number;
}

export const ValuationHistoryChart: React.FC<ValuationHistoryChartProps> = ({
  data = [],
  instrumentName,
  instrumentCode,
  isCommodityOrBond,
  currentPEPercentile,
  currentPBPercentile,
  currentComposite,
}) => {
  const safeData = Array.isArray(data) ? data : [];
  const lastDataPoint = safeData.length > 0 ? safeData[safeData.length - 1] : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [metricMode, setMetricMode] = useState<'composite' | 'both' | 'pe' | 'pb'>('composite');
  const [hoveredPoint, setHoveredPoint] = useState<HistoricalValuationPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // 5-Year summary statistics
  const compositeVals = safeData.map(d => d.compositePercentile);
  const maxComposite = compositeVals.length > 0 ? Math.max(...compositeVals) : 100;
  const minComposite = compositeVals.length > 0 ? Math.min(...compositeVals) : 0;
  const sortedVals = [...compositeVals].sort((a, b) => a - b);
  const medianComposite = sortedVals[Math.floor(sortedVals.length / 2)] || 50;

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || safeData.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = 300;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // clear previous render

    const margin = { top: 25, right: 35, bottom: 40, left: 45 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Set SVG attributes
    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X and Y Scales
    const xScale = d3
      .scalePoint<string>()
      .domain(safeData.map(d => d.date))
      .range([0, innerWidth])
      .padding(0.2);

    const yScale = d3
      .scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0]);

    // 1. Draw Valuation Zone Colored Background Bands
    const zones = [
      { y0: 80, y1: 100, fill: 'rgba(239, 68, 68, 0.08)', label: '高位区 (>80%)', textFill: '#F87171' },
      { y0: 65, y1: 80, fill: 'rgba(245, 158, 11, 0.05)', label: '中高区 (65-80%)', textFill: '#FBBF24' },
      { y0: 40, y1: 65, fill: 'rgba(148, 163, 184, 0.03)', label: '中位区 (40-65%)', textFill: '#94A3B8' },
      { y0: 20, y1: 40, fill: 'rgba(16, 185, 129, 0.05)', label: '低位区 (20-40%)', textFill: '#34D399' },
      { y0: 0, y1: 20, fill: 'rgba(16, 185, 129, 0.12)', label: '极低位区 (<20%)', textFill: '#10B981' },
    ];

    zones.forEach(z => {
      g.append('rect')
        .attr('x', 0)
        .attr('y', yScale(z.y1))
        .attr('width', innerWidth)
        .attr('height', Math.abs(yScale(z.y1) - yScale(z.y0)))
        .attr('fill', z.fill);

      // Zone boundary divider line
      if (z.y0 > 0) {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yScale(z.y0))
          .attr('y2', yScale(z.y0))
          .attr('stroke', '#334155')
          .attr('stroke-width', 0.8)
          .attr('stroke-dasharray', '3,3');
      }

      // Zone label on right margin
      g.append('text')
        .attr('x', innerWidth - 6)
        .attr('y', yScale(z.y0 + (z.y1 - z.y0) / 2) + 3)
        .attr('text-anchor', 'end')
        .attr('font-size', '9px')
        .attr('font-family', 'sans-serif')
        .attr('fill', z.textFill)
        .attr('opacity', 0.75)
        .text(z.label);
    });

    // 2. Y-Axis and Horizontal Grid
    const yAxisTicks = [0, 20, 40, 60, 80, 100];
    yAxisTicks.forEach(tick => {
      g.append('text')
        .attr('x', -8)
        .attr('y', yScale(tick) + 3)
        .attr('text-anchor', 'end')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('fill', '#64748B')
        .text(`${tick}%`);
    });

    // 3. X-Axis Ticks (every 2-3 quarters to prevent crowding)
    safeData.forEach((d, idx) => {
      if (idx % 3 === 0 || idx === safeData.length - 1) {
        const xPos = xScale(d.date) ?? 0;
        g.append('text')
          .attr('x', xPos)
          .attr('y', innerHeight + 18)
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('font-family', 'monospace')
          .attr('fill', idx === safeData.length - 1 ? '#38BDF8' : '#64748B')
          .attr('font-weight', idx === safeData.length - 1 ? 'bold' : 'normal')
          .text(idx === safeData.length - 1 ? `${d.date}(现)` : d.date);
      }
    });

    // 4. Line Generators & Area Gradients
    // Defs for gradients
    const defs = svg.append('defs');

    const gradComposite = defs.append('linearGradient')
      .attr('id', 'grad-composite')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    gradComposite.append('stop').attr('offset', '0%').attr('stop-color', '#10B981').attr('stop-opacity', 0.25);
    gradComposite.append('stop').attr('offset', '100%').attr('stop-color', '#10B981').attr('stop-opacity', 0.0);

    const gradPE = defs.append('linearGradient')
      .attr('id', 'grad-pe')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    gradPE.append('stop').attr('offset', '0%').attr('stop-color', '#06B6D4').attr('stop-opacity', 0.2);
    gradPE.append('stop').attr('offset', '100%').attr('stop-color', '#06B6D4').attr('stop-opacity', 0.0);

    // Line definitions
    const lineComposite = d3.line<HistoricalValuationPoint>()
      .x(d => xScale(d.date) ?? 0)
      .y(d => yScale(d.compositePercentile))
      .curve(d3.curveMonotoneX);

    const areaComposite = d3.area<HistoricalValuationPoint>()
      .x(d => xScale(d.date) ?? 0)
      .y0(innerHeight)
      .y1(d => yScale(d.compositePercentile))
      .curve(d3.curveMonotoneX);

    const linePE = d3.line<HistoricalValuationPoint>()
      .x(d => xScale(d.date) ?? 0)
      .y(d => yScale(d.pePercentile))
      .curve(d3.curveMonotoneX);

    const linePB = d3.line<HistoricalValuationPoint>()
      .x(d => xScale(d.date) ?? 0)
      .y(d => yScale(d.pbPercentile))
      .curve(d3.curveMonotoneX);

    // 5. Draw Selected Series
    if (metricMode === 'composite') {
      // Area Fill
      g.append('path')
        .datum(data)
        .attr('fill', 'url(#grad-composite)')
        .attr('d', areaComposite);

      // Line
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#10B981')
        .attr('stroke-width', 2.5)
        .attr('d', lineComposite);
    } else if (metricMode === 'pe') {
      g.append('path')
        .datum(data)
        .attr('fill', 'url(#grad-pe)')
        .attr('d', d3.area<HistoricalValuationPoint>()
          .x(d => xScale(d.date) ?? 0)
          .y0(innerHeight)
          .y1(d => yScale(d.pePercentile))
          .curve(d3.curveMonotoneX)
        );

      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#06B6D4')
        .attr('stroke-width', 2.2)
        .attr('d', linePE);
    } else if (metricMode === 'pb') {
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#8B5CF6')
        .attr('stroke-width', 2.2)
        .attr('d', linePB);
    } else if (metricMode === 'both') {
      // PE Line
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#06B6D4')
        .attr('stroke-width', 2.0)
        .attr('d', linePE);

      // PB Line
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#8B5CF6')
        .attr('stroke-width', 2.0)
        .attr('d', linePB);

      // Composite Line (dashed)
      g.append('path')
        .datum(data)
        .attr('fill', 'none')
        .attr('stroke', '#10B981')
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', '4,3')
        .attr('d', lineComposite);
    }

    // 6. Draw Highlight Marker for the Latest (Current) Data Point
    const lastPoint = safeData[safeData.length - 1];
    if (lastPoint) {
      const lastX = xScale(lastPoint.date) ?? 0;
      const lastVal = metricMode === 'pe' 
        ? lastPoint.pePercentile 
        : metricMode === 'pb' 
        ? lastPoint.pbPercentile 
        : lastPoint.compositePercentile;
      const lastY = yScale(lastVal);

      // Outer glow pulse circle
      g.append('circle')
        .attr('cx', lastX)
        .attr('cy', lastY)
        .attr('r', 7)
        .attr('fill', 'none')
        .attr('stroke', '#38BDF8')
        .attr('stroke-width', 2)
        .attr('opacity', 0.8);

      // Center solid dot
      g.append('circle')
        .attr('cx', lastX)
        .attr('cy', lastY)
        .attr('r', 3.5)
        .attr('fill', '#38BDF8');
    }

    // 7. Interactive Invisible Overlay for MouseMove Tooltip
    svg.append('rect')
      .attr('x', margin.left)
      .attr('y', margin.top)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [pointerX, pointerY] = d3.pointer(event, svg.node());
        const relativeX = pointerX - margin.left;
        const totalPoints = Math.max(1, safeData.length - 1);
        const eachBand = innerWidth / totalPoints;
        const idx = Math.max(0, Math.min(safeData.length - 1, Math.round(relativeX / Math.max(1, eachBand))));
        const point = safeData[idx];

        if (point) {
          setHoveredPoint(point);
          setTooltipPos({ x: pointerX, y: pointerY });
        }
      })
      .on('mouseleave', () => {
        setHoveredPoint(null);
        setTooltipPos(null);
      });

  }, [data, metricMode]);

  return (
    <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-4">
      {/* 顶部标题与多视图切换栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            <h4 className="text-sm font-bold text-white">
              {instrumentName} ({instrumentCode}) · 近 3 年历史价格相对分位走势图 (D3驱动)
            </h4>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            基于真实后复权收盘价，对比当前价格在近 1 年 / 近 3 年窗口中的相对高低位置（价格相对分位，非基本面估值）。
          </p>
        </div>

        {/* 视图切换按钮 */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setMetricMode('composite')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'composite' 
                ? 'bg-emerald-600 text-white font-semibold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            价格综合分位 (1年+3年)
          </button>
          <button
            onClick={() => setMetricMode('pe')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'pe' 
                ? 'bg-cyan-600 text-white font-semibold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            近1年相对分位
          </button>
          <button
            onClick={() => setMetricMode('pb')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'pb' 
                ? 'bg-purple-600 text-white font-semibold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            近3年相对分位
          </button>
          <button
            onClick={() => setMetricMode('both')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'both' 
                ? 'bg-slate-700 text-white font-semibold' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            双窗口对比
          </button>
        </div>
      </div>

      {/* D3 图表容器 */}
      <div ref={containerRef} className="w-full relative">
        <svg ref={svgRef} className="w-full overflow-visible" />

        {/* 交互式浮动气泡 Tooltip */}
        {hoveredPoint && tooltipPos && (
          <div
            className="absolute z-20 pointer-events-none p-3 bg-slate-950/95 border border-slate-700 rounded shadow-xl text-xs text-slate-200 flex flex-col gap-1.5 backdrop-blur-sm font-mono tabular-nums min-w-[190px]"
            style={{
              left: Math.min(containerRef.current ? containerRef.current.clientWidth - 210 : 300, tooltipPos.x + 12),
              top: Math.max(10, tooltipPos.y - 75),
            }}
          >
            <div className="font-sans font-bold text-white border-b border-slate-800 pb-1 flex justify-between">
              <span>{hoveredPoint.date} 价格相对分位</span>
              <span className="text-[10px] text-slate-400">
                {hoveredPoint.compositePercentile < 20 ? '极低位' : hoveredPoint.compositePercentile > 80 ? '高位' : '中位'}
              </span>
            </div>

            <div className="flex justify-between items-center text-emerald-400">
              <span className="font-sans text-slate-400">价格综合分位:</span>
              <span className="font-bold">{hoveredPoint.compositePercentile}%</span>
            </div>

            <div className="flex justify-between items-center text-cyan-400">
              <span className="font-sans text-slate-400">近1年价格分位:</span>
              <span>{hoveredPoint.pePercentile}%</span>
            </div>

            <div className="flex justify-between items-center text-purple-400">
              <span className="font-sans text-slate-400">近3年价格分位:</span>
              <span>{hoveredPoint.pbPercentile}%</span>
            </div>
          </div>
        )}
      </div>

      {/* 图例说明与近 3 年统计特征底条 */}
      {safeData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono tabular-nums pt-2 border-t border-slate-800/80">
          <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800/80 flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-400 font-sans">近3年价格最高位 (Peak)</span>
            <span className="font-bold text-red-400">{maxComposite}% 分位</span>
            <span className="text-[10px] text-slate-500 font-sans">近3年价格相对高位</span>
          </div>

          <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800/80 flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-400 font-sans">近3年价格最低位 (Trough)</span>
            <span className="font-bold text-emerald-400">{minComposite}% 分位</span>
            <span className="text-[10px] text-slate-500 font-sans">近3年价格相对低位</span>
          </div>

          <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800/80 flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-400 font-sans">近3年价格中位 (Median)</span>
            <span className="font-bold text-slate-200">{medianComposite}% 分位</span>
            <span className="text-[10px] text-slate-500 font-sans">历史常态均衡参考位</span>
          </div>

          <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800/80 flex flex-col gap-0.5">
            <span className="text-[11px] text-slate-400 font-sans">当前位置 vs 近3年最低位</span>
            <span className={`font-bold ${(lastDataPoint?.compositePercentile ?? 50) - minComposite < 15 ? 'text-emerald-400' : 'text-cyan-400'}`}>
              距低位 +{Math.max(0, (lastDataPoint?.compositePercentile ?? 50) - minComposite)}% 分位
            </span>
            <span className="text-[10px] text-slate-500 font-sans">
              {(lastDataPoint?.compositePercentile ?? 50) < 35 ? '依然贴近近3年价格底部区' : '已自底部产生适度修复'}
            </span>
          </div>
        </div>
      )}

      {/* 真实价格历史缺失时的空态 */}
      {safeData.length === 0 && (
        <div className="p-10 text-center text-slate-400 text-sm bg-slate-950/60 border border-slate-800 rounded-lg">
          暂无真实价格历史数据，无法绘制价格相对分位走势图。
        </div>
      )}
    </div>
  );
};
