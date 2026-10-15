import React, { useState, useEffect, useMemo } from 'react';
import { PositionCalculation, CarverSettings, RebalanceRecord, RebalanceTradeItem, AShareInstrument } from '../types/ashare';
import { 
  ClipboardCopy, 
  CheckCircle, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowDownRight, 
  Coins, 
  AlertCircle,
  Download,
  Clock,
  History,
  X,
  Calendar,
  Layers,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  Sparkles
} from 'lucide-react';
import { 
  loadLocalRebalanceHistory, 
  fetchServerRebalanceHistory, 
  persistNewRebalanceRecord, 
  getLatestTradesForInstrument 
} from '../services/rebalanceHistoryStore';

interface RebalanceExecutionPanelProps {
  positions: PositionCalculation[];
  settings: CarverSettings;
  activeBundleId?: string;
  activeBundleName?: string;
  universe?: AShareInstrument[];
  onExecuteRebalance: (record?: RebalanceRecord) => void;
  onUpdateCurrentShares?: (id: string, shares: number) => void;
  onUpdateBundleCapital?: (capital: number) => void;
}

export const RebalanceExecutionPanel: React.FC<RebalanceExecutionPanelProps> = ({
  positions,
  settings,
  activeBundleId,
  activeBundleName,
  universe = [],
  onExecuteRebalance,
  onUpdateCurrentShares,
  onUpdateBundleCapital,
}) => {
  const [copied, setCopied] = useState(false);
  const [executedToast, setExecutedToast] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [rebalanceHistory, setRebalanceHistory] = useState<RebalanceRecord[]>(() => loadLocalRebalanceHistory());
  const [selectedInstForHistory, setSelectedInstForHistory] = useState<AShareInstrument | null>(null);
  const [historyFilterMode, setHistoryFilterMode] = useState<'current' | 'all'>('current');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // 挂载时静默拉取服务端最新账本
  useEffect(() => {
    let cancelled = false;
    fetchServerRebalanceHistory().then((h) => {
      if (!cancelled && h && h.length) setRebalanceHistory(h);
    });
    return () => { cancelled = true; };
  }, []);

  // Filter positions that actually require rebalancing after buffer band filter
  const safePositions = Array.isArray(positions) ? positions.filter((p) => p && p.instrument) : [];
  const actionablePositions = safePositions.filter((p) => !p.withinBuffer && p.recommendedShares > 0);
  const bufferProtectedPositions = safePositions.filter((p) => p.withinBuffer);

  // Net cash required for rebalance
  const buyCostTotal = actionablePositions
    .filter((p) => p.action === 'BUY')
    .reduce((acc, p) => acc + (p.recommendedShares * p.instrument.currentPrice), 0);
  
  const sellProceedsTotal = actionablePositions
    .filter((p) => p.action === 'SELL')
    .reduce((acc, p) => acc + (p.recommendedShares * p.instrument.currentPrice), 0);

  const netCashFlow = sellProceedsTotal - buyCostTotal;
  const totalFees = actionablePositions.reduce((acc, p) => acc + p.estimatedFee, 0);

  // 当前持仓总市值
  const currentTotalHoldingsValue = useMemo(() => {
    return safePositions.reduce((acc, p) => acc + (p.currentValue || 0), 0);
  }, [safePositions]);

  // Generate copyable text script for broker pre-market order entry
  const generateOrderScript = () => {
    const lines = [
      `【${activeBundleName || '卡弗系统化交易'} · 日频调仓指令单】`,
      `生成日期: ${new Date().toISOString().split('T')[0]} (收盘结算后执行)`,
      `资金口径: ¥${settings.totalCapital.toLocaleString('zh-CN')} (目标波动率 ${(settings.targetAnnualVol * 100).toFixed(0)}%)`,
      `风控约束: 杠杆上限 ≤ ${(settings.maxLeverage * 100).toFixed(0)}% (死区缓冲带 ${(settings.bufferThreshold * 100).toFixed(0)}%)`,
      `----------------------------------------`,
    ];

    if (actionablePositions.length === 0) {
      lines.push(`全部标的均处于 ${(settings.bufferThreshold * 100).toFixed(0)}% 缓冲带内，今日无任何调仓操作。保持现有持仓，零摩擦成本。`);
    } else {
      actionablePositions.forEach((p, idx) => {
        const actionStr = p.action === 'BUY' ? '买入' : '卖出';
        const lots = p.recommendedShares / 100;
        const inst = p.instrument;
        lines.push(
          `${idx + 1}. [${actionStr}] ${inst.name} (${inst.code}) : ${lots} 手 (${p.recommendedShares} 股) | 参考价: ¥${inst.currentPrice.toFixed(3)} | 预估金额: ¥${Math.round(p.recommendedShares * inst.currentPrice).toLocaleString('zh-CN')}`
        );
      });
      lines.push(`----------------------------------------`);
      lines.push(`买入总金额: ¥${Math.round(buyCostTotal).toLocaleString('zh-CN')}`);
      lines.push(`卖出总金额: ¥${Math.round(sellProceedsTotal).toLocaleString('zh-CN')}`);
      lines.push(`净资金变动: ${netCashFlow >= 0 ? '+' : ''}¥${Math.round(netCashFlow).toLocaleString('zh-CN')}`);
      lines.push(`预估手续费: ¥${totalFees.toFixed(1)} (已享受ETF免印花税政策)`);
    }

    return lines.join('\n');
  };

  const handleCopy = () => {
    const text = generateOrderScript();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleExportCSV = () => {
    const headers = ['交易动作', '标的代码', '标的名称', '建议股数', '手数', '参考价格', '预估金额(元)', '预估费用(元)', '是否在缓冲带'];
    const rows = safePositions.map((p) => {
      const action = p.withinBuffer ? '保持(缓冲带内)' : p.action === 'BUY' ? '买入' : p.action === 'SELL' ? '卖出' : '保持';
      return [
        action,
        p.instrument.code,
        `"${p.instrument.name}"`,
        p.recommendedShares,
        p.recommendedShares / 100,
        p.instrument.currentPrice.toFixed(3),
        Math.round(p.recommendedShares * p.instrument.currentPrice),
        p.estimatedFee.toFixed(1),
        p.withinBuffer ? '是' : '否'
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `卡弗调仓清单_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 确认执行并归档调仓记录
  const handleConfirmExecute = async () => {
    if (actionablePositions.length === 0 || isExecuting) return;
    setIsExecuting(true);
    try {
      const trades: RebalanceTradeItem[] = actionablePositions.map((p) => {
        const inst = p.instrument;
        let reason = `突破 ${(settings.bufferThreshold * 100).toFixed(0)}% 缓冲带，`;
        if (p.action === 'BUY') {
          reason += (p.forecastScalar || 0) >= 5 ? '动量强劲放量加仓' : '估值偏低顺势补仓';
        } else {
          reason += (p.forecastScalar || 0) <= -5 ? '防守破位主动止损' : '平准化再平衡削峰止盈';
        }

        return {
          code: inst.code,
          name: inst.name,
          action: p.action,
          shares: p.recommendedShares,
          price: inst.currentPrice,
          turnover: Math.round(p.recommendedShares * inst.currentPrice),
          preShares: p.currentShares || 0,
          postShares: p.targetShares,
          targetShares: p.targetShares,
          reason,
        };
      });

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const displayTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const totalTurnover = trades.reduce((acc, t) => acc + t.turnover, 0);

      const record: RebalanceRecord = {
        id: `reb_${now.getTime()}`,
        portfolioId: activeBundleId || 'active_workspace',
        portfolioName: activeBundleName || '当前工作区组合',
        timestamp: now.toISOString(),
        displayTime,
        totalCapital: settings.totalCapital,
        tradesCount: trades.length,
        totalTurnover,
        estimatedFee: Number(totalFees.toFixed(1)),
        trades,
      };

      // 1. 同步更新标的实际持股
      if (onUpdateCurrentShares) {
        for (const t of trades) {
          const match = universe.find((u) => u.code === t.code || u.code.split('.')[0] === t.code.split('.')[0]);
          if (match) {
            onUpdateCurrentShares(match.id, t.postShares);
          }
        }
      }

      // 2. 本地与服务端双写归档
      const nextList = await persistNewRebalanceRecord(record);
      setRebalanceHistory(nextList);

      // 3. 回调通知
      onExecuteRebalance(record);

      setExecutedToast(`✅ 调仓成功！已将 ${trades.length} 笔标的持仓与目标对齐，换手总额 ¥${totalTurnover.toLocaleString('zh-CN')}，已生成并归档至调仓历史账本。`);
      setTimeout(() => setExecutedToast(null), 5000);
    } finally {
      setIsExecuting(false);
    }
  };

  // 过滤展示的历史记录
  const displayedHistory = useMemo(() => {
    let list = Array.isArray(rebalanceHistory) ? rebalanceHistory : [];
    if (historyFilterMode === 'current' && activeBundleId) {
      list = list.filter((r) => r.portfolioId === activeBundleId);
    }
    return list;
  }, [rebalanceHistory, historyFilterMode, activeBundleId]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部调仓概览与操作卡 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">日频调仓执行清单 (Daily EOD Execution)</h2>
            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-cyan-300 font-mono border border-slate-700">
              {activeBundleName || '当前组合'}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              死区缓冲带: {(settings.bufferThreshold * 100).toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
            <span>
              资金规模: <b className="text-emerald-400 font-mono">¥{settings.totalCapital.toLocaleString('zh-CN')}</b>
            </span>
            <span>
              现仓市值: <b className="text-slate-200 font-mono">¥{Math.round(currentTotalHoldingsValue).toLocaleString('zh-CN')}</b>
            </span>
            {Math.abs(settings.totalCapital - currentTotalHoldingsValue) > 500 && onUpdateBundleCapital && (
              <button
                type="button"
                onClick={() => onUpdateBundleCapital(Math.round(currentTotalHoldingsValue))}
                className="text-emerald-400 hover:text-emerald-300 underline text-[11px] flex items-center gap-0.5"
              >
                <ArrowRightLeft className="w-3 h-3" />
                以当前持仓市值对齐资金
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleExportCSV}
            title="导出为 Excel / CSV 格式"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 hover:text-white rounded border border-slate-700 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>导出 CSV</span>
          </button>

          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors whitespace-nowrap"
          >
            {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
            <span>{copied ? '已复制委托指令' : '复制券商指令单'}</span>
          </button>

          <button
            onClick={handleConfirmExecute}
            disabled={actionablePositions.length === 0 || isExecuting}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded border transition-colors whitespace-nowrap ${
              actionablePositions.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/40 shadow-sm'
                : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>{isExecuting ? '正在对齐与归档...' : '确认执行并对齐持仓 (归档账本)'}</span>
          </button>
        </div>
      </div>

      {executedToast && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-600/50 rounded text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{executedToast}</span>
        </div>
      )}

      {/* 资金流统计指标 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">需调仓标的数</span>
          <span className="text-lg font-bold text-white">{actionablePositions.length} 笔</span>
          <span className="text-[11px] text-slate-500 font-sans">
            另有 {bufferProtectedPositions.length} 笔标的被缓冲带保护免调
          </span>
        </div>

        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">买入所需资金</span>
          <span className="text-lg font-bold text-emerald-400">¥{Math.round(buyCostTotal).toLocaleString('zh-CN')}</span>
          <span className="text-[11px] text-slate-500 font-sans">
            加仓顺势与权重偏低标的
          </span>
        </div>

        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">卖出回笼资金</span>
          <span className="text-lg font-bold text-red-400">¥{Math.round(sellProceedsTotal).toLocaleString('zh-CN')}</span>
          <span className="text-[11px] text-slate-500 font-sans">
            减仓破位与权重过重标的
          </span>
        </div>

        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">预估总摩擦成本</span>
          <span className="text-lg font-bold text-slate-200">¥{totalFees.toFixed(1)}</span>
          <span className="text-[11px] text-emerald-400 font-sans">
            ETF免印花税 · 缓冲带免频繁佣金
          </span>
        </div>
      </div>

      {/* 待调仓标的详细执行单 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            今日建议执行买卖清单 (超出死区缓冲带标的)
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            共 {actionablePositions.length} 项触发调仓
          </span>
        </div>

        {actionablePositions.length === 0 ? (
          <div className="p-8 text-center bg-slate-800/20 rounded border border-slate-800 flex flex-col items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <div className="text-sm font-semibold text-white">今日持仓完美健康，无需任何调仓</div>
            <p className="text-xs text-slate-400 max-w-md">
              所有标的持仓均位于卡弗 {(settings.bufferThreshold * 100).toFixed(0)}% 缓冲带之内，没有产生不必要的买卖摩擦损耗。日频检查完成，明日继续专注主业。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3">标的代码/名称</th>
                  <th className="py-2.5 px-2 text-center">操作类型</th>
                  <th className="py-2.5 px-2 text-right">参考价格</th>
                  <th className="py-2.5 px-2 text-right">当前持仓 (手)</th>
                  <th className="py-2.5 px-2 text-right">目标持仓 (手)</th>
                  <th className="py-2.5 px-3 text-right">执行手数 (整手)</th>
                  <th className="py-2.5 px-3 text-right">变动资金额</th>
                  <th className="py-2.5 px-2 text-right">预估手续费</th>
                  <th className="py-2.5 px-3">执行理由与历史轨迹</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {actionablePositions.map((p) => {
                  const inst = p.instrument;
                  const isBuy = p.action === 'BUY';
                  const actionLots = p.recommendedShares / 100;
                  const instTrades = getLatestTradesForInstrument(rebalanceHistory, inst.code, 3);

                  return (
                    <tr key={inst.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white text-xs">{inst.name}</div>
                        <div className="text-[11px] text-slate-400 font-normal">{inst.code}</div>
                      </td>

                      <td className="py-3 px-2 text-center font-sans font-bold">
                        {isBuy ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                            <ArrowUpRight className="w-3.5 h-3.5" /> 买入
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/60">
                            <ArrowDownRight className="w-3.5 h-3.5" /> 卖出
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-2 text-right font-medium text-slate-200">
                        ¥{inst.currentPrice.toFixed(inst.currentPrice > 100 ? 2 : 3)}
                      </td>

                      <td className="py-3 px-2 text-right text-slate-400">
                        {p.currentShares / 100}手
                      </td>

                      <td className="py-3 px-2 text-right text-slate-200">
                        {p.targetShares / 100}手
                      </td>

                      <td className="py-3 px-3 text-right font-bold text-base text-white">
                        {actionLots} 手
                        <div className="text-[10px] text-slate-400 font-normal">
                          ({p.recommendedShares} 股)
                        </div>
                      </td>

                      <td className="py-3 px-3 text-right font-semibold text-slate-200">
                        ¥{Math.round(p.recommendedShares * inst.currentPrice).toLocaleString('zh-CN')}
                      </td>

                      <td className="py-3 px-2 text-right text-slate-400">
                        ¥{p.estimatedFee.toFixed(1)}
                      </td>

                      <td className="py-3 px-3 text-[11px] font-sans text-slate-400">
                        <div>
                          {p.currentShares === 0 ? '建仓买入 · 满足卡弗波动率配比' : 
                           p.targetShares === 0 ? '清仓避险 · 趋势指标转负或跌破年线' :
                           isBuy ? '加仓 · 偏离目标上限超出死区' : '减仓锁定收益 · 标的波动率上升'}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedInstForHistory(inst)}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-800/80 transition-colors"
                          >
                            <Clock className="w-2.5 h-2.5" />
                            <span>最近 3 次调仓记录 ({instTrades.length})</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 缓冲带保护标的清单 */}
      <div className="p-5 bg-slate-900/40 border border-slate-800 rounded-lg flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <h4 className="text-xs font-semibold text-slate-300">
              缓冲带保护标的 (偏离度 ≤ {(settings.bufferThreshold * 100).toFixed(0)}%，无需交易)
            </h4>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            共 {bufferProtectedPositions.length} 笔标的享受免调仓保护
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {bufferProtectedPositions.map((p) => {
            const inst = p.instrument;
            const currentLots = p.currentShares / 100;
            const targetLots = p.targetShares / 100;
            const deltaLots = targetLots - currentLots;
            const instTrades = getLatestTradesForInstrument(rebalanceHistory, inst.code, 3);

            return (
              <div key={inst.id} className="p-3 bg-slate-800/30 rounded border border-slate-800/80 flex flex-col justify-between text-xs gap-2">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-white">{inst.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{inst.code}</div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-[11px]">
                    <div className="text-slate-300">现持: {currentLots}手 · 目标: {targetLots}手</div>
                    <div className="text-cyan-400 text-[10px]">偏离: {deltaLots > 0 ? `+${deltaLots}` : deltaLots}手 (缓冲内)</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                  <span className="text-[10px] text-slate-500">零换手损耗</span>
                  <button
                    type="button"
                    onClick={() => setSelectedInstForHistory(inst)}
                    className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
                  >
                    <Clock className="w-2.5 h-2.5" />
                    <span>查看最近 3 次调仓 ({instTrades.length})</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 组合调仓历史总账本与审计轨迹 (Audit Trail) */}
      <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-lg flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">
              组合调仓历史账本 (Rebalance Ledger & Audit Records)
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              共 {displayedHistory.length} 次已归档调仓事件
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setHistoryFilterMode('current')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  historyFilterMode === 'current'
                    ? 'bg-cyan-900/80 text-cyan-200 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                当前组合
              </button>
              <button
                type="button"
                onClick={() => setHistoryFilterMode('all')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  historyFilterMode === 'all'
                    ? 'bg-cyan-900/80 text-cyan-200 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                全部组合
              </button>
            </div>
          </div>
        </div>

        {displayedHistory.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            该组合暂无调仓归档记录。点击上方「确认执行并对齐持仓」后将在此自动生成审计明细。
          </div>
        ) : (
          <div className="space-y-3">
            {displayedHistory.map((rec) => {
              const isExpanded = expandedHistoryId === rec.id;
              const trades = Array.isArray(rec.trades) ? rec.trades : [];

              return (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 overflow-hidden"
                >
                  <div
                    onClick={() => setExpandedHistoryId(isExpanded ? null : rec.id)}
                    className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-slate-900/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded bg-slate-900 text-slate-300 border border-slate-800">
                        <Calendar className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white font-mono">{rec.displayTime}</span>
                          <span className="px-2 py-0.2 rounded text-[10px] bg-slate-800 text-cyan-300 font-medium">
                            {rec.portfolioName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          资金规模: ¥{rec.totalCapital.toLocaleString('zh-CN')} · 涉及标的: {trades.length} 笔
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                      <div className="text-right">
                        <div className="text-slate-300">
                          换手: <b className="text-emerald-400">¥{rec.totalTurnover.toLocaleString('zh-CN')}</b>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          摩擦费用: ¥{rec.estimatedFee.toFixed(1)}
                        </div>
                      </div>
                      <div className="p-1 rounded text-slate-400">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-800/80 bg-slate-900/60 p-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse font-mono">
                          <thead>
                            <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                              <th className="py-1 px-2">操作</th>
                              <th className="py-1 px-2">标的</th>
                              <th className="py-1 px-2 text-right">参考价格</th>
                              <th className="py-1 px-2 text-right">成交数量</th>
                              <th className="py-1 px-2 text-right">成交金额</th>
                              <th className="py-1 px-2 text-right">持仓变化</th>
                              <th className="py-1 px-3">调仓动因</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/40 text-xs">
                            {trades.map((t, idx) => {
                              const isBuy = t.action === 'BUY';
                              return (
                                <tr key={idx}>
                                  <td className="py-1.5 px-2">
                                    <span
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                        isBuy ? 'text-emerald-400' : 'text-rose-400'
                                      }`}
                                    >
                                      {isBuy ? '▲买入' : '▼卖出'}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2">
                                    <span className="font-semibold text-white">{t.name}</span>
                                    <span className="text-slate-500 text-[10px] ml-1">{t.code}</span>
                                  </td>
                                  <td className="py-1.5 px-2 text-right text-slate-300">¥{t.price.toFixed(2)}</td>
                                  <td className="py-1.5 px-2 text-right text-white font-semibold">{t.shares}股 ({t.shares / 100}手)</td>
                                  <td className="py-1.5 px-2 text-right text-emerald-400">¥{t.turnover.toLocaleString('zh-CN')}</td>
                                  <td className="py-1.5 px-2 text-right text-slate-400 text-[11px]">{t.preShares} → {t.postShares}</td>
                                  <td className="py-1.5 px-3 text-[11px] font-sans text-slate-300">{t.reason}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 单标的最近 3 次调仓记录弹窗 */}
      {selectedInstForHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5 flex flex-col gap-4 max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-sky-950 text-sky-400 border border-sky-800">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <span>{selectedInstForHistory.name}</span>
                    <span className="font-mono text-xs text-slate-400">{selectedInstForHistory.code}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">最近 3 次调仓事件与持仓轨迹</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInstForHistory(null)}
                className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-3 flex-1">
              {(() => {
                const trades = getLatestTradesForInstrument(rebalanceHistory, selectedInstForHistory.code, 3);
                if (trades.length === 0) {
                  return (
                    <div className="p-8 text-center bg-slate-950/60 rounded border border-slate-800 flex flex-col items-center gap-2">
                      <ShieldCheck className="w-8 h-8 text-slate-600" />
                      <p className="text-xs text-slate-400">暂无历史调仓变动记录</p>
                      <p className="text-[11px] text-slate-500 max-w-xs">
                        该标的持仓持续落在死区缓冲带内，系统始终维持现有底仓，为您节省了频繁调仓的交易手续费。
                      </p>
                    </div>
                  );
                }

                return trades.map((t, idx) => {
                  const isBuy = t.trade.action === 'BUY';
                  return (
                    <div
                      key={t.recordId + '_' + idx}
                      className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-2 font-mono"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-500 font-bold">#{idx + 1}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isBuy
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                            }`}
                          >
                            {isBuy ? '▲ 买入' : '▼ 卖出'} {t.trade.shares} 股 ({t.trade.shares / 100}手)
                          </span>
                          <span className="text-slate-300">@ ¥{t.trade.price.toFixed(2)}</span>
                        </div>
                        <span className="text-slate-500 text-[11px]">{t.displayTime}</span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          持仓变化: {t.trade.preShares} 股 → <b className="text-white">{t.trade.postShares} 股</b>
                        </span>
                        <span className="text-emerald-400">
                          成交额: ¥{t.trade.turnover.toLocaleString('zh-CN')}
                        </span>
                      </div>

                      <div className="text-[11px] font-sans text-slate-300 bg-slate-900/60 p-2 rounded border border-slate-800/80">
                        <span className="text-slate-500 mr-1.5 font-mono">调仓逻辑:</span>
                        <span>{t.trade.reason}</span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="pt-2 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedInstForHistory(null)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
