import React, { useRef, useState, useMemo, useEffect } from 'react';
import * as d3 from 'd3';
import { AShareInstrument, HistoricalValuationPoint } from '../types/ashare';
import { generatePricePercentileHistory } from '../services/ashareStrategies';
import { 
  BarChart2, 
  AlertTriangle, 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Compass, 
  HelpCircle,
  Layers,
  ChevronRight,
  Sparkles
} from 'lucide-react';

interface HistoricalValuationRangeChartProps {
  historicalValuation?: HistoricalValuationPoint[];
  instrument: AShareInstrument;
  currentPEPercentile?: number;
  currentPBPercentile?: number;
  currentPETTM?: number;
  currentPB?: number;
}

export const HistoricalValuationRangeChart: React.FC<HistoricalValuationRangeChartProps> = ({
  historicalValuation,
  instrument,
  currentPEPercentile,
  currentPBPercentile,
  currentPETTM,
  currentPB
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [metricMode, setMetricMode] = useState<'both' | 'pe' | 'pb'>('both');
  const [hoveredPoint, setHoveredPoint] = useState<HistoricalValuationPoint | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(720);

  // 数据源：优先用外部/标的自带历史序列；缺失则由真实 parquet bars 派生（generatePricePercentileHistory），
  // 不再回退到任何合成 PE/PB 估值序列。无真实行情时返回 []，由下方空态提示。
  const valuationData = useMemo<HistoricalValuationPoint[]>(() => {
    if (historicalValuation && historicalValuation.length > 0) {
      return historicalValuation;
    }
    if (instrument.historicalValuation && instrument.historicalValuation.length > 0) {
      return instrument.historicalValuation;
    }
    return generatePricePercentileHistory(instrument);
  }, [historicalValuation, instrument]);

  // 当前分位/价格：优先用调用方显式传入；否则从真实序列末点（=最新收盘价分位）派生，确保"当前标记"与曲线末点对齐
  const lastPoint = valuationData[valuationData.length - 1];
  const effectivePEPct = currentPEPercentile ?? lastPoint?.pePercentile ?? instrument.pePercentile ?? 50;
  const effectivePBPct = currentPBPercentile ?? lastPoint?.pbPercentile ?? instrument.pbPercentile ?? 50;
  const effectivePE = currentPETTM ?? lastPoint?.pe ?? instrument.peTTM ?? 0;
  const effectivePB = currentPB ?? lastPoint?.pb ?? instrument.pb ?? 0;

  // 3年历史极值与统计区间计算
  const stats3Y = useMemo(() => {
    if (valuationData.length === 0) {
      return {
        peMinPct: 0, peMaxPct: 100, peMedianPct: 50,
        pbMinPct: 0, pbMaxPct: 100, pbMedianPct: 50,
        peMinVal: 0, peMaxVal: 0,
        pbMinVal: 0, pbMaxVal: 0,
      };
    }
    const pePcts = valuationData.map(d => d.pePercentile);
    const pbPcts = valuationData.map(d => d.pbPercentile);
    const peVals = valuationData.map(d => d.pe).filter(v => v > 0);
    const pbVals = valuationData.map(d => d.pb).filter(v => v > 0);

    const sortedPePcts = [...pePcts].sort((a, b) => a - b);
    const sortedPbPcts = [...pbPcts].sort((a, b) => a - b);

    return {
      peMinPct: Math.min(...pePcts),
      peMaxPct: Math.max(...pePcts),
      peMedianPct: sortedPePcts[Math.floor(sortedPePcts.length / 2)] || 50,
      pbMinPct: Math.min(...pbPcts),
      pbMaxPct: Math.max(...pbPcts),
      pbMedianPct: sortedPbPcts[Math.floor(sortedPbPcts.length / 2)] || 50,
      peMinVal: peVals.length ? Math.min(...peVals) : effectivePE * 0.7,
      peMaxVal: peVals.length ? Math.max(...peVals) : effectivePE * 1.4,
      pbMinVal: pbVals.length ? Math.min(...pbVals) : effectivePB * 0.7,
      pbMaxVal: pbVals.length ? Math.max(...pbVals) : effectivePB * 1.4,
    };
  }, [valuationData, effectivePE, effectivePB]);

  // 注：本图谱为"价格相对分位"，非 PE/PB 估值分位。价格处历史低位 ≠ 基本面低估，仅表示相对自身历史便宜。
  const getZoneInfo = (pct: number) => {
    if (pct < 20) {
      return {
        zone: 'UNDERVALUED',
        label: '价格低位 (<20%)',
        color: '#10B981',
        bgColor: 'bg-emerald-950/70',
        borderColor: 'border-emerald-700/60',
        textColor: 'text-emerald-400',
        badge: '价格处历史相对低位',
        suggestion: '当前价格位于自身历史（近1/近3年窗口）后 20% 分位，相对自身历史偏便宜，下行安全垫较厚',
        reference: '相对自身历史便宜',
      };
    } else if (pct <= 80) {
      return {
        zone: 'FAIR',
        label: '价格中位 (20%-80%)',
        color: '#38BDF8',
        bgColor: 'bg-sky-950/50',
        borderColor: 'border-sky-800/50',
        textColor: 'text-sky-400',
        badge: '价格中位常态区间',
        suggestion: '当前价格处于自身历史中位区间，遵循卡弗系统化波动率平价与动量常规预算',
        reference: '处于历史中位',
      };
    } else {
      return {
        zone: 'OVERVALUED',
        label: '价格高位 (>80%)',
        color: '#F43F5E',
        bgColor: 'bg-rose-950/70',
        borderColor: 'border-rose-700/60',
        textColor: 'text-rose-400',
        badge: '价格处历史相对高位',
        suggestion: '当前价格位于自身历史前 20% 分位，相对自身历史偏贵，注意回撤风险',
        reference: '相对自身历史偏贵',
      };
    }
  };

  const peZone = getZoneInfo(effectivePEPct);
  const pbZone = getZoneInfo(effectivePBPct);

  // 监听容器宽度变化以保持高响应性
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0] && entries[0].contentRect.width > 0) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // D3 渲染核心时间序列图表与三色带
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || valuationData.length === 0) return;

    const width = containerWidth || 700;
    const height = 310;
    const margin = { top: 28, right: 90, bottom: 42, left: 45 };
    const innerWidth = Math.max(200, width - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // X Scale: 3年季度序列
    const xScale = d3
      .scalePoint<string>()
      .domain(valuationData.map(d => d.date))
      .range([0, innerWidth])
      .padding(0.15);

    // Y Scale: 百分位 (0 - 100%)
    const yScale = d3
      .scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0]);

    // ==========================================
    // 1. 绘制核心色带区域（三色带：低估<20% / 中枢20-80% / 高估>80%）
    // ==========================================
    const colorBands = [
      {
        y0: 80,
        y1: 100,
        fill: 'rgba(244, 63, 94, 0.11)',
        label: '高估区域 (>80%)',
        subLabel: '泡沫减仓带',
        lineColor: '#F43F5E',
        textFill: '#FB7185',
      },
      {
        y0: 20,
        y1: 80,
        fill: 'rgba(56, 189, 248, 0.04)',
        label: '合理中枢 (20%-80%)',
        subLabel: '均值常态带',
        lineColor: '#475569',
        textFill: '#94A3B8',
      },
      {
        y0: 0,
        y1: 20,
        fill: 'rgba(16, 185, 129, 0.13)',
        label: '低估区域 (<20%)',
        subLabel: '安全边际带',
        lineColor: '#10B981',
        textFill: '#34D399',
      },
    ];

    colorBands.forEach(band => {
      const topY = yScale(band.y1);
      const bottomY = yScale(band.y0);
      const bandHeight = Math.abs(bottomY - topY);

      // 色带底色矩形
      g.append('rect')
        .attr('x', 0)
        .attr('y', topY)
        .attr('width', innerWidth)
        .attr('height', bandHeight)
        .attr('fill', band.fill);

      // 色带右侧语义标签
      const midY = topY + bandHeight / 2;
      g.append('text')
        .attr('x', innerWidth + 8)
        .attr('y', midY - 2)
        .attr('text-anchor', 'start')
        .attr('font-size', '10px')
        .attr('font-weight', 'bold')
        .attr('font-family', 'system-ui, sans-serif')
        .attr('fill', band.textFill)
        .text(band.label);

      g.append('text')
        .attr('x', innerWidth + 8)
        .attr('y', midY + 11)
        .attr('text-anchor', 'start')
        .attr('font-size', '9px')
        .attr('font-family', 'system-ui, sans-serif')
        .attr('fill', band.textFill)
        .attr('opacity', 0.7)
        .text(band.subLabel);
    });

    // 分界参考虚线 (20% 与 80%)
    [20, 80].forEach(threshold => {
      const yPos = yScale(threshold);
      const isLow = threshold === 20;

      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', yPos)
        .attr('y2', yPos)
        .attr('stroke', isLow ? '#10B981' : '#F43F5E')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '4,3')
        .attr('opacity', 0.75);

      // 左侧刻度高亮
      g.append('text')
        .attr('x', -8)
        .attr('y', yPos + 3)
        .attr('text-anchor', 'end')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('font-weight', 'bold')
        .attr('fill', isLow ? '#34D399' : '#FB7185')
        .text(`${threshold}%`);
    });

    // 50% 轴中线
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(50))
      .attr('y2', yScale(50))
      .attr('stroke', '#334155')
      .attr('stroke-width', 0.8)
      .attr('stroke-dasharray', '2,4')
      .attr('opacity', 0.6);

    // Y轴辅助刻度 (0, 50, 100)
    [0, 50, 100].forEach(tick => {
      g.append('text')
        .attr('x', -8)
        .attr('y', yScale(tick) + 3)
        .attr('text-anchor', 'end')
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('fill', '#64748B')
        .text(`${tick}%`);
    });

    // X轴刻度 (季度)
    valuationData.forEach((d, idx) => {
      const isLast = idx === valuationData.length - 1;
      const shouldShow = idx % 2 === 0 || isLast;
      if (!shouldShow) return;

      const xPos = xScale(d.date) ?? 0;
      g.append('text')
        .attr('x', xPos)
        .attr('y', innerHeight + 18)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('font-weight', isLast ? 'bold' : 'normal')
        .attr('fill', isLast ? '#38BDF8' : '#64748B')
        .text(isLast ? `${d.date}(现)` : d.date);
    });

    // ==========================================
    // 2. 曲线渐变 Defs 与折线生成器
    // ==========================================
    const defs = svg.append('defs');

    // PE 渐变面积
    const peGrad = defs.append('linearGradient')
      .attr('id', 'pe-area-gradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    peGrad.append('stop').attr('offset', '0%').attr('stop-color', '#06B6D4').attr('stop-opacity', 0.22);
    peGrad.append('stop').attr('offset', '100%').attr('stop-color', '#06B6D4').attr('stop-opacity', 0.0);

    // PB 渐变面积
    const pbGrad = defs.append('linearGradient')
      .attr('id', 'pb-area-gradient')
      .attr('x1', '0%').attr('y1', '0%')
      .attr('x2', '0%').attr('y2', '100%');
    pbGrad.append('stop').attr('offset', '0%').attr('stop-color', '#A855F7').attr('stop-opacity', 0.20);
    pbGrad.append('stop').attr('offset', '100%').attr('stop-color', '#A855F7').attr('stop-opacity', 0.0);

    // Line & Area Generators
    const peLineGen = d3.line<HistoricalValuationPoint>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(d.date) ?? 0)
      .y(d => yScale(d.pePercentile));

    const peAreaGen = d3.area<HistoricalValuationPoint>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(d.date) ?? 0)
      .y0(innerHeight)
      .y1(d => yScale(d.pePercentile));

    const pbLineGen = d3.line<HistoricalValuationPoint>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(d.date) ?? 0)
      .y(d => yScale(d.pbPercentile));

    const pbAreaGen = d3.area<HistoricalValuationPoint>()
      .curve(d3.curveMonotoneX)
      .x(d => xScale(d.date) ?? 0)
      .y0(innerHeight)
      .y1(d => yScale(d.pbPercentile));

    // 渲染 PB 面积与折线 (在 PE 前，便于叠层)
    if (metricMode === 'both' || metricMode === 'pb') {
      g.append('path')
        .datum(valuationData)
        .attr('fill', 'url(#pb-area-gradient)')
        .attr('d', pbAreaGen);

      g.append('path')
        .datum(valuationData)
        .attr('fill', 'none')
        .attr('stroke', '#A855F7')
        .attr('stroke-width', 2.2)
        .attr('d', pbLineGen);

      // PB 历史数据点
      valuationData.forEach(d => {
        g.append('circle')
          .attr('cx', xScale(d.date) ?? 0)
          .attr('cy', yScale(d.pbPercentile))
          .attr('r', 3)
          .attr('fill', '#A855F7')
          .attr('stroke', '#0F172A')
          .attr('stroke-width', 1.2);
      });
    }

    // 渲染 PE 面积与折线
    if (metricMode === 'both' || metricMode === 'pe') {
      g.append('path')
        .datum(valuationData)
        .attr('fill', 'url(#pe-area-gradient)')
        .attr('d', peAreaGen);

      g.append('path')
        .datum(valuationData)
        .attr('fill', 'none')
        .attr('stroke', '#06B6D4')
        .attr('stroke-width', 2.4)
        .attr('d', peLineGen);

      // PE 历史数据点
      valuationData.forEach(d => {
        g.append('circle')
          .attr('cx', xScale(d.date) ?? 0)
          .attr('cy', yScale(d.pePercentile))
          .attr('r', 3)
          .attr('fill', '#06B6D4')
          .attr('stroke', '#0F172A')
          .attr('stroke-width', 1.2);
      });
    }

    // ==========================================
    // 3. 当前点特别标注 (Current Pinned Point on Right Edge)
    // ==========================================
    const lastDataPoint = valuationData[valuationData.length - 1];
    const lastX = xScale(lastDataPoint.date) ?? innerWidth;

    if (lastDataPoint) {
      if (metricMode === 'both' || metricMode === 'pe') {
        const lastPEY = yScale(effectivePEPct);

        // PE 脉冲光环
        g.append('circle')
          .attr('cx', lastX)
          .attr('cy', lastPEY)
          .attr('r', 7)
          .attr('fill', 'none')
          .attr('stroke', '#06B6D4')
          .attr('stroke-width', 2)
          .attr('opacity', 0.6)
          .attr('class', 'animate-ping');

        g.append('circle')
          .attr('cx', lastX)
          .attr('cy', lastPEY)
          .attr('r', 5)
          .attr('fill', '#06B6D4')
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 2);

        // PE 当前值漂浮徽标
        const tagG = g.append('g').attr('transform', `translate(${lastX - 70}, ${lastPEY - 14})`);
        tagG.append('rect')
          .attr('x', 0)
          .attr('y', 0)
          .attr('width', 66)
          .attr('height', 18)
          .attr('rx', 4)
          .attr('fill', '#083344')
          .attr('stroke', '#06B6D4')
          .attr('stroke-width', 1);

        tagG.append('text')
          .attr('x', 33)
          .attr('y', 12)
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('font-family', 'monospace')
          .attr('font-weight', 'bold')
          .attr('fill', '#67E8F9')
          .text(`PE ${effectivePEPct}%`);
      }

      if (metricMode === 'both' || metricMode === 'pb') {
        const lastPBY = yScale(effectivePBPct);

        g.append('circle')
          .attr('cx', lastX)
          .attr('cy', lastPBY)
          .attr('r', 5)
          .attr('fill', '#A855F7')
          .attr('stroke', '#FFFFFF')
          .attr('stroke-width', 2);

        const tagG = g.append('g').attr('transform', `translate(${lastX - 70}, ${lastPBY + 4})`);
        tagG.append('rect')
          .attr('x', 0)
          .attr('y', 0)
          .attr('width', 66)
          .attr('height', 18)
          .attr('rx', 4)
          .attr('fill', '#3B0764')
          .attr('stroke', '#A855F7')
          .attr('stroke-width', 1);

        tagG.append('text')
          .attr('x', 33)
          .attr('y', 12)
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('font-family', 'monospace')
          .attr('font-weight', 'bold')
          .attr('fill', '#E9D5FF')
          .text(`PB ${effectivePBPct}%`);
      }
    }

    // ==========================================
    // 4. 交互式十字准星与鼠标悬停响应
    // ==========================================
    const focusG = g.append('g').style('display', 'none');

    // 垂直辅助线
    const vLine = focusG.append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');

    // 捕获鼠标事件的透明蒙版
    const bisect = d3.bisector<HistoricalValuationPoint, string>(d => d.date).center;

    svg
      .append('rect')
      .attr('transform', `translate(${margin.left},${margin.top})`)
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx, my] = d3.pointer(event);
        const dates = valuationData.map(d => d.date);
        
        // 寻找最近数据点
        let closestIndex = 0;
        let minDist = Infinity;
        valuationData.forEach((d, idx) => {
          const px = xScale(d.date) ?? 0;
          const dist = Math.abs(px - mx);
          if (dist < minDist) {
            minDist = dist;
            closestIndex = idx;
          }
        });

        const target = valuationData[closestIndex];
        if (target) {
          const tx = xScale(target.date) ?? 0;
          focusG.style('display', null);
          vLine.attr('x1', tx).attr('x2', tx);

          setHoveredPoint(target);
          setTooltipPos({
            x: margin.left + tx,
            y: margin.top + Math.min(my, innerHeight - 40)
          });
        }
      })
      .on('mouseleave', () => {
        focusG.style('display', 'none');
        setHoveredPoint(null);
        setTooltipPos(null);
      });

  }, [valuationData, containerWidth, metricMode, effectivePEPct, effectivePBPct]);

  return (
    <div 
      ref={containerRef}
      className="p-5 bg-gradient-to-b from-slate-900/90 to-slate-950 border border-slate-800 rounded-lg shadow-xl flex flex-col gap-5 relative overflow-hidden"
    >
      {/* 顶部标题与多维控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400">
            <BarChart2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 tracking-tight">
                历史价格分位区间图谱（基于真实后复权收盘价）
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-semibold">
                historicalValuation 驱动
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                {instrument.name} ({instrument.code})
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              以真实后复权收盘价，量化标的当前价格处于自身历史（近1年 / 近3年窗口）的相对分位，通过低位/中位/高位三色带呈现。
            </p>
          </div>
        </div>

        {/* 指标显示切换 */}
        <div className="flex items-center gap-1 p-1 bg-slate-950/80 border border-slate-800 rounded-lg text-xs font-mono">
          <button
            onClick={() => setMetricMode('both')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'both'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            近1年 + 近3年 双轨
          </button>
          <button
            onClick={() => setMetricMode('pe')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'pe'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            仅 近1年分位
          </button>
          <button
            onClick={() => setMetricMode('pb')}
            className={`px-2.5 py-1 rounded transition-colors ${
              metricMode === 'pb'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            仅 近3年分位
          </button>
        </div>
      </div>

      {/* 空态：无真实价格历史（不再用合成 PE/PB 填充） */}
      {valuationData.length === 0 ? (
        <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
          <div className="leading-relaxed">
            <span className="font-semibold text-slate-200">暂无真实价格历史</span>：
            {instrument.name} 当前未加载到真实后复权日线（parquet 行情），无法绘制价格分位区间。请先在数据适配（adapter）中载入该标的行情。
          </div>
        </div>
      ) : (
        <>
          {/* ======================================================== */}
          {/* 核心亮点：相对于历史 3 年的区间标尺条 (Range Horizon Gauges) */}
          {/* ======================================================== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PE 3年历史区间定位标尺 */}
            <div className={`p-3.5 rounded-lg border ${peZone.borderColor} ${peZone.bgColor} flex flex-col gap-2.5 transition-all`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                <span className="text-xs font-bold text-slate-200">近 1 年价格分位区间（真实收盘价）</span>
                <span className="text-xs font-mono font-semibold text-cyan-300">
                  {effectivePE > 0 ? `${effectivePE.toFixed(2)}` : '--'}
                </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                    peZone.zone === 'UNDERVALUED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                    peZone.zone === 'OVERVALUED' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                    'bg-sky-950 text-sky-300 border border-sky-700'
                  }`}>
                    当前: {effectivePEPct}% 分位 · {peZone.label}
                  </span>
                </div>
              </div>

              {/* 三色区间渐变标尺轨道 */}
              <div className="relative pt-4 pb-2">
                {/* 轨道底图：三段色带 */}
                <div className="h-3 w-full rounded-full flex overflow-hidden border border-slate-700/60 shadow-inner">
                  {/* 低估带 0-20% */}
                  <div className="w-[20%] bg-emerald-500/40 relative group">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-emerald-200 opacity-90">
                      &lt;20% 价格低位
                    </span>
                  </div>
                  {/* 中枢带 20-80% */}
                  <div className="w-[60%] bg-sky-500/20 relative group border-x border-slate-700/60">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-sky-200 opacity-80">
                      20%-80% 价格中位
                    </span>
                  </div>
                  {/* 高估带 80-100% */}
                  <div className="w-[20%] bg-rose-500/40 relative group">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-rose-200 opacity-90">
                      &gt;80% 价格高位
                    </span>
                  </div>
                </div>

                {/* 当前分位点滑块指针 (精确位置) */}
                <div 
                  className="absolute top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-300"
                  style={{ left: `${Math.max(2, Math.min(98, effectivePEPct))}%` }}
                >
                  <div className="w-3.5 h-3.5 rotate-45 bg-cyan-400 border-2 border-white shadow-lg"></div>
                  <div className="w-0.5 h-4 bg-cyan-300"></div>
                </div>

                {/* 区间极值与当前点注记 */}
                <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-2">
                  <span>区间极低: {stats3Y.peMinPct}% ({stats3Y.peMinVal.toFixed(2)})</span>
                  <span className="text-cyan-300 font-bold">现值: {effectivePEPct}% 分位</span>
                  <span>区间极高: {stats3Y.peMaxPct}% ({stats3Y.peMaxVal.toFixed(2)})</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2 rounded border border-slate-800/80 leading-relaxed flex items-center justify-between">
                <span>{peZone.suggestion}</span>
                <span className="font-mono font-bold text-cyan-300 shrink-0 ml-2">{peZone.reference}</span>
              </div>
            </div>

            {/* PB 3年历史区间定位标尺 */}
            <div className={`p-3.5 rounded-lg border ${pbZone.borderColor} ${pbZone.bgColor} flex flex-col gap-2.5 transition-all`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
                <span className="text-xs font-bold text-slate-200">近 3 年价格分位区间（真实收盘价）</span>
                <span className="text-xs font-mono font-semibold text-purple-300">
                  {effectivePB > 0 ? `${effectivePB.toFixed(2)}` : '--'}
                </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded font-mono ${
                    pbZone.zone === 'UNDERVALUED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' :
                    pbZone.zone === 'OVERVALUED' ? 'bg-rose-950 text-rose-300 border border-rose-700' :
                    'bg-purple-950 text-purple-300 border border-purple-700'
                  }`}>
                    当前: {effectivePBPct}% 分位 · {pbZone.label}
                  </span>
                </div>
              </div>

              {/* 三色区间渐变标尺轨道 */}
              <div className="relative pt-4 pb-2">
                <div className="h-3 w-full rounded-full flex overflow-hidden border border-slate-700/60 shadow-inner">
                  <div className="w-[20%] bg-emerald-500/40 relative">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-emerald-200 opacity-90">
                      &lt;20% 价格低位
                    </span>
                  </div>
                  <div className="w-[60%] bg-purple-500/20 relative border-x border-slate-700/60">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-purple-200 opacity-80">
                      20%-80% 价格中位
                    </span>
                  </div>
                  <div className="w-[20%] bg-rose-500/40 relative">
                    <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-rose-200 opacity-90">
                      &gt;80% 价格高位
                    </span>
                  </div>
                </div>

                {/* 当前PB分位点滑块指针 */}
                <div 
                  className="absolute top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none transition-all duration-300"
                  style={{ left: `${Math.max(2, Math.min(98, effectivePBPct))}%` }}
                >
                  <div className="w-3.5 h-3.5 rotate-45 bg-purple-400 border-2 border-white shadow-lg"></div>
                  <div className="w-0.5 h-4 bg-purple-300"></div>
                </div>

                <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-2">
                  <span>区间极低: {stats3Y.pbMinPct}% ({stats3Y.pbMinVal.toFixed(2)})</span>
                  <span className="text-purple-300 font-bold">现值: {effectivePBPct}% 分位</span>
                  <span>区间极高: {stats3Y.pbMaxPct}% ({stats3Y.pbMaxVal.toFixed(2)})</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-300 bg-slate-950/60 p-2 rounded border border-slate-800/80 leading-relaxed flex items-center justify-between">
                <span>{pbZone.suggestion}</span>
                <span className="font-mono font-bold text-purple-300 shrink-0 ml-2">{pbZone.reference}</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ======================================================== */}
      {/* 核心 SVG 时间序列图表区（带低估/中枢/高估三色带与季度轨迹） */}
      {/* ======================================================== */}
      <div className="relative w-full overflow-hidden bg-slate-950/80 border border-slate-800/80 rounded-lg p-2">
        <div className="flex items-center justify-between px-2 pt-1 pb-2 text-xs">
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
              <span className="font-mono">近1年价格分位点轨迹</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-purple-400 inline-block"></span>
              <span className="font-mono">近3年价格分位点轨迹</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span>绿色底带: &lt;20% 价格低位</span>
            <span>·</span>
            <span>蓝色底带: 20-80% 价格中位</span>
            <span>·</span>
            <span>红色底带: &gt;80% 价格高位</span>
          </div>
        </div>

        {/* SVG 主容器 */}
        <div className="w-full">
          <svg ref={svgRef} className="w-full block" />
        </div>

        {/* 鼠标悬停交互浮窗 Tooltip */}
        {hoveredPoint && tooltipPos && (
          <div
            className="absolute z-20 pointer-events-none p-3 bg-slate-900/95 border border-slate-700/80 rounded-lg shadow-2xl text-xs flex flex-col gap-1.5 backdrop-blur font-mono transform -translate-x-1/2 -translate-y-full"
            style={{ left: tooltipPos.x, top: tooltipPos.y - 12 }}
          >
            <div className="flex items-center justify-between gap-3 pb-1 border-b border-slate-800">
              <span className="font-bold text-white">{hoveredPoint.date}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                hoveredPoint.pePercentile < 20 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                hoveredPoint.pePercentile > 80 ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                'bg-slate-800 text-slate-300'
              }`}>
                {hoveredPoint.pePercentile < 20 ? '价格低位' : hoveredPoint.pePercentile > 80 ? '价格高位' : '价格中位'}
              </span>
            </div>

            <div className="flex flex-col gap-1 text-[11px]">
              <div className="flex justify-between gap-4">
                <span className="text-cyan-400">近1年价格分位:</span>
                <span className="text-white font-bold">{hoveredPoint.pePercentile}% ({hoveredPoint.pe.toFixed(2)})</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-purple-400">近3年价格分位:</span>
                <span className="text-white font-bold">{hoveredPoint.pbPercentile}% ({hoveredPoint.pb.toFixed(2)})</span>
              </div>
              <div className="flex justify-between gap-4 pt-1 border-t border-slate-800 text-slate-400">
                <span>综合价格分位:</span>
                <span className="text-emerald-400 font-bold">{hoveredPoint.compositePercentile}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 底部3年极值统计与策略联动小卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
        <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">近1年价格最低分位</span>
          <div className="mt-1">
            <span className="text-emerald-400 font-bold text-sm">{stats3Y.peMinPct}% 分位</span>
            <span className="text-[10px] text-slate-400 block">({stats3Y.peMinVal.toFixed(2)})</span>
          </div>
        </div>

        <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">近1年价格中位分位</span>
          <div className="mt-1">
            <span className="text-sky-400 font-bold text-sm">{stats3Y.peMedianPct}% 分位</span>
            <span className="text-[10px] text-slate-400 block">历史中位基准</span>
          </div>
        </div>

        <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">近1年价格最高分位</span>
          <div className="mt-1">
            <span className="text-rose-400 font-bold text-sm">{stats3Y.peMaxPct}% 分位</span>
            <span className="text-[10px] text-slate-400 block">({stats3Y.peMaxVal.toFixed(2)})</span>
          </div>
        </div>

        <div className="p-2.5 bg-slate-950/70 border border-slate-800/80 rounded flex flex-col justify-between">
          <span className="text-slate-400 text-[11px]">价格分位联动参考</span>
          <div className="mt-1">
            <span className={`text-sm font-bold ${peZone.textColor}`}>
              {peZone.reference}
            </span>
            <span className="text-[10px] text-slate-400 block">{peZone.badge}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
