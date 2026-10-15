import React, { useState, useMemo } from 'react';
import { RebalanceRecord } from '../types/ashare';
import { 
  X, 
  History, 
  Download, 
  Search, 
  Filter, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownRight, 
  CheckCircle2, 
  Coins, 
  ChevronDown, 
  ChevronUp,
  Layers,
  Sparkles
} from 'lucide-react';

interface RebalanceHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: RebalanceRecord[];
  activeBundleId?: string;
  activeBundleName?: string;
}

export const RebalanceHistoryModal: React.FC<RebalanceHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  activeBundleId,
  activeBundleName,
}) => {
  const [filterMode, setFilterMode] = useState<'current' | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  // 过滤记录
  const filteredHistory = useMemo(() => {
    let list = Array.isArray(history) ? history : [];
    if (filterMode === 'current' && activeBundleId) {
      list = list.filter((r) => r.portfolioId === activeBundleId);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.portfolioName.toLowerCase().includes(q) ||
          r.displayTime.toLowerCase().includes(q) ||
          (Array.isArray(r.trades) &&
            r.trades.some(
              (t) =>
                t.name.toLowerCase().includes(q) ||
                t.code.toLowerCase().includes(q) ||
                t.reason.toLowerCase().includes(q)
            ))
      );
    }
    return list;
  }, [history, filterMode, activeBundleId, searchTerm]);

  // 统计指标
  const totalTurnoverSum = useMemo(() => {
    return filteredHistory.reduce((acc, r) => acc + (r.totalTurnover || 0), 0);
  }, [filteredHistory]);

  const totalFeesSum = useMemo(() => {
    return filteredHistory.reduce((acc, r) => acc + (r.estimatedFee || 0), 0);
  }, [filteredHistory]);

  const totalTradesCount = useMemo(() => {
    return filteredHistory.reduce((acc, r) => acc + (r.tradesCount || (r.trades ? r.trades.length : 0)), 0);
  }, [filteredHistory]);

  const handleExportCSV = () => {
    if (!filteredHistory.length) return;
    const headers = [
      '调仓批次ID',
      '所属组合',
      '执行时间',
      '资金规模口径(元)',
      '标的代码',
      '标的名称',
      '操作方向',
      '成交股数',
      '成交手数',
      '成交价格(元)',
      '成交金额(元)',
      '调仓前持仓(股)',
      '调仓后持仓(股)',
      '目标持仓(股)',
      '调仓动因与逻辑',
    ];

    const rows: string[] = [];
    filteredHistory.forEach((rec) => {
      if (Array.isArray(rec.trades)) {
        rec.trades.forEach((t) => {
          rows.push(
            [
              rec.id,
              `"${rec.portfolioName}"`,
              rec.displayTime,
              rec.totalCapital,
              t.code,
              `"${t.name}"`,
              t.action === 'BUY' ? '买入' : t.action === 'SELL' ? '卖出' : '保持',
              t.shares,
              t.shares / 100,
              t.price.toFixed(3),
              t.turnover,
              t.preShares,
              t.postShares,
              t.targetShares,
              `"${t.reason.replace(/"/g, '""')}"`,
            ].join(',')
          );
        });
      }
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `卡弗组合调仓历史账本_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-cyan-950 text-cyan-400 border border-cyan-800/80 rounded-lg">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-wide">
                  组合调仓历史账本与审计轨迹 (Portfolio Rebalance Ledger)
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                  共 {filteredHistory.length} 次调仓
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                完整记录每一次卡弗系统化对齐、再平衡换手、各标的执行股数与驱动动因
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={filteredHistory.length === 0}
              className="px-2.5 py-1.5 text-xs text-slate-200 bg-slate-800 hover:bg-slate-750 disabled:opacity-50 border border-slate-700 rounded flex items-center gap-1.5 transition-colors"
              title="导出当前筛选的全部调仓历史明细到 CSV"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>导出 CSV</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 筛选与汇总 KPI Strip */}
        <div className="p-3 bg-slate-950/50 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded p-0.5">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  filterMode === 'all'
                    ? 'bg-cyan-900/80 text-cyan-200 font-semibold border border-cyan-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                全部组合
              </button>
              <button
                type="button"
                onClick={() => setFilterMode('current')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  filterMode === 'current'
                    ? 'bg-cyan-900/80 text-cyan-200 font-semibold border border-cyan-700'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                仅当前组合 {activeBundleName ? `(${activeBundleName})` : ''}
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="搜索标的名称/代码/动因..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1 bg-slate-900 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-48 sm:w-56"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] tabular-nums text-slate-400">
            <div>
              <span>累计换手额: </span>
              <span className="text-white font-semibold">¥{Math.round(totalTurnoverSum).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span>预估费用: </span>
              <span className="text-amber-400 font-semibold">¥{totalFeesSum.toFixed(1)}</span>
            </div>
            <div>
              <span>标的成交笔数: </span>
              <span className="text-cyan-400 font-semibold">{totalTradesCount} 笔</span>
            </div>
          </div>
        </div>

        {/* 记录列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {filteredHistory.length === 0 ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <History className="w-10 h-10 text-slate-600" />
              <p className="text-xs text-slate-400">没有符合筛选条件的调仓历史记录</p>
              <p className="text-[11px] text-slate-600">
                可点击「执行建议调仓」完成持仓对齐，系统将自动记录并归档至本账本。
              </p>
            </div>
          ) : (
            filteredHistory.map((rec) => {
              const isExpanded = expandedRecordId === rec.id;
              const trades = Array.isArray(rec.trades) ? rec.trades : [];

              return (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 overflow-hidden hover:border-slate-700/80 transition-colors"
                >
                  {/* 记录主横条 */}
                  <div
                    onClick={() => setExpandedRecordId(isExpanded ? null : rec.id)}
                    className="p-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer hover:bg-slate-900/60 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded bg-slate-900 text-slate-300 border border-slate-800">
                        <Calendar className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white font-mono">{rec.displayTime}</span>
                          <span className="px-2 py-0.2 rounded text-[10px] bg-slate-800/90 text-cyan-300 font-medium border border-slate-700">
                            {rec.portfolioName}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          资金口径: ¥{rec.totalCapital.toLocaleString('zh-CN')} · 涉及标的: {trades.length} 笔
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
                      <div className="text-right">
                        <div className="text-slate-300">
                          换手: <b className="text-emerald-400">¥{rec.totalTurnover.toLocaleString('zh-CN')}</b>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          费用: ¥{rec.estimatedFee.toFixed(1)}
                        </div>
                      </div>

                      <div className="p-1 rounded text-slate-400 hover:text-white">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                  </div>

                  {/* 展开的交易明细表格 */}
                  {isExpanded && (
                    <div className="border-t border-slate-800/80 bg-slate-900/60 p-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-800 text-[10px] text-slate-400 font-mono">
                              <th className="py-1.5 px-2">操作</th>
                              <th className="py-1.5 px-2">标的</th>
                              <th className="py-1.5 px-2 text-right">参考价格</th>
                              <th className="py-1.5 px-2 text-right">成交数量</th>
                              <th className="py-1.5 px-2 text-right">成交金额</th>
                              <th className="py-1.5 px-2 text-right">持仓变化</th>
                              <th className="py-1.5 px-3">调仓动因</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50 font-mono text-xs tabular-nums">
                            {trades.map((t, idx) => {
                              const isBuy = t.action === 'BUY';
                              return (
                                <tr key={idx} className="hover:bg-slate-800/40">
                                  <td className="py-2 px-2">
                                    <span
                                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        isBuy
                                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                          : 'bg-rose-950 text-rose-300 border border-rose-800'
                                      }`}
                                    >
                                      {isBuy ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                      {isBuy ? '买入' : '卖出'}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2">
                                    <span className="font-semibold text-white">{t.name}</span>
                                    <span className="text-slate-500 text-[10px] ml-1.5">{t.code}</span>
                                  </td>
                                  <td className="py-2 px-2 text-right text-slate-300">
                                    ¥{t.price.toFixed(2)}
                                  </td>
                                  <td className="py-2 px-2 text-right font-semibold text-white">
                                    {t.shares} 股 ({t.shares / 100}手)
                                  </td>
                                  <td className="py-2 px-2 text-right text-emerald-400">
                                    ¥{t.turnover.toLocaleString('zh-CN')}
                                  </td>
                                  <td className="py-2 px-2 text-right text-slate-400 text-[11px]">
                                    {t.preShares} → <b className="text-slate-200">{t.postShares}</b>
                                  </td>
                                  <td className="py-2 px-3 text-[11px] font-sans text-slate-300">
                                    {t.reason}
                                  </td>
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
            })
          )}
        </div>

        {/* 底部关闭与提示 */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>调仓记录已同步持久化至工作区与服务端（data/portfolios/rebalance_history.json）</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs font-medium transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
