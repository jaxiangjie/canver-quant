import React, { useState, useMemo } from 'react';
import { 
  AShareInstrument, 
  CarverSettings, 
  PositionCalculation 
} from '../types/ashare';
import { 
  computeUniverseAnalytics, 
  CHINA_10Y_BOND_YIELD 
} from '../services/assetAnalyticsEngine';
import { generatePricePercentileHistory } from '../services/ashareStrategies';
import { ValueMomentumScatterMatrix } from './ValueMomentumScatterMatrix';
import { InstrumentPriceTrendChart } from './InstrumentPriceTrendChart';
import { ValuationHistoryChart } from './ValuationHistoryChart';
import { HistoricalValuationRangeChart } from './HistoricalValuationRangeChart';
import { 
  Radar, 
  Compass, 
  HelpCircle, 
  BookOpen, 
  TrendingUp, 
  TrendingDown, 
  ShieldCheck, 
  AlertTriangle, 
  Sliders, 
  Info, 
  Layers, 
  Scale, 
  Activity, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp,
  Percent,
  Sparkles,
  ArrowRight,
  Database
} from 'lucide-react';

interface InstrumentDeepAnalysisPanelProps {
  universe: AShareInstrument[];
  positions: PositionCalculation[];
  settings: CarverSettings;
  onNavigateToExecution?: () => void;
}

export const InstrumentDeepAnalysisPanel: React.FC<InstrumentDeepAnalysisPanelProps> = ({
  universe,
  positions,
  settings,
  onNavigateToExecution
}) => {
  const [selectedId, setSelectedId] = useState<string>(universe[0]?.id || '510300');
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'deepdive' | 'philosophy'>('overview');
  const [isExplainerExpanded, setIsExplainerExpanded] = useState<boolean>(true);

  // Live Scenario Simulation State for Selected Instrument
  const [simPEPercentile, setSimPEPercentile] = useState<number | null>(null);
  const [simVolPct, setSimVolPct] = useState<number | null>(null);

  // Compute rich analytics for all 8 universe instruments
  const analyticsList = useMemo(() => {
    return computeUniverseAnalytics(universe, positions, settings);
  }, [universe, positions, settings]);

  const selectedItem = useMemo(() => {
    return analyticsList.find(a => a.instrument.id === selectedId) || analyticsList[0];
  }, [analyticsList, selectedId]);

  // Selected Instrument 5-Year Valuation History
  const valuationHistory5Y = useMemo(() => {
    if (!selectedItem?.instrument) return [];
    return generatePricePercentileHistory(selectedItem.instrument);
  }, [selectedItem]);

  // Simulated Metrics for Selected Instrument
  const simulatedData = useMemo(() => {
    if (!selectedItem) return null;
    const effPEPct = simPEPercentile !== null ? simPEPercentile : selectedItem.pePercentile;
    const effVol = simVolPct !== null ? (simVolPct / 100) : selectedItem.annualizedVol;
    
    // Carver Position Simulation
    const isBondOrCommodity = selectedItem.instrument.category === 'bond_etf' || selectedItem.instrument.category === 'commodity_etf';
    const effectiveValuationPct = isBondOrCommodity ? 50 : Math.round(effPEPct * 0.55 + selectedItem.pbPercentile * 0.45);
    
    // Valuation Multiplier
    let valMultiplier = 1.0;
    if (!isBondOrCommodity) {
      if (effectiveValuationPct < 20) valMultiplier = 1.25;
      else if (effectiveValuationPct < 40) valMultiplier = 1.12;
      else if (effectiveValuationPct <= 65) valMultiplier = 1.00;
      else if (effectiveValuationPct <= 80) valMultiplier = 0.85;
      else valMultiplier = 0.65;
    }

    // Carver Volatility Sizing (with 20% leverage and single asset cap constraint)
    const baseWeight = selectedItem.instrument.riskBudgetWeight || 0.125;
    const volScaledCapital = settings.totalCapital * baseWeight * (settings.targetAnnualVol / Math.max(0.02, effVol)) * valMultiplier;
    const singleCap = settings.totalCapital * (settings.maxInstrumentPositionCap || 0.25);
    const maxGrossCap = settings.totalCapital * (1 + (settings.maxLeverage || 0.20));
    
    const cappedSimCapital = Math.min(volScaledCapital, singleCap, maxGrossCap);
    const cappedSimShares = Math.floor(cappedSimCapital / (selectedItem.instrument.currentPrice * 100)) * 100;
    const simWeightPct = ((cappedSimCapital / settings.totalCapital) * 100).toFixed(1);

    const shareDiff = cappedSimShares - selectedItem.currentShares;
    const isBreached = Math.abs(shareDiff * selectedItem.instrument.currentPrice) > (cappedSimCapital * settings.bufferThreshold);

    return {
      effPEPct,
      effVol,
      valMultiplier,
      cappedSimCapital,
      cappedSimShares,
      simWeightPct,
      shareDiff,
      isBreached
    };
  }, [selectedItem, simPEPercentile, simVolPct, settings]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setSimPEPercentile(null);
    setSimVolPct(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部主横幅与目标总仓位 vs 实际总仓位核心解惑 */}
      <div className="flex flex-col gap-3 p-5 bg-gradient-to-r from-slate-900 via-[#0E1526] to-slate-900 border border-slate-800 rounded-lg shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
              <Radar className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-100 tracking-tight">
                  标的多维深度投研工作台
                </h2>
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-semibold">
                  价值安全边际 × 卡弗波动率风控
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-indigo-950/80 text-indigo-400 border border-indigo-800/60">
                  8 大核心资产全景覆盖
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                结合本杰明·格雷厄姆/霍华德·马克斯经典价值均值回归，与罗伯特·卡弗系统化波动率平价及动量预测标量，构建A股与ETF量化决策闭环。
              </p>
            </div>
          </div>

          {/* SubTab Navigation */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-950/70 border border-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setActiveSubTab('overview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all font-medium ${
                activeSubTab === 'overview'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>全景体检与象限定位</span>
            </button>
            <button
              onClick={() => setActiveSubTab('deepdive')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all font-medium ${
                activeSubTab === 'deepdive'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>单标的深度穿透与模拟</span>
            </button>
            <button
              onClick={() => setActiveSubTab('philosophy')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all font-medium ${
                activeSubTab === 'philosophy'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>量化典籍与投资哲学</span>
            </button>
          </div>
        </div>

        {/* 关键解惑卡片: 目标总仓位 vs 实际总仓位 */}
        <div className="mt-2 bg-slate-950/80 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300">
          <div 
            className="flex items-center justify-between cursor-pointer select-none"
            onClick={() => setIsExplainerExpanded(!isExplainerExpanded)}
          >
            <div className="flex items-center gap-2 text-emerald-400 font-semibold">
              <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-[13px]">
                核心问答：为什么有“目标总仓位”和“实际总仓位”？为什么不一样？应该以哪个为准？
              </span>
            </div>
            <div className="flex items-center gap-2 text-slate-500 text-[11px]">
              <span>{isExplainerExpanded ? '收起专业剖析' : '展开详细剖析'}</span>
              {isExplainerExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </div>

          {isExplainerExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-3.5 mt-2.5 border-t border-slate-800/80 text-[11px] leading-relaxed">
              {/* 概念辨析 */}
              <div className="p-3 bg-slate-900/60 rounded border border-slate-800/80 flex flex-col gap-1.5">
                <div className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>1. 概念定义：实际仓位 vs 目标仓位</span>
                </div>
                <div className="text-slate-300">
                  <strong className="text-white">实际总仓位 (现仓)：</strong>当前账户真实持有的所有股票/ETF持股市值之和 ÷ 总资金（如 62.9%）。代表当前真金白银承担的真实市场波动敞口与浮盈亏。
                </div>
                <div className="text-slate-300">
                  <strong className="text-white">目标总仓位 (模型)：</strong>卡弗模型根据标的最新价格、年化波动率、EWMAC趋势标量以及≤20%杠杆约束计算出的“数学理论最优配比”（如 68.8%）。
                </div>
              </div>

              {/* 为什么不一样 */}
              <div className="p-3 bg-slate-900/60 rounded border border-slate-800/80 flex flex-col gap-1.5">
                <div className="text-cyan-400 font-bold flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5" />
                  <span>2. 为什么不一样？四大核心原因</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-slate-300">
                  <li><strong className="text-slate-200">行情自然漂移：</strong>价格每日浮动导致持仓市值自然变化，但尚未做调仓动作。</li>
                  <li><strong className="text-slate-200">波动率/动量更新：</strong>近期波动率变大或变小，卡弗模型算出的目标股数随之动态演进。</li>
                  <li><strong className="text-amber-300 font-semibold">卡弗调仓缓冲带 (死区)：</strong>偏离若在缓冲阈值内（如12%），坚决不调仓！避免频繁交易被A股印花税、佣金与滑点侵蚀。</li>
                  <li><strong className="text-slate-200">整手约束：</strong>A股必须按 100 股整数手截断。</li>
                </ul>
              </div>

              {/* 以哪个为准 */}
              <div className="p-3 bg-slate-900/60 rounded border border-slate-800/80 flex flex-col gap-1.5">
                <div className="text-indigo-400 font-bold flex items-center gap-1">
                  <Scale className="w-3.5 h-3.5" />
                  <span>3. 应该以哪个为准？实操纪律</span>
                </div>
                <div className="text-slate-300">
                  <strong className="text-emerald-300">日常风险与资产监控：</strong>以<strong className="text-white">实际总仓位</strong>为准，它反映真实净值与账户杠杆。
                </div>
                <div className="text-slate-300">
                  <strong className="text-amber-300">调仓交易与决策：</strong>以<strong className="text-white">“经缓冲死区过滤后的建议股数”</strong>为准：
                  落在死区内则以实际仓位为准（保持不动）；超出死区边界时才触发调仓单，将实际仓位拉齐到目标仓位。
                </div>
                {onNavigateToExecution && (
                  <button
                    onClick={onNavigateToExecution}
                    className="mt-1 flex items-center justify-between px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-mono transition-colors"
                  >
                    <span>查看日频调仓执行单</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 视图一：全景体检大看板与象限矩阵 */}
      {activeSubTab === 'overview' && (
        <div className="flex flex-col gap-6">
          {/* 四象限散点矩阵图 */}
          <ValueMomentumScatterMatrix
            items={analyticsList}
            selectedId={selectedId}
            onSelectItem={handleSelect}
          />

          {/* 全景横向对比排行榜大表 */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-slate-100">
                  8 大核心资产全景多维量化指标排行榜
                </h3>
              </div>
              <div className="text-xs text-slate-400">
                基准无风险利率: <span className="text-indigo-400 font-mono font-semibold">10年国债 {CHINA_10Y_BOND_YIELD}%</span> · 杠杆上限: <span className="text-amber-400 font-mono font-semibold">≤{(settings.maxLeverage * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-mono">
                    <th className="py-2.5 px-3">标的资产</th>
                    <th className="py-2.5 px-2">资产类别</th>
                    <th className="py-2.5 px-2 text-right">当前市价</th>
                    <th className="py-2.5 px-2 text-right">PE (分位)</th>
                    <th className="py-2.5 px-2 text-right">股债溢价 ERP</th>
                    <th className="py-2.5 px-2 text-right">股息率</th>
                    <th className="py-2.5 px-2 text-right">年化波动 (分位)</th>
                    <th className="py-2.5 px-2 text-center">卡弗标量</th>
                    <th className="py-2.5 px-2 text-center">双轮象限</th>
                    <th className="py-2.5 px-2 text-right">实际仓位</th>
                    <th className="py-2.5 px-2 text-right">目标仓位</th>
                    <th className="py-2.5 px-2 text-center">死区状态</th>
                    <th className="py-2.5 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {analyticsList.map(item => {
                    const isSelected = item.instrument.id === selectedId;
                    const isBondOrCommodity = item.instrument.category === 'bond_etf' || item.instrument.category === 'commodity_etf';

                    return (
                      <tr 
                        key={item.instrument.id}
                        onClick={() => handleSelect(item.instrument.id)}
                        className={`hover:bg-slate-800/40 transition-colors cursor-pointer ${
                          isSelected ? 'bg-emerald-950/30 font-medium' : ''
                        }`}
                      >
                        {/* 标的名称 */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-200">{item.instrument.name}</span>
                            <span className="font-mono text-[10px] text-slate-400">{item.instrument.code}</span>
                            {item.instrument.isT0 && (
                              <span className="text-[9px] px-1 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60">
                                T+0
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 类别 */}
                        <td className="py-2.5 px-2 text-[11px] text-slate-400">
                          {item.instrument.category === 'broad_etf' && '宽基ETF'}
                          {item.instrument.category === 'sector_etf' && '行业ETF'}
                          {item.instrument.category === 'bond_etf' && '债券ETF'}
                          {item.instrument.category === 'commodity_etf' && '黄金商品'}
                          {item.instrument.category === 'qdii_etf' && '跨境QDII'}
                          {item.instrument.category === 'stock_cn' && 'A股个股'}
                        </td>

                        {/* 现价 */}
                        <td className="py-2.5 px-2 text-right font-mono text-slate-200">
                          ¥{item.instrument.currentPrice.toFixed(3)}
                        </td>

                        {/* PE 分位 */}
                        <td className="py-2.5 px-2 text-right font-mono">
                          {isBondOrCommodity ? (
                            <span className="text-slate-400">--</span>
                          ) : (
                            <div className="flex flex-col items-end">
                              <span className="text-slate-200">{item.peTTM > 0 ? item.peTTM.toFixed(1) : '--'}</span>
                              {item.peTTM > 0 ? (
                                <span className={`text-[10px] font-semibold ${
                                  item.pePercentile < 30 ? 'text-emerald-400' :
                                  item.pePercentile > 70 ? 'text-rose-400' : 'text-slate-400'
                                }`}>
                                  {item.pePercentile}% 分位
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">无估值数据</span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* ERP */}
                        <td className="py-2.5 px-2 text-right font-mono">
                          {isBondOrCommodity ? (
                            <span className="text-slate-400">--</span>
                          ) : (
                            <span className={`font-semibold ${
                              item.equityRiskPremium > 5 ? 'text-emerald-400' :
                              item.equityRiskPremium < 2 ? 'text-amber-400' : 'text-slate-300'
                            }`}>
                              +{item.equityRiskPremium}%
                            </span>
                          )}
                        </td>

                        {/* 股息率 */}
                        <td className="py-2.5 px-2 text-right font-mono">
                          {item.dividendYield > 0 ? (
                            <span className={item.dividendYield > 3.0 ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                              {item.dividendYield.toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-slate-400">0%</span>
                          )}
                        </td>

                        {/* 年化波动率 */}
                        <td className="py-2.5 px-2 text-right font-mono">
                          <div className="flex flex-col items-end">
                            <span className="text-slate-200">{(item.annualizedVol * 100).toFixed(1)}%</span>
                            <span className="text-[10px] text-slate-400">{item.volatilityPercentile}% 分位</span>
                          </div>
                        </td>

                        {/* 卡弗标量 */}
                        <td className="py-2.5 px-2 text-center font-mono">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            item.carverForecastScalar > 5 ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' :
                            item.carverForecastScalar < -5 ? 'bg-rose-950/80 text-rose-300 border border-rose-800' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {item.carverForecastScalar > 0 ? `+${item.carverForecastScalar}` : item.carverForecastScalar}
                          </span>
                        </td>

                        {/* 双轮象限 */}
                        <td className="py-2.5 px-2 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            item.quadrant === 'GOLDEN_RESONANCE' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                            item.quadrant === 'TREND_MOMENTUM' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                            item.quadrant === 'VALUE_DEFENSIVE' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' :
                            'bg-rose-950 text-rose-300 border border-rose-800'
                          }`}>
                            {item.quadrant === 'GOLDEN_RESONANCE' ? '双优共振' :
                             item.quadrant === 'TREND_MOMENTUM' ? '动量博弈' :
                             item.quadrant === 'VALUE_DEFENSIVE' ? '左侧潜伏' : '双杀防守'}
                          </span>
                        </td>

                        {/* 实际仓位 */}
                        <td className="py-2.5 px-2 text-right font-mono text-slate-200">
                          <div className="flex flex-col items-end">
                            <span>¥{(item.currentValue / 10000).toFixed(1)}万</span>
                            <span className="text-[10px] text-slate-400">{item.currentWeight}%</span>
                          </div>
                        </td>

                        {/* 目标仓位 */}
                        <td className="py-2.5 px-2 text-right font-mono text-emerald-300 font-semibold">
                          <div className="flex flex-col items-end">
                            <span>¥{(item.targetValue / 10000).toFixed(1)}万</span>
                            <span className="text-[10px] text-emerald-400">{item.targetWeight}%</span>
                          </div>
                        </td>

                        {/* 死区状态 */}
                        <td className="py-2.5 px-2 text-center">
                          {item.withinBuffer ? (
                            <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded">
                              死区内(不动)
                            </span>
                          ) : (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              item.action === 'BUY' 
                                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800' 
                                : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                            }`}>
                              需{item.action === 'BUY' ? '买' : '卖'}{item.recommendedShares / 100}手
                            </span>
                          )}
                        </td>

                        {/* 操作 */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelect(item.instrument.id);
                              setActiveSubTab('deepdive');
                            }}
                            className="px-2 py-1 bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-300 rounded text-[11px] transition-colors"
                          >
                            穿透诊断
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 视图二：单标的穿透深度体检与情景推演 */}
      {activeSubTab === 'deepdive' && selectedItem && (
        <div className="flex flex-col gap-6">
          {/* 标的快速切换 Pills */}
          <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/80 border border-slate-800 rounded-lg">
            <span className="text-xs font-semibold text-slate-400 mr-2 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              选择穿透标的:
            </span>
            {analyticsList.map(a => (
              <button
                key={a.instrument.id}
                onClick={() => handleSelect(a.instrument.id)}
                className={`px-3 py-1.5 rounded text-xs font-mono transition-all flex items-center gap-1.5 ${
                  a.instrument.id === selectedId
                    ? 'bg-emerald-500 text-slate-950 font-bold shadow-md'
                    : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
                }`}
              >
                <span>{a.instrument.name}</span>
                <span className="text-[10px] opacity-75">{a.instrument.code}</span>
              </button>
            ))}
          </div>

          {/* 标的体检报告头 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* 卡片1: 基本信息与象限定位 */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">标的资产</span>
                  <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300">
                    {selectedItem.instrument.category}
                  </span>
                </div>
                <div className="text-xl font-bold text-white mt-1">
                  {selectedItem.instrument.name}
                </div>
                <div className="text-xs font-mono text-emerald-400">
                  {selectedItem.instrument.code} · 当前价格 ¥{selectedItem.instrument.currentPrice.toFixed(3)}
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">双轮模型象限定位:</span>
                <span className={`text-xs font-bold px-2 py-1 rounded inline-block ${
                  selectedItem.quadrant === 'GOLDEN_RESONANCE' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                  selectedItem.quadrant === 'TREND_MOMENTUM' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                  selectedItem.quadrant === 'VALUE_DEFENSIVE' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' :
                  'bg-rose-950 text-rose-300 border border-rose-800'
                }`}>
                  {selectedItem.quadrantLabel}
                </span>
                <span className="text-[11px] text-slate-400 leading-tight mt-1">
                  {selectedItem.quadrantAdvice}
                </span>
              </div>
            </div>

            {/* 卡片2: 价值估值安全边际 */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400">价值安全边际得分</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold font-mono text-cyan-300">
                    {selectedItem.valueScore}
                  </span>
                  <span className="text-xs text-slate-400">/ 100分</span>
                </div>
              </div>
              <div className="space-y-1.5 text-xs font-mono pt-3 border-t border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">PE-TTM:</span>
                  <span className="text-slate-200">{selectedItem.peTTM > 0 ? `${selectedItem.peTTM.toFixed(1)} (${selectedItem.pePercentile}% 分位)` : '-- (无估值数据)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">市净率 PB:</span>
                  <span className="text-slate-200">{selectedItem.pb > 0 ? `${selectedItem.pb.toFixed(2)} (${selectedItem.pbPercentile}% 分位)` : '-- (无估值数据)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">股息率:</span>
                  <span className="text-emerald-400">{selectedItem.dividendYield.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">股债风险溢价 ERP:</span>
                  <span className="text-indigo-300 font-bold">+{selectedItem.equityRiskPremium}%</span>
                </div>
              </div>
            </div>

            {/* 卡片3: 卡弗波动率与动量风控 */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400">卡弗动量与风控得分</span>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-2xl font-bold font-mono text-amber-300">
                    {selectedItem.momentumRiskScore}
                  </span>
                  <span className="text-xs text-slate-400">/ 100分</span>
                </div>
              </div>
              <div className="space-y-1.5 text-xs font-mono pt-3 border-t border-slate-800">
                <div className="flex justify-between">
                  <span className="text-slate-400">年化波动率:</span>
                  <span className="text-slate-200">{(selectedItem.annualizedVol * 100).toFixed(1)}% ({selectedItem.volatilityPercentile}% 分位)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">日均波幅 ATR:</span>
                  <span className="text-slate-200">¥{selectedItem.instrument.dailyATR.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">卡弗预测标量:</span>
                  <span className="text-emerald-400 font-bold">{selectedItem.carverForecastScalar > 0 ? `+${selectedItem.carverForecastScalar}` : selectedItem.carverForecastScalar}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">站上250日年线:</span>
                  <span className={selectedItem.aboveMA250 ? 'text-emerald-400' : 'text-rose-400'}>
                    {selectedItem.aboveMA250 ? '✓ 站上 (多头牛市)' : '✗ 跌破 (防御熊市)'}
                  </span>
                </div>
              </div>
            </div>

            {/* 卡片4: 实际持仓 vs 目标持仓差异归因 */}
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col justify-between">
              <div>
                <span className="text-xs text-slate-400">仓位对比与缓冲带判定</span>
                <div className="flex items-baseline justify-between mt-1 font-mono">
                  <div>
                    <span className="text-xs text-slate-400">现仓: </span>
                    <span className="text-base font-bold text-white">{selectedItem.currentShares / 100}手</span>
                    <span className="text-xs text-slate-400 ml-1">({selectedItem.currentWeight}%)</span>
                  </div>
                  <div>
                    <span className="text-xs text-emerald-400">目标: </span>
                    <span className="text-base font-bold text-emerald-400">{selectedItem.targetShares / 100}手</span>
                    <span className="text-xs text-emerald-400 ml-1">({selectedItem.targetWeight}%)</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">死区状态:</span>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                    selectedItem.withinBuffer 
                      ? 'bg-slate-800 text-slate-300' 
                      : selectedItem.action === 'BUY'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}>
                    {selectedItem.withinBuffer ? '在死区内 (无需调仓)' : `突破死区 (需${selectedItem.action === 'BUY' ? '加' : '减'}${selectedItem.recommendedShares / 100}手)`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-950/60 p-2 rounded border border-slate-800/80">
                  {selectedItem.reasonForDifference}
                </p>
              </div>
            </div>
          </div>

          {/* 历史价格分位区间图谱（基于真实后复权收盘价，由 parquet bars 派生，非合成 PE/PB 估值） */}
          <HistoricalValuationRangeChart
            historicalValuation={selectedItem.instrument.historicalValuation}
            instrument={selectedItem.instrument}
            currentPEPercentile={selectedItem.pePercentile}
            currentPBPercentile={selectedItem.pbPercentile}
            currentPETTM={selectedItem.peTTM}
            currentPB={selectedItem.pb}
          />

          {/* 图表对比区: 价格趋势动量通道 + 5年估值分位演化 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <InstrumentPriceTrendChart
              bars={selectedItem.instrument.bars}
              instrumentName={selectedItem.instrument.name}
              instrumentCode={selectedItem.instrument.code}
              currentPrice={selectedItem.instrument.currentPrice}
            />

            <ValuationHistoryChart
              data={valuationHistory5Y}
              instrumentName={selectedItem.instrument.name}
              instrumentCode={selectedItem.instrument.code}
              isCommodityOrBond={selectedItem.instrument.category === 'bond_etf' || selectedItem.instrument.category === 'commodity_etf'}
              currentPEPercentile={selectedItem.pePercentile}
              currentPBPercentile={selectedItem.pbPercentile}
              currentComposite={selectedItem.compositeValuationPercentile}
            />
          </div>

          {/* 交互式情景模拟推演实验室 */}
          {simulatedData && (
            <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-sm font-semibold text-slate-100">
                    【情景推演实验室】模拟估值变动或波动率冲击对目标仓位的影响
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSimPEPercentile(null); setSimVolPct(null); }}
                    className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-mono transition-colors"
                  >
                    重置为真实值
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 滑块1: 模拟PE历史分位 */}
                <div className="flex flex-col gap-2 p-3 bg-slate-950/60 rounded border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">模拟 PE 历史百分位:</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {simulatedData.effPEPct}% 分位
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    step={1}
                    value={simulatedData.effPEPct}
                    onChange={(e) => setSimPEPercentile(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>5% (历史极低估，高溢价)</span>
                    <span>50% (合理中枢)</span>
                    <span>95% (极度泡沫，强制折价)</span>
                  </div>
                </div>

                {/* 滑块2: 模拟年化波动率 */}
                <div className="flex flex-col gap-2 p-3 bg-slate-950/60 rounded border border-slate-800">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">模拟 20日年化波动率:</span>
                    <span className="font-mono font-bold text-amber-300">
                      {(simulatedData.effVol * 100).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={45}
                    step={0.5}
                    value={Number((simulatedData.effVol * 100).toFixed(1))}
                    onChange={(e) => setSimVolPct(Number(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>3% (国债极低波动)</span>
                    <span>18% (A股稳健中枢)</span>
                    <span>45% (黑天鹅剧烈暴震)</span>
                  </div>
                </div>
              </div>

              {/* 推演输出 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs font-mono">
                <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-1">
                  <span className="text-slate-400 text-[11px]">估值调整系数</span>
                  <span className="text-base font-bold text-cyan-300">
                    {simulatedData.valMultiplier.toFixed(2)}x
                  </span>
                </div>

                <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-1">
                  <span className="text-slate-400 text-[11px]">推演目标金额</span>
                  <span className="text-base font-bold text-emerald-400">
                    ¥{Math.round(simulatedData.cappedSimCapital).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-slate-400">占总资金 {simulatedData.simWeightPct}%</span>
                </div>

                <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-1">
                  <span className="text-slate-400 text-[11px]">推演目标股数</span>
                  <span className="text-base font-bold text-white">
                    {simulatedData.cappedSimShares / 100} 手
                  </span>
                  <span className="text-[10px] text-slate-400">({simulatedData.cappedSimShares} 股)</span>
                </div>

                <div className="p-3 bg-slate-950 rounded border border-slate-800 flex flex-col gap-1">
                  <span className="text-slate-400 text-[11px]">与现仓差距与死区</span>
                  <span className={`text-sm font-bold ${
                    simulatedData.isBreached 
                      ? simulatedData.shareDiff > 0 ? 'text-emerald-400' : 'text-rose-400' 
                      : 'text-slate-400'
                  }`}>
                    {simulatedData.shareDiff > 0 ? `需增持 +${simulatedData.shareDiff / 100}手` : 
                     simulatedData.shareDiff < 0 ? `需减持 ${simulatedData.shareDiff / 100}手` : '与现仓持平'}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {simulatedData.isBreached ? '⚠️ 突破缓冲死区' : '✓ 处于死区内无需调仓'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 视图三：经典典籍与量化哲学 */}
      {activeSubTab === 'philosophy' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 格雷厄姆 */}
          <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
              <span className="text-xl">📖</span>
              <div>
                <h4 className="text-sm font-bold text-white">本杰明·格雷厄姆《聪明的投资者》</h4>
                <span className="text-[11px] text-cyan-400 font-mono">核心概念：安全边际 (Margin of Safety) & 均值回归</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              “安全边际的秘密在于：以显著低于内在价值的价格买入资产。在我们的情景模拟器中，当价格处于自身历史 20% 分位以内时，代表资产相对自身历史处于低位区，模拟演示赋予 +12%~+25% 的仓位溢价（模拟假设：真实行情仅含价格，无 PE/PB 估值字段）。”
            </p>
            <div className="mt-auto p-2.5 bg-slate-950/70 rounded border border-slate-800/80 text-[11px] font-mono text-slate-400">
              量化映射：<span className="text-cyan-300">CompositePercentile &lt; 20% → 1.25x 仓位溢价加码</span>
            </div>
          </div>

          {/* 霍华德·马克斯 */}
          <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
              <span className="text-xl">⏱️</span>
              <div>
                <h4 className="text-sm font-bold text-white">霍华德·马克斯《周期》与《投资最重要的事》</h4>
                <span className="text-[11px] text-emerald-400 font-mono">核心概念：钟摆摆动极值与第二层次思维</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              “投资的钟摆永远在亢奋泡沫与悲观低谷之间摆动，但绝不会长久停留在中心。当价格处于自身历史极高位（价格分位 &gt; 80%）时，即便动量再好，潜在回报也在急剧萎缩、风险在迅速放大。情景模拟器在高位区演示 -35% 仓位折价防御（模拟假设），落袋为安。”
            </p>
            <div className="mt-auto p-2.5 bg-slate-950/70 rounded border border-slate-800/80 text-[11px] font-mono text-slate-400">
              量化映射：<span className="text-rose-400">CompositePercentile &gt; 80% → 0.65x 强制折价止盈防御</span>
            </div>
          </div>

          {/* 罗伯特·卡弗 */}
          <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
              <span className="text-xl">📐</span>
              <div>
                <h4 className="text-sm font-bold text-white">罗伯特·卡弗《系统化交易》与《杠杆交易》</h4>
                <span className="text-[11px] text-amber-400 font-mono">核心概念：波动率平价、调仓死区与杠杆硬顶约束</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              “头寸规模与波动率成反比。当资产暴涨暴跌（波动率激增）时，必须立刻收紧仓位以保证现金风险恒定；而在低波资产上适度放大头寸，但全组合严格受制于 ≤20% 杠杆上限。同时，引入调仓死区缓冲带 (Buffer Band)，彻底避免过度交易的高昂摩擦损失。”
            </p>
            <div className="mt-auto p-2.5 bg-slate-950/70 rounded border border-slate-800/80 text-[11px] font-mono text-slate-400">
              量化映射：<span className="text-amber-300">BaseShares ∝ (1 / Volatility) · 偏离 &lt; BufferThreshold 按兵不动</span>
            </div>
          </div>

          {/* 克里夫·阿斯内斯 */}
          <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-3">
            <div className="flex items-center gap-2.5 pb-2 border-b border-slate-800">
              <span className="text-xl">⚡</span>
              <div>
                <h4 className="text-sm font-bold text-white">克里夫·阿斯内斯 (AQR)《Value and Momentum Everywhere》</h4>
                <span className="text-[11px] text-indigo-400 font-mono">核心概念：价值与动量因子的负相关黄金互补</span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              “单纯看价值容易遭遇‘价值陷阱’（廉价却持续阴跌多年）；单纯看动量容易遭遇‘高位雪崩’。价值与动量在学术实证上展现出极强的天然负相关性，将二者有机结合能够将组合夏普比率提升 30% 以上，并大幅平滑回撤曲线。”
            </p>
            <div className="mt-auto p-2.5 bg-slate-950/70 rounded border border-slate-800/80 text-[11px] font-mono text-slate-400">
              量化映射：<span className="text-indigo-300">双轮四象限共振 · 优选低估值+多头动量标的</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
