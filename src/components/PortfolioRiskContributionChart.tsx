import React, { useState, useMemo, useEffect } from 'react';
import { PositionCalculation, CarverSettings, AShareBar } from '../types/ashare';
import { AShareDataService } from '../services/apiClient';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  BarChart, 
  Bar, 
  AreaChart,
  Area,
  XAxis, 
  YAxis, 
  CartesianGrid,
  Legend
} from 'recharts';
import { 
  PieChart as PieIcon, 
  BarChart3, 
  LineChart as LineChartIcon,
  Flame,
  ShieldAlert, 
  Info, 
  Sparkles,
  Maximize2,
  X
} from 'lucide-react';

interface PortfolioRiskContributionChartProps {
  positions: PositionCalculation[];
  settings: CarverSettings;
}

// Distinct, accessible palette for multi-asset classes
const ASSET_COLORS: { [key: string]: string } = {
  '510300': '#3B82F6', // 沪深300: Blue
  '510500': '#06B6D4', // 中证500: Cyan
  '588000': '#EC4899', // 科创50: Pink/Rose
  '512890': '#F59E0B', // 红利低波: Amber
  '511010': '#10B981', // 国债ETF: Emerald
  '518880': '#EAB308', // 黄金ETF: Gold
  '513100': '#8B5CF6', // 纳指ETF: Purple
  '601857': '#64748B', // 中国石油: Slate
};

const DEFAULT_PALETTE = ['#3B82F6', '#06B6D4', '#EC4899', '#F59E0B', '#10B981', '#EAB308', '#8B5CF6', '#14B8A6'];

// Get heat color based on risk contribution percentage
const getRiskHeatColor = (pct: number) => {
  if (pct >= 25) return '#F43F5E'; // High risk: Rose
  if (pct >= 18) return '#FB923C'; // Elevated: Orange
  if (pct >= 12) return '#FBBF24'; // Medium: Amber
  if (pct >= 6) return '#34D399';  // Balanced: Emerald
  return '#38BDF8';               // Low/Ballast: Sky
};

export const PortfolioRiskContributionChart: React.FC<PortfolioRiskContributionChartProps> = ({
  positions,
  settings,
}) => {
  // Tabs: 'donut' (风险环形), 'equity' (组合净值曲线), 'heatmap' (波动热力对比), 'bar' (资金 vs 风险)
  const [chartMode, setChartMode] = useState<'donut' | 'equity' | 'heatmap' | 'bar'>('donut');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // 按需加载全量 K 线：/api/ashare/instruments 已 strip bars（响应 17MB → 200KB），
  // 净值曲线/热力图需要的 bars 经 /api/ashare/bars/:code 按需拉取，本地缓存。
  const [barsMap, setBarsMap] = useState<Map<string, AShareBar[]>>(new Map());
  const neededCodes = useMemo(() => {
    const codes = new Set<string>();
    (Array.isArray(positions) ? positions : []).forEach((p) => {
      if (p?.instrument?.code) codes.add(p.instrument.code);
    });
    return [...codes];
  }, [positions]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const code of neededCodes) {
        if (cancelled) return;
        try {
          // 只要最近 90 根（算 60 日净值窗口足够）——旧实现拉全量：中国石油 4594 根单只 ~1MB，
          // 9 腿顺序拉取既慢又浪费。服务端 ?limit= 会做尾部截断。
          const bars = await AShareDataService.fetchInstrumentBars(code, 90);
          if (!cancelled && bars.length > 0) {
            setBarsMap((prev) => {
              if (prev.has(code)) return prev;
              const next = new Map(prev);
              next.set(code, bars);
              return next;
            });
          }
        } catch {
          /* 单只失败不阻塞其余 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [neededCodes.join(',')]);

  // 1. Static & Standalone Risk contribution per instrument
  const chartData = useMemo(() => {
    const validPositions = Array.isArray(positions) 
      ? positions.filter(p => p && p.instrument && p.currentShares > 0)
      : [];

    const rawItems = validPositions.map((p, idx) => {
      const inst = p.instrument;
      const price = inst.currentPrice || 1.0;
      const vol = inst.annualizedVol || 0.18;
      const shares = p.currentShares || 0;
      const marketVal = shares * price;
      const dailyRisk = marketVal * (vol / Math.sqrt(250));

      return {
        id: inst.id,
        code: inst.code,
        name: inst.name,
        category: inst.category,
        marketValue: marketVal,
        annualVol: vol,
        dailyRisk,
        targetBudgetWeight: inst.riskBudgetWeight,
        color: ASSET_COLORS[inst.id] || DEFAULT_PALETTE[idx % DEFAULT_PALETTE.length],
      };
    });

    const totalDailyRisk = rawItems.reduce((acc, item) => acc + item.dailyRisk, 0);
    const totalEquity = rawItems.reduce((acc, item) => acc + item.marketValue, 0);

    return rawItems.map(item => {
      const riskContribPct = totalDailyRisk > 0 ? (item.dailyRisk / totalDailyRisk) * 100 : 0;
      const capitalWeightPct = totalEquity > 0 ? (item.marketValue / totalEquity) * 100 : 0;
      const targetBudgetPct = (item.targetBudgetWeight || 0.15) * 100;
      const heatColor = getRiskHeatColor(riskContribPct);

      return {
        ...item,
        riskContributionPct: Number(riskContribPct.toFixed(1)),
        capitalWeightPct: Number(capitalWeightPct.toFixed(1)),
        targetBudgetPct: Number(targetBudgetPct.toFixed(1)),
        riskCapitalRatio: capitalWeightPct > 0 ? Number((riskContribPct / capitalWeightPct).toFixed(2)) : 1.0,
        heatColor,
      };
    }).sort((a, b) => b.riskContributionPct - a.riskContributionPct);
  }, [positions]);

  const totalRiskBudgeted = chartData.reduce((acc, d) => acc + d.dailyRisk, 0);

  // 2. 组合净值曲线：按**交易日对齐**回溯最近 60 个交易日（2026-10-15 修正）
  //
  // 旧实现按**数组下标**取各腿 bars[i]：各腿历史长度差异极大（红利低波 1398 根、中国石油 4594 根），
  // 同一个 index 会落在完全不同的日期上（实测 index=1338 时 510300→2018-07-06、601857→2013-05-21、
  // 512890→2026-07-16）；而日期标签在 forEach 里被反复覆盖，最终取"最后一个腿"的日期
  // → 横轴显示成 2024-12~2025-03（用户看到"日期不是最新"）。更严重的是单日收益是**跨日期混算**的，
  // 整条曲线（含基准）在数值上都无意义。现在改为：取各腿共同交易日 → 按日期查表取 close。
  const NAV_LOOKBACK = 60;
  const historicalNAVData = useMemo(() => {
    const barsOf = (p: any): AShareBar[] => barsMap.get(p.instrument.code) || p.instrument.bars || [];
    // 只保留真正有持仓的腿：无持仓腿既不该进组合收益，也不该决定共同日期窗口
    // （旧实现里 513520 持仓为 0 却决定了整条曲线的日期标签）
    const validPositions = (Array.isArray(positions) ? positions : []).filter(
      (p) => p && p.instrument && (p.currentShares || 0) > 0 && barsOf(p).length > 30,
    );
    if (validPositions.length === 0) return [];

    const totalEquity = validPositions.reduce(
      (acc, p) => acc + (p.currentShares || 0) * (p.instrument.currentPrice || 1),
      0,
    );

    // 每腿建立「交易日 → close」索引（按日期对齐的唯一依据）
    const seriesList = validPositions.map((p) => {
      const byDate = new Map<string, number>();
      for (const b of barsOf(p)) {
        if (b?.tradeDate && b.close > 0) byDate.set(b.tradeDate, b.close);
      }
      const mv = (p.currentShares || 0) * (p.instrument.currentPrice || 1);
      return {
        inst: p.instrument,
        weight: totalEquity > 0 ? mv / totalEquity : 1 / validPositions.length,
        byDate,
      };
    });

    // 共同交易日 = 各腿都有数据的日期交集（升序）
    const allDateLists = seriesList.map((s) => [...s.byDate.keys()]);
    const [firstList, ...others] = allDateLists;
    const othersSets = others.map((l) => new Set(l));
    const commonDates = firstList.filter((d) => othersSets.every((s) => s.has(d))).sort();
    if (commonDates.length < 2) return [];
    // +1 根起点用于计算首日收益 → 正好产出 NAV_LOOKBACK 个交易日
    const window = commonDates.slice(-(NAV_LOOKBACK + 1));

    // 基准：优先沪深300；**组合里没有 510300 时不能拿"第一条腿"冒充沪深300**
    // （poorlab11 是 11 只个股等权，回退到 series[0] = 农业银行，旧版却把它标成「沪深300 买入持有」）
    const bench = seriesList.find((s) => s.inst.id === '510300') ?? seriesList[0];
    const benchLabel =
      bench.inst.id === '510300' ? '沪深300 买入持有' : `${bench.inst.name} 买入持有 (${String(bench.inst.code).split('.')[0]})`;

    let portAccum = 1.0;
    let benchAccum = 1.0;
    const points = [];
    for (let i = 0; i < window.length; i++) {
      const date = window[i];
      if (i > 0) {
        const prevDate = window[i - 1];
        let dayReturn = 0;
        for (const s of seriesList) {
          const prev = s.byDate.get(prevDate);
          const curr = s.byDate.get(date);
          if (prev && curr && prev > 0 && curr > 0) dayReturn += (curr / prev - 1) * s.weight;
        }
        portAccum *= 1 + dayReturn;
        const bp = bench.byDate.get(prevDate);
        const bc = bench.byDate.get(date);
        benchAccum *= 1 + (bp && bc && bp > 0 && bc > 0 ? bc / bp - 1 : 0);
      }
      points.push({
        date: date.slice(5), // MM-DD（保持原显示风格）
        fullDate: date,
        portfolioNAV: Number(portAccum.toFixed(4)),
        csi300NAV: Number(benchAccum.toFixed(4)),
        portfolioReturnPct: Number(((portAccum - 1) * 100).toFixed(2)),
        csiReturnPct: Number(((benchAccum - 1) * 100).toFixed(2)),
        benchLabel,
      });
    }

    return points;
  }, [positions, barsMap]);

  /** 净值曲线实际窗口（真实日期）+ 基准腿身份 + 参与腿数/市值，供 UI 标注 */
  const navWindow = useMemo(() => {
    if (!historicalNAVData.length) return null;
    const first = historicalNAVData[0].fullDate;
    const last = historicalNAVData[historicalNAVData.length - 1].fullDate;
    const held = (Array.isArray(positions) ? positions : []).filter(
      (p) => p && p.instrument && (p.currentShares || 0) > 0,
    );
    // 首点只是收益率累乘的起点锚，真正的"交易日数"= 点数 − 1（= NAV_LOOKBACK）
    return {
      first,
      last,
      days: Math.max(0, historicalNAVData.length - 1),
      benchLabel: (historicalNAVData[0] as any).benchLabel as string | undefined,
      // 腿数与市值明示：不同组合的曲线数值可能很接近（子集+涨跌抵消），
      // 不给这两个数用户无法判断"是不是没切换成功"
      legs: held.length,
      exposure: held.reduce((a, p) => a + (p.currentShares || 0) * (p.instrument.currentPrice || 1), 0),
    };
  }, [historicalNAVData, positions]);

  // Custom tooltips
  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-md shadow-xl text-xs z-50">
          <div className="flex items-center gap-2 mb-1">
            <span 
              className="w-2.5 h-2.5 rounded-full inline-block" 
              style={{ backgroundColor: data.color }} 
            />
            <span className="font-bold text-white">{data.name}</span>
            <span className="text-[10px] text-slate-400 font-mono">({data.code})</span>
          </div>
          <div className="space-y-1 font-mono text-[11px] pt-1 border-t border-slate-800">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">风险贡献比例:</span>
              <span className="text-emerald-400 font-bold">{data.riskContributionPct}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">资金市值占比:</span>
              <span className="text-slate-200">{data.capitalWeightPct}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">年化波动率:</span>
              <span className="text-cyan-400">{(data.annualVol * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">日均风险承担:</span>
              <span className="text-amber-400">±¥{Math.round(data.dailyRisk).toLocaleString()}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomNAVTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const p = payload[0]?.payload;
      return (
        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-md shadow-xl text-xs z-50">
          <div className="font-bold text-slate-300 mb-1 font-mono">{label} 累计净值</div>
          <div className="space-y-1 font-mono text-[11px]">
            <div className="flex items-center justify-between gap-4">
              <span className="text-emerald-400 font-sans">卡弗组合（当前持仓）:</span>
              <span className="font-bold text-white tabular-nums">{p.portfolioNAV} ({(p.portfolioReturnPct >= 0 ? '+' : '')}{p.portfolioReturnPct}%)</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-rose-400 font-sans">{p.benchLabel || '基准 买入持有'}:</span>
              <span className="font-bold text-slate-300 tabular-nums">{p.csi300NAV} ({(p.csiReturnPct >= 0 ? '+' : '')}{p.csiReturnPct}%)</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomHeatmapTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0]?.payload;
      return (
        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-md shadow-xl text-xs z-50">
          <div className="font-bold text-white mb-1">{d.name} ({d.code})</div>
          <div className="space-y-1 font-mono text-[11px] pt-1 border-t border-slate-800">
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">风险贡献热力值:</span>
              <span className="font-bold" style={{ color: d.heatColor }}>{d.riskContributionPct}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">标的自身波动率:</span>
              <span className="text-cyan-400">{(d.annualVol * 100).toFixed(1)}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">资金市值占比:</span>
              <span className="text-slate-300">{d.capitalWeightPct}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-slate-400 font-sans">风险/资金杠杆比:</span>
              <span className="text-amber-400">{d.riskCapitalRatio}x</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) {
    return (
      <div className="p-4 bg-slate-900/60 rounded border border-slate-800 flex items-center justify-center text-xs text-slate-500">
        暂无持仓风险数据
      </div>
    );
  }

  return (
    <>
      <div className="p-3.5 bg-slate-900/80 rounded border border-slate-800 flex flex-col justify-between h-full min-h-[175px] text-xs">
        {/* 头部标题与视图切换 */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 gap-1">
          <div className="flex items-center gap-1.5">
            <div className="p-1 rounded bg-indigo-950/70 text-indigo-400 border border-indigo-800/50">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-white tracking-wide text-xs">风险与净值动态分析</span>
          </div>

          {/* 4 种可视化模式切换 */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px] gap-0.5">
            <button
              onClick={() => setChartMode('donut')}
              title="风险预算环形图"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                chartMode === 'donut' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <PieIcon className="w-3 h-3" />
              <span>环形</span>
            </button>
            <button
              onClick={() => setChartMode('equity')}
              title="60日多资产组合净值走势"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                chartMode === 'equity' ? 'bg-emerald-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <LineChartIcon className="w-3 h-3 text-emerald-300" />
              <span>净值</span>
            </button>
            <button
              onClick={() => setChartMode('heatmap')}
              title="各标的波动贡献热力对比"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                chartMode === 'heatmap' ? 'bg-rose-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Flame className="w-3 h-3 text-rose-300" />
              <span>热力</span>
            </button>
            <button
              onClick={() => setChartMode('bar')}
              title="资金占比 vs 风险贡献对比"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                chartMode === 'bar' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              <span>对比</span>
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              title="全屏放大查看"
              className="p-1 hover:text-white text-slate-500 rounded hover:bg-slate-800 transition-colors ml-0.5"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 图表主显示区域 */}
        <div className="relative w-full h-[120px] my-1">
          {chartMode === 'donut' && (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<CustomPieTooltip />} />
                <Pie
                  data={chartData}
                  dataKey="riskContributionPct"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={52}
                  paddingAngle={3}
                  onMouseEnter={(_, index) => setActiveSegmentIndex(index)}
                  onMouseLeave={() => setActiveSegmentIndex(null)}
                >
                  {chartData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.color}
                      stroke={activeSegmentIndex === index ? '#FFFFFF' : '#0F172A'}
                      strokeWidth={activeSegmentIndex === index ? 2 : 1}
                      className="cursor-pointer transition-all duration-200"
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'equity' && (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={historicalNAVData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 9 }} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748B', fontSize: 9 }} />
                <Tooltip content={<CustomNAVTooltip />} />
                <Area type="monotone" dataKey="portfolioNAV" name="卡弗组合" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#colorPortfolio)" />
                <Area type="monotone" dataKey="csi300NAV" name={navWindow?.benchLabel || '基准'} stroke="#F43F5E" strokeWidth={1.5} fillOpacity={0} strokeDasharray="3 3" />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'heatmap' && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
                <XAxis type="number" domain={[0, 'auto']} hide />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 9 }} width={70} />
                <Tooltip content={<CustomHeatmapTooltip />} />
                <Bar dataKey="riskContributionPct" name="风险热力贡献%" radius={[0, 3, 3, 0]} barSize={6}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.heatColor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {chartMode === 'bar' && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 2, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
                <XAxis type="number" domain={[0, 'auto']} hide />
                <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 9 }} width={70} />
                <Tooltip content={<CustomHeatmapTooltip />} />
                <Bar dataKey="riskContributionPct" name="风险贡献%" fill="#6366F1" radius={[0, 2, 2, 0]} barSize={4} />
                <Bar dataKey="capitalWeightPct" name="资金占比%" fill="#06B6D4" radius={[0, 2, 2, 0]} barSize={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 底部紧凑图例 */}
        <div className="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-slate-800/80 text-[10px] text-slate-400">
          <div className="flex items-center gap-2 overflow-x-auto max-w-[280px] no-scrollbar">
            {chartData.slice(0, 4).map((d) => (
              <span key={d.id} className="flex items-center gap-1 shrink-0 font-mono">
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                <span className="text-slate-300 font-sans">{d.name.replace('ETF', '')}</span>
                <span className="text-slate-400">{d.riskContributionPct}%</span>
              </span>
            ))}
            {chartData.length > 4 && (
              <span className="text-slate-500">+{chartData.length - 4}只</span>
            )}
          </div>

          <div className="flex items-center gap-1 text-slate-500 font-mono text-[9px]">
            {chartMode === 'equity' && navWindow ? (
              // 净值窗口按真实交易日对齐后回显，避免用户以为"日期没更新"
              <span title="按各腿共同交易日对齐，权重 = 当前持仓市值占比">
                近 {navWindow.days} 个交易日：{navWindow.first.slice(5)} ~ {navWindow.last.slice(5)} · {navWindow.legs} 腿 · 市值 ¥
                {(navWindow.exposure / 10000).toFixed(1)}万
              </span>
            ) : (
              <span>日风险: ±¥{Math.round(totalRiskBudgeted).toLocaleString()}</span>
            )}
          </div>
        </div>
      </div>

      {/* 放大查看模态框 (Modal) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            {/* 模态框顶部 */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  多资产组合风险预算与净值归因深度视图 (Recharts Analytics)
                </h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 模态框内容 */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* 净值对比曲线大图 */}
              <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <LineChartIcon className="w-4 h-4 text-emerald-400" />
                    <span>近 60 个交易日模拟净值走势 · 对比 {navWindow?.benchLabel || '基准 买入持有'}</span>
                    {navWindow && (
                      <span className="text-[10px] font-mono text-slate-400 font-normal">
                        （近 {navWindow.days} 个交易日：{navWindow.first} ~ {navWindow.last} · {navWindow.legs} 腿 · 市值 ¥
                        {Math.round(navWindow.exposure).toLocaleString()} · 按共同交易日对齐）
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-emerald-400 flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" /> 卡弗组合
                    </span>
                    <span className="text-rose-400 flex items-center gap-1">
                      <span className="w-2.5 h-0.5 bg-rose-400 inline-block" /> 沪深300
                    </span>
                  </div>
                </div>
                <div className="w-full h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={historicalNAVData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="modalColorPortfolio" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="date" tick={{ fill: '#64748B', fontSize: 10 }} />
                      <YAxis domain={['auto', 'auto']} tick={{ fill: '#64748B', fontSize: 10 }} />
                      <Tooltip content={<CustomNAVTooltip />} />
                      <Area type="monotone" dataKey="portfolioNAV" name="卡弗组合" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#modalColorPortfolio)" />
                      <Area type="monotone" dataKey="csi300NAV" name={navWindow?.benchLabel || '基准'} stroke="#F43F5E" strokeWidth={1.5} fillOpacity={0} strokeDasharray="3 3" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* 风险热力明细表与条形图 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800">
                  <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-1.5">
                    <Flame className="w-4 h-4 text-rose-400" />
                    <span>各标的风险暴露热力值对比</span>
                  </h4>
                  <div className="w-full h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 15, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
                        <XAxis type="number" domain={[0, 'auto']} tick={{ fill: '#64748B', fontSize: 9 }} />
                        <YAxis type="category" dataKey="name" tick={{ fill: '#94A3B8', fontSize: 10 }} width={80} />
                        <Tooltip content={<CustomHeatmapTooltip />} />
                        <Bar dataKey="riskContributionPct" name="风险贡献%" radius={[0, 4, 4, 0]} barSize={10}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-modal-${index}`} fill={entry.heatColor} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 flex flex-col justify-between">
                  <h4 className="text-xs font-bold text-white mb-2 flex items-center gap-1.5">
                    <PieIcon className="w-4 h-4 text-indigo-400" />
                    <span>资金占用 vs 真实风险暴露对应关系</span>
                  </h4>
                  <div className="space-y-2 overflow-y-auto max-h-[220px] pr-1">
                    {chartData.map(d => (
                      <div key={d.id} className="p-2 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                          <span className="font-sans font-medium text-slate-200">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400 text-[11px]">资金: {d.capitalWeightPct}%</span>
                          <span className="font-bold" style={{ color: d.heatColor }}>风险: {d.riskContributionPct}%</span>
                          <span className="text-[10px] text-slate-500 font-sans">({d.riskCapitalRatio}x 风险杠杆)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
