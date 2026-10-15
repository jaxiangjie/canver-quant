import React from 'react';
import { PortfolioSummaryStats, CarverSettings, PositionCalculation } from '../types/ashare';
import { ShieldAlert, TrendingUp, Wallet, Activity, CheckCircle2, AlertTriangle, Sparkles, Award } from 'lucide-react';
import { PortfolioRiskContributionChart } from './PortfolioRiskContributionChart';

interface PortfolioSummaryProps {
  summary: PortfolioSummaryStats;
  settings: CarverSettings;
  positions?: PositionCalculation[];
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({ summary, settings, positions = [] }) => {
  const isVolBalanced = Math.abs(summary.portfolioAnnualVol - (settings.targetAnnualVol * 100)) <= 2.5;

  return (
    <div className="flex flex-col xl:flex-row gap-3 p-4 bg-[#0A0F1A] border-b border-slate-800/80 text-slate-300">
      {/* 左侧/主要区域：9项核心资产与风控 KPI 指标卡 */}
      <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 2xl:grid-cols-9 gap-2.5">
      {/* 1. 总资金资产 */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>总投资资本</span>
          <Wallet className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="text-lg font-bold text-white font-mono tabular-nums">
          ¥{summary.totalCapital.toLocaleString('zh-CN')}
        </div>
        <div className="text-[11px] text-slate-500 font-mono">
          当前资金口径: ¥{(summary.totalCapital / 10000).toFixed(summary.totalCapital % 10000 === 0 ? 0 : 1)}万 专属管理
        </div>
      </div>

      {/* 2. 现仓资产与仓位比率 */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>当前证券持仓</span>
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="text-lg font-bold text-white font-mono tabular-nums">
          ¥{summary.currentEquityValue.toLocaleString('zh-CN')}
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums flex items-center justify-between">
          <span>现仓率 <span className="text-emerald-400 font-semibold">{summary.equityRatio}%</span></span>
          <span className="text-[10px] text-slate-400">杠杆 {Math.max(0, Number((summary.equityRatio - 100).toFixed(1)))}%</span>
        </div>
      </div>

      {/* 3. 目标杠杆率与风控上限 */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>卡弗目标总持仓</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border bg-emerald-950/60 text-emerald-300 border-emerald-800/60">
            ≤{summary.maxLeverageLimitPct}% 杠杆
          </span>
        </div>
        <div className="text-lg font-bold text-white font-mono tabular-nums flex items-baseline gap-1.5">
          <span>¥{summary.targetEquityValue.toLocaleString('zh-CN')}</span>
          <span className="text-xs font-normal text-slate-400">({summary.targetLeverageRatio}%)</span>
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums flex items-center justify-between">
          <span>目标杠杆 <span className="text-cyan-400 font-semibold">+{summary.targetLeveragePct}%</span></span>
          {summary.isLeverageConstrained ? (
            <span className="text-[10px] text-amber-400 font-sans">🛡️ 20%杠杆压缩</span>
          ) : (
            <span className="text-[10px] text-emerald-400 font-sans">✅ 杠杆合规</span>
          )}
        </div>
      </div>

      {/* 4. 组合实际年化波动率 */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>组合年化波动率</span>
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
        </div>
        <div className="text-lg font-bold text-white font-mono tabular-nums">
          {summary.portfolioAnnualVol}%
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          目标锚定 <span className="text-cyan-400">{(settings.targetAnnualVol * 100).toFixed(0)}%</span> {isVolBalanced ? '· 均衡' : '· 偏离'}
        </div>
      </div>

      {/* 5. 预期综合年化收益率 (基于 IDM 与夏普推导) */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-indigo-900/40">
        <div className="flex items-center justify-between text-xs text-indigo-300">
          <span>预期综合年化</span>
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <div className="text-lg font-bold text-indigo-300 font-mono tabular-nums">
          ~{summary.expectedAnnualReturn || 13.2}%
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          IDM <span className="text-indigo-400 font-semibold">{summary.carverIDM || 1.45}x</span> · 目标年化
        </div>
      </div>

      {/* 6. 波动率调整后绩效 (Risk-Adjusted Return: Sharpe & Sortino) */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-emerald-900/40">
        <div className="flex items-center justify-between text-xs text-emerald-300">
          <span title="波动率调整后绩效 (Sharpe / Sortino / Calmar)">波动调整绩效</span>
          <Award className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="text-lg font-bold text-emerald-300 font-mono tabular-nums flex items-baseline gap-1">
          <span>夏普 {(summary.riskAdjustedReturn ?? 0.94).toFixed(2)}</span>
        </div>
        <div className="text-[10px] text-slate-400 font-mono tabular-nums flex items-center justify-between">
          <span>收益/波动 <span className="text-cyan-400">{(summary.returnToVolRatio ?? 1.12).toFixed(2)}</span></span>
          <span className="text-[10px] text-slate-400">索提诺 <span className="text-emerald-400 font-semibold">{(summary.sortinoRatio ?? 1.45).toFixed(2)}</span></span>
        </div>
      </div>

      {/* 6. 每日期望风险敞口 (Carver Daily Cash Vol) */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>每日期望风险</span>
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className="text-lg font-bold text-amber-400 font-mono tabular-nums">
          ±¥{summary.dailyExpectedRisk.toLocaleString('zh-CN')}
        </div>
        <div className="text-[11px] text-slate-500">
          卡弗波动率预算 · 1σ日漂移
        </div>
      </div>

      {/* 7. 待调仓交易数量 (缓冲带过滤后) */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>日频待调仓</span>
          {summary.pendingTradeCount > 0 ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
        </div>
        <div className="text-lg font-bold text-white font-mono tabular-nums">
          {summary.pendingTradeCount} <span className="text-xs font-normal text-slate-400">笔标的</span>
        </div>
        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
          死区缓冲带 <span className="text-slate-300">{(settings.bufferThreshold * 100).toFixed(0)}%</span> 过滤
        </div>
      </div>

      {/* 8. 预估调仓交易成本 */}
      <div className="flex flex-col gap-1 p-3 bg-slate-900/60 rounded border border-slate-800">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>预估摩擦成本</span>
          <span className="text-[10px] text-slate-500">佣金/税费</span>
        </div>
        <div className="text-lg font-bold text-slate-200 font-mono tabular-nums">
          ¥{summary.estimatedRebalanceCost.toFixed(1)}
        </div>
        <div className="text-[11px] text-slate-500">
          ETF免印花税 · 费率万1
        </div>
      </div>
      </div>

      {/* 右侧：Recharts 动态仓位风险预算贡献图 */}
      {positions && positions.length > 0 && (
        <div className="w-full xl:w-[350px] 2xl:w-[380px] shrink-0">
          <PortfolioRiskContributionChart positions={positions} settings={settings} />
        </div>
      )}
    </div>
  );
};
