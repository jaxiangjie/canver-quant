import React from 'react';
import { InstrumentAnalyticsItem } from '../types/ashare';
import { 
  ShieldAlert, 
  ShieldCheck, 
  TrendingUp, 
  TrendingDown, 
  Percent, 
  Coins, 
  FileText, 
  Activity, 
  Scale, 
  Info, 
  CheckCircle2, 
  AlertTriangle 
} from 'lucide-react';
import { CHINA_10Y_BOND_YIELD } from '../services/assetAnalyticsEngine';

interface FundamentalHealthCardProps {
  item: InstrumentAnalyticsItem;
}

export const FundamentalHealthCard: React.FC<FundamentalHealthCardProps> = ({ item }) => {
  const inst = item.instrument;
  const isBondOrCommodity = inst.category === 'bond_etf' || inst.category === 'commodity_etf';
  const qualityScore = item.fundamentalQualityScore ?? 70;
  const risk = item.valueTrapRisk ?? 'LOW';
  const pe = item.peTTM > 0 ? item.peTTM : null;
  const earningsYield = pe ? Number(((1 / pe) * 100).toFixed(2)) : null;
  const erpSpread = earningsYield !== null ? Number((earningsYield - CHINA_10Y_BOND_YIELD).toFixed(2)) : null;
  const divYield = item.dividendYield > 0 ? item.dividendYield : null;
  const divSpread = divYield !== null ? Number((divYield - CHINA_10Y_BOND_YIELD).toFixed(2)) : null;

  if (isBondOrCommodity) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold">
          <Info className="w-4 h-4 text-cyan-400" />
          <span>宏观大类资产基本面说明</span>
        </div>
        <p className="mt-2 text-xs text-slate-400 leading-relaxed">
          当前资产为 <strong className="text-white">{inst.name}</strong>（{inst.category === 'bond_etf' ? '固收国债' : '大宗黄金'}），
          其底层驱动力为宏观无风险利率中枢、流动性与通胀预期，不适用企业财报 ROE、净利润与市盈率等传统微观财务估值体系。
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-5 flex flex-col gap-4 shadow-sm">
      {/* 头部标题与报告期 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              基本面质量诊断与价值陷阱体检
              <span className="text-[11px] font-normal font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {item.latestReportPeriod || '最新定期报告'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              透视微观财报真实资本回报率 (ROE)、盈利成长性与股债利差，杜绝单维低市盈率诱导的价值陷阱
            </p>
          </div>
        </div>

        {/* 综合健康得分 Badge */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400">财务质量综合评分</span>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-bold font-mono ${
                qualityScore >= 80 ? 'text-emerald-400' :
                qualityScore >= 60 ? 'text-cyan-400' :
                'text-rose-400'
              }`}>
                {qualityScore}
              </span>
              <span className="text-[10px] text-slate-500">/ 100</span>
            </div>
          </div>
        </div>
      </div>

      {/* 核心指标 4 宫格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* 指标1: ROE 净资产收益率 */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>净资产收益率 (ROE)</span>
            <Coins className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-lg font-bold font-mono ${
              (item.roe ?? 0) >= 10 ? 'text-emerald-400' :
              (item.roe ?? 0) > 0 ? 'text-cyan-300' :
              'text-rose-400'
            }`}>
              {item.roe != null ? `${item.roe.toFixed(2)}%` : '--'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500">
            {item.roe != null && item.roe >= 10 ? '盈利回报优质 (ROE≥10%)' :
             item.roe != null && item.roe > 0 ? '回报适中稳健' : '资本回报为负 (当心亏损)'}
          </div>
        </div>

        {/* 指标2: 归母净利润同比增速 */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>归母净利润同比</span>
            {(item.netProfitGrowthYoy ?? 0) >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-lg font-bold font-mono ${
              (item.netProfitGrowthYoy ?? 0) >= 15 ? 'text-emerald-400' :
              (item.netProfitGrowthYoy ?? 0) >= 0 ? 'text-cyan-300' :
              'text-rose-400'
            }`}>
              {item.netProfitGrowthYoy != null ? (
                `${item.netProfitGrowthYoy > 0 ? '+' : ''}${item.netProfitGrowthYoy.toFixed(1)}%`
              ) : '--'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500">
            {item.netProfitGrowthYoy != null && item.netProfitGrowthYoy >= 15 ? '业绩加速释放' :
             item.netProfitGrowthYoy != null && item.netProfitGrowthYoy >= 0 ? '盈利温和增长' : '净利润同比承压下滑'}
          </div>
        </div>

        {/* 指标3: 营业收入同比增速 */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>营业收入同比</span>
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-lg font-bold font-mono ${
              (item.revenueGrowthYoy ?? 0) >= 10 ? 'text-emerald-400' :
              (item.revenueGrowthYoy ?? 0) >= 0 ? 'text-slate-200' :
              'text-rose-400'
            }`}>
              {item.revenueGrowthYoy != null ? (
                `${item.revenueGrowthYoy > 0 ? '+' : ''}${item.revenueGrowthYoy.toFixed(1)}%`
              ) : '--'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500">
            {item.grossMargin != null ? `销售毛利率: ${item.grossMargin.toFixed(1)}%` : '主营业务动能'}
          </div>
        </div>

        {/* 指标4: 真实分红股息率 */}
        <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>滚动股息率 (DY)</span>
            <Percent className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="my-1.5 flex items-baseline gap-1">
            <span className={`text-lg font-bold font-mono ${
              (item.dividendYield ?? 0) >= 4.0 ? 'text-amber-400' :
              (item.dividendYield ?? 0) >= 2.0 ? 'text-emerald-300' :
              'text-slate-300'
            }`}>
              {item.dividendYield > 0 ? `${item.dividendYield.toFixed(2)}%` : '--'}
            </span>
          </div>
          <div className="text-[10px] text-slate-500">
            {divSpread !== null && divSpread > 0 ? (
              <span className="text-amber-300">比10Y国债高 +{divSpread}%</span>
            ) : (
              '确定性现金分红回报'
            )}
          </div>
        </div>
      </div>

      {/* 股债性价比利差对比条 (Fed Model) */}
      <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-lg flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-slate-200">
              股债利差 (Fed Model) 与红利溢价比较
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            无风险基准: 10年期国债收益率 <span className="text-indigo-400 font-bold">{CHINA_10Y_BOND_YIELD}%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
          {/* 盈利收益率 vs 国债 */}
          <div className="p-2.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-slate-400 text-[11px]">标的盈利收益率 (1/PE)</span>
              <span className="text-white font-mono font-bold mt-0.5">
                {earningsYield !== null ? `${earningsYield}%` : '--'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[11px]">ERP 相对国债利差</span>
              <div className="font-mono font-bold text-indigo-400 mt-0.5">
                {erpSpread !== null ? `${erpSpread > 0 ? '+' : ''}${erpSpread}%` : '--'}
              </div>
            </div>
          </div>

          {/* 股息率 vs 国债 */}
          <div className="p-2.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-slate-400 text-[11px]">标的股息率</span>
              <span className="text-amber-400 font-mono font-bold mt-0.5">
                {divYield !== null ? `${divYield}%` : '--'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[11px]">现金分红超额收益</span>
              <div className={`font-mono font-bold mt-0.5 ${
                divSpread !== null && divSpread > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}>
                {divSpread !== null ? `${divSpread > 0 ? '+' : ''}${divSpread}%` : '--'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 价值陷阱诊断警示条 */}
      <div className={`p-3.5 rounded-lg border text-xs flex items-start gap-3 ${
        risk === 'HIGH' ? 'bg-rose-950/40 border-rose-800/80 text-rose-200' :
        risk === 'MEDIUM' ? 'bg-amber-950/40 border-amber-800/80 text-amber-200' :
        'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
      }`}>
        <div className="mt-0.5 shrink-0">
          {risk === 'HIGH' ? (
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          ) : risk === 'MEDIUM' ? (
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          )}
        </div>
        <div className="flex-1 leading-relaxed">
          <div className="font-bold text-[13px] flex items-center gap-2">
            <span>
              {risk === 'HIGH' ? '【警示】检测到高危价值陷阱风险 (Value Trap Risk: High)' :
               risk === 'MEDIUM' ? '【关注】检测到潜在基本面失速预警 (Value Trap Risk: Medium)' :
               '【健康】基本面财务体检优良 (Value Trap Risk: Low)'}
            </span>
          </div>
          <div className="text-[11px] opacity-90 mt-1">
            {item.valueTrapWarning || '当前标的估值与基本面盈利动态吻合，未发现业绩断崖或资产负债表异常。'}
          </div>
        </div>
      </div>
    </div>
  );
};
