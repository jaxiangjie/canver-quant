import React, { useState } from 'react';
import { PositionCalculation, CarverSettings } from '../types/ashare';
import { 
  ClipboardCopy, 
  CheckCircle, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowDownRight, 
  Coins, 
  AlertCircle,
  Download
} from 'lucide-react';

interface RebalanceExecutionPanelProps {
  positions: PositionCalculation[];
  settings: CarverSettings;
  onExecuteRebalance: () => void;
}

export const RebalanceExecutionPanel: React.FC<RebalanceExecutionPanelProps> = ({
  positions,
  settings,
  onExecuteRebalance,
}) => {
  const [copied, setCopied] = useState(false);
  const [executedToast, setExecutedToast] = useState(false);

  // Filter positions that actually require rebalancing after buffer band filter
  const safePositions = Array.isArray(positions) ? positions.filter(p => p && p.instrument) : [];
  const actionablePositions = safePositions.filter(p => !p.withinBuffer && p.recommendedShares > 0);
  const bufferProtectedPositions = safePositions.filter(p => p.withinBuffer);

  // Net cash required for rebalance
  const buyCostTotal = actionablePositions
    .filter(p => p.action === 'BUY')
    .reduce((acc, p) => acc + (p.recommendedShares * p.instrument.currentPrice), 0);
  
  const sellProceedsTotal = actionablePositions
    .filter(p => p.action === 'SELL')
    .reduce((acc, p) => acc + (p.recommendedShares * p.instrument.currentPrice), 0);

  const netCashFlow = sellProceedsTotal - buyCostTotal;
  const totalFees = actionablePositions.reduce((acc, p) => acc + p.estimatedFee, 0);

  // Generate copyable text script for broker pre-market order entry
  const generateOrderScript = () => {
    const lines = [
      `【100万卡弗系统化交易 · 日频调仓指令单】`,
      `生成日期: ${new Date().toISOString().split('T')[0]} (收盘结算后执行)`,
      `风控约束: 杠杆上限 ≤ ${(settings.maxLeverage * 100).toFixed(0)}% (杜绝超额配资，组合总仓位 ≤ 120%)`,
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
          `${idx + 1}. [${actionStr}] ${inst.name} (${inst.code}) : ${lots} 手 (${p.recommendedShares} 股) | 参考价: ¥${inst.currentPrice.toFixed(3)} | 预估金额: ¥${Math.round(p.recommendedShares * inst.currentPrice).toLocaleString()}`
        );
      });
      lines.push(`----------------------------------------`);
      lines.push(`买入总金额: ¥${Math.round(buyCostTotal).toLocaleString()}`);
      lines.push(`卖出总金额: ¥${Math.round(sellProceedsTotal).toLocaleString()}`);
      lines.push(`净资金变动: ${netCashFlow >= 0 ? '+' : ''}¥${Math.round(netCashFlow).toLocaleString()}`);
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
    const rows = safePositions.map(p => {
      const action = p.withinBuffer ? '保持(缓冲带内)' : p.action === 'BUY' ? '买入' : p.action === 'SELL' ? '卖出' : '保持';
      return [
        action,
        p.instrument.code,
        p.instrument.name,
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

  const handleConfirmExecute = () => {
    onExecuteRebalance();
    setExecutedToast(true);
    setTimeout(() => setExecutedToast(false), 3000);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部调仓概览与操作卡 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">日频调仓执行清单 (Daily EOD Execution)</h2>
            <span className="text-xs text-slate-400 font-mono">
              缓冲带阈值: {(settings.bufferThreshold * 100).toFixed(0)}%
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            业余投资者专享：每日收盘后花 5 分钟核对，次日集合竞价或开盘委托。落入死区缓冲带的标的绝不频繁调仓，节省高额佣金滑点。
          </p>
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
            disabled={actionablePositions.length === 0}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded border transition-colors whitespace-nowrap ${
              actionablePositions.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/40 shadow-sm'
                : 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
            }`}
          >
            <CheckCircle className="w-3.5 h-3.5" />
            <span>确认执行并同步持仓</span>
          </button>
        </div>
      </div>

      {executedToast && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-600/40 rounded text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>持仓已成功同步更新！各标的当前实际持股数已与目标持股对齐，调仓任务完成。</span>
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
          <span className="text-lg font-bold text-emerald-400">¥{Math.round(buyCostTotal).toLocaleString()}</span>
          <span className="text-[11px] text-slate-500 font-sans">
            加仓顺势与权重偏低标的
          </span>
        </div>

        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">卖出回笼资金</span>
          <span className="text-lg font-bold text-red-400">¥{Math.round(sellProceedsTotal).toLocaleString()}</span>
          <span className="text-[11px] text-slate-500 font-sans">
            减仓破位与权重过重标的
          </span>
        </div>

        <div className="p-3.5 bg-slate-900/60 rounded border border-slate-800 flex flex-col gap-1">
          <span className="text-slate-400 font-sans">预估总摩擦成本</span>
          <span className="text-lg font-bold text-slate-200">¥{totalFees.toFixed(1)}</span>
          <span className="text-[11px] text-emerald-400 font-sans">
            ETF享受免印花税政策
          </span>
        </div>
      </div>

      {/* 待调仓标的详细执行单 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-white">
          今日建议执行买卖清单 (超出死区缓冲带标的)
        </h3>

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
                  <th className="py-2.5 px-3">执行理由</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {actionablePositions.map((p) => {
                  const inst = p.instrument;
                  const isBuy = p.action === 'BUY';
                  const actionLots = p.recommendedShares / 100;

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
                        ¥{Math.round(p.recommendedShares * inst.currentPrice).toLocaleString()}
                      </td>

                      <td className="py-3 px-2 text-right text-slate-400">
                        ¥{p.estimatedFee.toFixed(1)}
                      </td>

                      <td className="py-3 px-3 text-[11px] font-sans text-slate-400">
                        {p.currentShares === 0 ? '建仓买入 · 满足卡弗波动率配比' : 
                         p.targetShares === 0 ? '清仓避险 · 趋势指标转负或跌破年线' :
                         isBuy ? '加仓 · 偏离目标上限超出死区' : '减仓锁定收益 · 标的波动率上升'}
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

            return (
              <div key={inst.id} className="p-3 bg-slate-800/30 rounded border border-slate-800/80 flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-white">{inst.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono">{inst.code}</div>
                </div>
                <div className="text-right font-mono tabular-nums text-[11px]">
                  <div className="text-slate-300">现持: {currentLots}手 · 目标: {targetLots}手</div>
                  <div className="text-cyan-400 text-[10px]">偏离: {deltaLots > 0 ? `+${deltaLots}` : deltaLots}手 (缓冲内)</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
