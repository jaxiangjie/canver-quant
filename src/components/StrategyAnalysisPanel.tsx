import React, { useState } from 'react';
import { AShareInstrument } from '../types/ashare';
import { evaluateAShareStrategies } from '../services/ashareStrategies';
import { ValuationHistoryChart } from './ValuationHistoryChart';
import { 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  Zap, 
  AlertCircle, 
  Award,
  Layers,
  Percent,
  Sliders,
  Scale
} from 'lucide-react';

interface StrategyAnalysisPanelProps {
  universe: AShareInstrument[];
}

export const StrategyAnalysisPanel: React.FC<StrategyAnalysisPanelProps> = ({ universe }) => {
  const [selectedId, setSelectedId] = useState<string>(universe[0]?.id || '510300');
  const [customPEPercentile, setCustomPEPercentile] = useState<number | null>(null);
  const [customPBPercentile, setCustomPBPercentile] = useState<number | null>(null);

  const selectedInstrument = universe.find(u => u.id === selectedId) || universe[0];

  const signals = selectedInstrument 
    ? evaluateAShareStrategies(selectedInstrument, universe)
    : null;

  // Effective PE / PB percentiles (allowing user live simulation on the card)
  const effectivePEPercentile = customPEPercentile !== null 
    ? customPEPercentile 
    : (selectedInstrument?.pePercentile ?? 50);
  const effectivePBPercentile = customPBPercentile !== null 
    ? customPBPercentile 
    : (selectedInstrument?.pbPercentile ?? 50);

  // Compute live simulated composite valuation
  const isCommodityOrBond = selectedInstrument?.category === 'bond_etf' || selectedInstrument?.category === 'commodity_etf';
  const effectiveComposite = isCommodityOrBond 
    ? 50 
    : Math.round(effectivePEPercentile * 0.55 + effectivePBPercentile * 0.45);

  let simZone: 'EXTREME_LOW' | 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'EXTREME_HIGH' = 'FAIR';
  let simZoneLabel = '合理中枢区 · 估值中性';
  let simAdjustmentBadge = '维持标准配比 1.0x (无溢折价)';
  let simAdjustmentDesc = '估值处于历史中枢 40%~65%，无显著估值泡沫或严重低估，维持标准卡弗波动率平价配比。';
  let simMultiplier = 1.0;
  let simBadgeColor = 'text-cyan-400 bg-cyan-950/60 border-cyan-800/60';

  if (!isCommodityOrBond) {
    if (effectiveComposite < 20) {
      simZone = 'EXTREME_LOW';
      simZoneLabel = '历史极低估区 · 极具安全边际';
      simAdjustmentBadge = '建议仓位溢价 +25% (1.25x 乘数加码)';
      simAdjustmentDesc = '当前估值低于历史 20% 分位，安全边际极高。建议在卡弗基准股数上施加 +25% 溢价增配，逆向吸筹并依托波动率模型锁定下行风险。';
      simMultiplier = 1.25;
      simBadgeColor = 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60';
    } else if (effectiveComposite < 40) {
      simZone = 'UNDERVALUED';
      simZoneLabel = '低估合理区 · 具备性价比';
      simAdjustmentBadge = '建议仓位溢价 +12% (1.12x 适度加码)';
      simAdjustmentDesc = '估值分位在 20%~40% 之间，性价比优良，建议基础仓位溢价 +10%~+15% 布局，顺应中长期均值回归。';
      simMultiplier = 1.12;
      simBadgeColor = 'text-emerald-300 bg-emerald-950/40 border-emerald-700/40';
    } else if (effectiveComposite <= 65) {
      simZone = 'FAIR';
      simZoneLabel = '合理中枢区 · 估值中性';
      simAdjustmentBadge = '维持标准配比 1.0x (无溢折价)';
      simAdjustmentDesc = '估值处于历史 40%~65% 中枢区间，未见明显估值倾斜，严格执行标准卡弗波动率平价与趋势标量。';
      simMultiplier = 1.0;
      simBadgeColor = 'text-cyan-300 bg-cyan-950/40 border-cyan-700/40';
    } else if (effectiveComposite <= 80) {
      simZone = 'OVERVALUED';
      simZoneLabel = '偏高风险区 · 估值偏贵';
      simAdjustmentBadge = '建议仓位折价 -15% (0.85x 防御减配)';
      simAdjustmentDesc = '估值分位处于 65%~80% 偏高区间，赔率降低。建议对目标仓位施加 -15% 折价限制，防范估值压缩杀跌。';
      simMultiplier = 0.85;
      simBadgeColor = 'text-amber-400 bg-amber-950/60 border-amber-800/60';
    } else {
      simZone = 'EXTREME_HIGH';
      simZoneLabel = '极度泡沫区 · 警惕均值回归';
      simAdjustmentBadge = '建议仓位深度折价 -35% (0.65x 强制止盈)';
      simAdjustmentDesc = '估值分位 > 80% 处于极端泡沫区，即便短期趋势仍在，也须进行 -35% 强制仓位折价防御，落袋为安。';
      simMultiplier = 0.65;
      simBadgeColor = 'text-red-400 bg-red-950/60 border-red-800/60';
    }
  }

  const handleSelectInstrument = (id: string) => {
    setSelectedId(id);
    setCustomPEPercentile(null);
    setCustomPBPercentile(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部标的选择横条 */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900/80 border border-slate-800 rounded-lg">
        <span className="text-xs font-medium text-slate-400 mr-2">选择诊断标的：</span>
        {universe.map((inst) => {
          const isSelected = inst.id === selectedId;
          return (
            <button
              key={inst.id}
              onClick={() => handleSelectInstrument(inst.id)}
              className={`px-3 py-1.5 text-xs rounded transition-colors whitespace-nowrap ${
                isSelected
                  ? 'bg-emerald-600 text-white font-semibold'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {inst.name} ({inst.code})
            </button>
          );
        })}
      </div>

      {selectedInstrument && signals && (
        <div className="flex flex-col gap-6">
          {/* 重点新增：基于滚动市盈率 (PE-TTM) 与市净率 (PB) 估值百分位计算模块 */}
          <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Scale className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    估值分位情景模拟（假设输入）· 仓位溢折价联动演示
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    融合卡弗波动率模型与价值安全边际：估值极低时提供仓位溢价支持，估值泡沫时强制折价防守。注：本模块为情景模拟器，滑块为假设输入；真实行情无 PE/PB 估值字段，实际模型以波动率定仓与动量为主。
                  </p>
                </div>
              </div>

              {/* 自动仓位溢折价建议高亮徽章 */}
              <div className="flex items-center gap-3">
                <div className={`px-3.5 py-1.5 rounded border text-xs font-semibold ${simBadgeColor} flex items-center gap-1.5`}>
                  <span>{simAdjustmentBadge}</span>
                </div>
              </div>
            </div>

            {/* 估值指标卡片网格 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
              {/* 1. PE-TTM 实时与分位 */}
              <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-slate-400 font-sans">
                  <span>滚动市盈率 (PE-TTM)</span>
                  <span className="text-[10px] text-slate-500">历史近10年分位</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-white">
                    {selectedInstrument.peTTM ? `${selectedInstrument.peTTM.toFixed(1)}x` : 'N/A'}
                  </span>
                  <span className={`text-xs font-semibold ${effectivePEPercentile < 30 ? 'text-emerald-400' : effectivePEPercentile > 70 ? 'text-red-400' : 'text-slate-300'}`}>
                    {selectedInstrument.peTTM ? `${effectivePEPercentile.toFixed(1)}% 分位` : '不适用'}
                  </span>
                </div>
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-1">
                  <div 
                    className="h-full bg-emerald-500" 
                    style={{ width: `${Math.min(100, Math.max(0, effectivePEPercentile))}%` }}
                  />
                </div>
              </div>

              {/* 2. 市净率 PB 实时与分位 */}
              <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-slate-400 font-sans">
                  <span>市净率 (PB)</span>
                  <span className="text-[10px] text-slate-500">历史近10年分位</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-white">
                    {selectedInstrument.pb ? `${selectedInstrument.pb.toFixed(2)}x` : 'N/A'}
                  </span>
                  <span className={`text-xs font-semibold ${effectivePBPercentile < 30 ? 'text-emerald-400' : effectivePBPercentile > 70 ? 'text-red-400' : 'text-slate-300'}`}>
                    {selectedInstrument.pb ? `${effectivePBPercentile.toFixed(1)}% 分位` : '不适用'}
                  </span>
                </div>
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-1">
                  <div 
                    className="h-full bg-cyan-500" 
                    style={{ width: `${Math.min(100, Math.max(0, effectivePBPercentile))}%` }}
                  />
                </div>
              </div>

              {/* 3. 综合加权估值百分位 */}
              <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-slate-400 font-sans">
                  <span>综合估值百分位</span>
                  <span className="text-[10px] text-slate-500">PE(55%) + PB(45%)</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-bold text-white">
                    {isCommodityOrBond ? 'N/A' : `${effectiveComposite}%`}
                  </span>
                  <span className="text-xs text-slate-300 font-sans">
                    {simZoneLabel.split(' · ')[0]}
                  </span>
                </div>
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden mt-1">
                  <div 
                    className={`h-full ${effectiveComposite < 35 ? 'bg-emerald-500' : effectiveComposite > 70 ? 'bg-red-500' : 'bg-cyan-500'}`}
                    style={{ width: `${Math.min(100, Math.max(0, effectiveComposite))}%` }}
                  />
                </div>
              </div>

              {/* 4. 仓位调节系数 Multiplier */}
              <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-slate-400 font-sans">
                  <span>当前仓位调节系数</span>
                  <span className="text-[10px] text-slate-500">自适应乘数</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`text-xl font-bold font-mono ${simMultiplier > 1 ? 'text-emerald-400' : simMultiplier < 1 ? 'text-amber-400' : 'text-slate-200'}`}>
                    {simMultiplier.toFixed(2)}x
                  </span>
                  <span className="text-xs text-slate-400 font-sans">
                    {simMultiplier > 1 ? '溢价加码' : simMultiplier < 1 ? '折价减持' : '基准平价'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-sans">
                  与卡弗波动率基准头寸乘算
                </div>
              </div>
            </div>

            {/* 估值五象限色阶标尺与当前位置 */}
            <div className="flex flex-col gap-2 p-4 bg-slate-950/60 rounded border border-slate-800/80">
              <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                <span>历史估值百分位全景标尺 (0% ~ 100%)</span>
                <span className="text-[11px] text-slate-500">
                  当前处于：<strong className="text-white">{simZoneLabel}</strong>
                </span>
              </div>

              {/* 色阶带 */}
              <div className="relative w-full h-4 rounded-full overflow-hidden flex text-[10px] text-slate-900 font-bold">
                <div className="w-[20%] bg-emerald-500 flex items-center justify-center" title="极低估 (0% - 20%)">
                  极低估
                </div>
                <div className="w-[20%] bg-emerald-600 flex items-center justify-center text-white" title="低估 (20% - 40%)">
                  低估
                </div>
                <div className="w-[25%] bg-slate-600 flex items-center justify-center text-white" title="合理中枢 (40% - 65%)">
                  合理
                </div>
                <div className="w-[15%] bg-amber-500 flex items-center justify-center" title="偏高 (65% - 80%)">
                  偏高
                </div>
                <div className="w-[20%] bg-red-500 flex items-center justify-center text-white" title="极高泡沫 (> 80%)">
                  泡沫
                </div>
              </div>

              {/* 游标指引 */}
              <div className="relative w-full h-4 mt-0.5">
                <div 
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${Math.min(98, Math.max(2, effectiveComposite))}%` }}
                >
                  <span className="text-xs font-mono font-bold text-white bg-slate-800 px-1.5 py-0.2 rounded border border-slate-600">
                    ▲ 当前: {effectiveComposite}%
                  </span>
                </div>
              </div>

              {/* 深度策略建议描述 */}
              <div className="mt-2 pt-2 border-t border-slate-800/80 text-xs text-slate-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">系统自动化建议：</span>
                  {simAdjustmentDesc}
                </div>
              </div>
            </div>

            {/* 交互式估值分位模拟滑块 (方便用户实操回测与情景推演) */}
            {!isCommodityOrBond && (
              <div className="p-3.5 bg-slate-800/30 rounded border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <Sliders className="w-4 h-4 text-slate-400" />
                  <span>情景模拟滑块（假设输入，观察仓位溢折价联动）：</span>
                </div>

                <div className="flex items-center gap-6 font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">PE分位:</span>
                    <input
                      type="range"
                      min="5"
                      max="95"
                      step="1"
                      value={effectivePEPercentile}
                      onChange={(e) => setCustomPEPercentile(Number(e.target.value))}
                      className="w-24 accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                    />
                    <span className="text-white w-8">{effectivePEPercentile}%</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">PB分位:</span>
                    <input
                      type="range"
                      min="5"
                      max="95"
                      step="1"
                      value={effectivePBPercentile}
                      onChange={(e) => setCustomPBPercentile(Number(e.target.value))}
                      className="w-24 accent-cyan-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                    />
                    <span className="text-white w-8">{effectivePBPercentile}%</span>
                  </div>

                  {(customPEPercentile !== null || customPBPercentile !== null) && (
                    <button
                      onClick={() => { setCustomPEPercentile(null); setCustomPBPercentile(null); }}
                      className="px-2 py-0.5 text-[10px] text-slate-400 hover:text-white bg-slate-800 rounded border border-slate-700 transition-colors"
                    >
                      重置为模拟中枢
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 过去 5 年历史 PE/PB 估值百分位走势图 (D3驱动) */}
            <ValuationHistoryChart
              data={signals?.valuationSignal?.history5y || []}
              instrumentName={selectedInstrument?.name || '标的'}
              instrumentCode={selectedInstrument?.code || ''}
              isCommodityOrBond={isCommodityOrBond}
              currentPEPercentile={effectivePEPercentile}
              currentPBPercentile={effectivePBPercentile}
              currentComposite={effectiveComposite}
            />
          </div>

          {/* 下方：标的动量诊断与策略体系运行详情 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左侧：标的综合信号诊断卡 */}
            <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white">{selectedInstrument.name}</h3>
                  <div className="text-xs text-slate-400 font-mono">{selectedInstrument.code}</div>
                </div>
                <div className="text-right font-mono tabular-nums">
                  <div className="text-lg font-bold text-slate-100">
                    ¥{selectedInstrument.currentPrice.toFixed(3)}
                  </div>
                  <div className={`text-xs ${selectedInstrument.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {selectedInstrument.changePct >= 0 ? '+' : ''}{selectedInstrument.changePct.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* 卡弗综合预测标量输出 */}
              <div className="p-4 bg-slate-800/50 rounded border border-slate-700/60 flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>卡弗综合预测标量 (Forecast Scalar)</span>
                  <span className="text-[11px] text-slate-500">区间: -20 ~ +20</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`text-2xl font-bold font-mono tabular-nums ${
                    signals.finalForecastScalar > 0 ? 'text-emerald-400' : signals.finalForecastScalar < 0 ? 'text-red-400' : 'text-slate-300'
                  }`}>
                    {signals.finalForecastScalar > 0 ? `+${signals.finalForecastScalar}` : signals.finalForecastScalar}
                  </div>
                  <div className="text-xs text-slate-300 leading-tight">
                    {signals.finalForecastScalar >= 10 && '强顺势主升浪 · 建议 1.0x~2.0x 积极持仓'}
                    {signals.finalForecastScalar > 0 && signals.finalForecastScalar < 10 && '中等顺势上行 · 建议 0.5x~1.0x 基准持仓'}
                    {signals.finalForecastScalar === 0 && '震荡中性 / 均线粘合 · 建议观望或防守'}
                    {signals.finalForecastScalar < 0 && '下行破位 / 熊市压制 · 建议清仓或绝对防守'}
                  </div>
                </div>

                {/* 标量标尺 */}
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden relative mt-1">
                  <div 
                    className={`h-full ${signals.finalForecastScalar >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                    style={{
                      width: `${Math.min(100, (Math.abs(signals.finalForecastScalar) / 20) * 100)}%`,
                      marginLeft: signals.finalForecastScalar < 0 ? `${100 - (Math.abs(signals.finalForecastScalar) / 20) * 100}%` : '0%'
                    }}
                  />
                </div>
              </div>

              {/* 核心风控与特征指标 */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <div className="text-slate-500 text-[11px]">250日年线状态</div>
                  <div className="font-semibold mt-1 flex items-center gap-1">
                    {signals.absoluteMomentumPass ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <TrendingUp className="w-3.5 h-3.5" /> 站上年线 (牛市区)
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center gap-1">
                        <TrendingDown className="w-3.5 h-3.5" /> 跌破年线 (防熊市)
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <div className="text-slate-500 text-[11px]">相对强弱分位 (RS)</div>
                  <div className="font-semibold mt-1 font-mono tabular-nums text-slate-200">
                    前 {100 - signals.relativeStrengthRank}% 强势度
                  </div>
                </div>

                <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <div className="text-slate-500 text-[11px]">流动性与T+1安全度</div>
                  <div className="font-semibold mt-1">
                    {signals.liquidityState === 'NORMAL' && (
                      <span className="text-emerald-400">正常流动性</span>
                    )}
                    {signals.liquidityState === 'CAUTION_T1' && (
                      <span className="text-amber-400">注意T+1跌幅</span>
                    )}
                    {signals.liquidityState === 'LIMIT_DOWN_RISK' && (
                      <span className="text-red-400">跌停流动性冻结风险</span>
                    )}
                  </div>
                </div>

                <div className="p-2.5 bg-slate-800/30 rounded border border-slate-800">
                  <div className="text-slate-500 text-[11px]">ETF特征</div>
                  <div className="font-semibold mt-1 text-slate-300">
                    {selectedInstrument.isETF ? (
                      <span>{selectedInstrument.isT0 ? 'T+0交易 · 免印花税' : 'T+1交易 · 免印花税'}</span>
                    ) : (
                      <span>个股 · 需印花税</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 右侧：五大 A 股与 ETF 专属策略深度解析 */}
            <div className="lg:col-span-2 p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                A股与ETF定制策略体系运行详情
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* 策略 1: EWMAC 多周期动量 */}
                <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-slate-200 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      1. 卡弗 EWMAC 多周期交叉
                    </span>
                    <span className="font-mono text-emerald-400 tabular-nums">
                      得分: {signals.ewmacFastSlow.compositeScalar}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    卡弗独创的连续型趋势指标，混合三组均线交叉并以 ATR 归一化：
                  </p>
                  <div className="grid grid-cols-3 gap-2 font-mono tabular-nums text-center text-[11px] mt-1">
                    <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">短周期(8/32)</div>
                      <div className={signals.ewmacFastSlow.ewmac8_32 >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {signals.ewmacFastSlow.ewmac8_32}
                      </div>
                    </div>
                    <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">中周期(16/64)</div>
                      <div className={signals.ewmacFastSlow.ewmac16_64 >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {signals.ewmacFastSlow.ewmac16_64}
                      </div>
                    </div>
                    <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
                      <div className="text-slate-500 text-[10px]">长周期(32/128)</div>
                      <div className={signals.ewmacFastSlow.ewmac32_128 >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                        {signals.ewmacFastSlow.ewmac32_128}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 策略 2: 250日年线绝对动量避险 */}
                <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-slate-200 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-cyan-400" />
                      2. A股年线绝对动量过滤
                    </span>
                    <span className={`font-mono tabular-nums ${signals.absoluteMomentumPass ? 'text-emerald-400' : 'text-red-400'}`}>
                      {signals.absoluteMomentumPass ? '通过 (多头)' : '触发防御 (空头)'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    A股典型“牛短熊长”，跌破 250 日年线往往伴随长时间阴跌。该策略在标的低于年线时强制惩罚多头标量，杜绝长熊死扛。
                  </p>
                  <div className="text-[11px] text-slate-400 font-mono mt-auto">
                    现价 ¥{selectedInstrument.currentPrice.toFixed(2)} vs 年线基准 
                  </div>
                </div>

                {/* 策略 3: 行业/资产相对强弱轮动 (RS) */}
                <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-slate-200 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-purple-400" />
                      3. 相对强弱动量轮动 (RS)
                    </span>
                    <span className="font-mono text-purple-400 tabular-nums">
                      分位: {signals.relativeStrengthRank}%
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    A股呈现明显的板块和风格轮动（如红利 vs 科技 vs 周期）。动态对比 20 日超额收益率，优选强势龙头，剔除弱势跟随者。
                  </p>
                  <div className="text-[11px] text-slate-400">
                    处于全市场前 {100 - signals.relativeStrengthRank}% 强势梯队
                  </div>
                </div>

                {/* 策略 4: 红利低波与均值回归 */}
                <div className="p-3.5 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-slate-200 font-semibold">
                    <span className="flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-emerald-400" />
                      4. 红利低波股息安全边际
                    </span>
                    <span className="font-mono text-emerald-400 tabular-nums">
                      股息率: {selectedInstrument.dividendYield ? `${selectedInstrument.dividendYield}%` : '无'}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    针对震荡市提供底仓防御。高股息低波动标的（如 512890）在市场超跌且趋势中性时自动提供基础持仓权重，平滑净值曲线。
                  </p>
                  <div className="text-[11px] text-slate-400">
                    安全边际得分: {signals.dividendRankScore || 50} / 100
                  </div>
                </div>
              </div>

              {/* ETF 专属流动性与折溢价提示卡 */}
              {selectedInstrument.isETF && (
                <div className="p-3 bg-slate-800/30 rounded border border-slate-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="text-slate-300">
                      ETF折溢价率监控：当前二级市场溢价率 <span className="font-mono font-bold text-white tabular-nums">+{selectedInstrument.premiumDiscountRate || 0}%</span>
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {(selectedInstrument.premiumDiscountRate || 0) > 2.0 ? '⚠ 溢价过高，避免追高买入' : '✓ 折溢价正常'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
