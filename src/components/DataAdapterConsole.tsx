import React, { useState } from 'react';
import { AShareInstrument, ExternalDataAdapterConfig } from '../types/ashare';
import { AShareDataService } from '../services/apiClient';
import { SyncReport } from '../services/liveMarketSync';
import { 
  Database, 
  Code, 
  Terminal, 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  CheckSquare, 
  Square, 
  Shield, 
  Copy, 
  Upload,
  RefreshCw,
  Zap,
  TrendingUp,
  Calendar,
  Layers,
  Check,
  Clock
} from 'lucide-react';

interface DataAdapterConsoleProps {
  universe: AShareInstrument[];
  onUniverseUpdated: (updated: AShareInstrument[]) => void;
  latestTradeDate?: string;
  onSyncLatest?: () => Promise<void> | void;
  isSyncingLatest?: boolean;
}

export const DataAdapterConsole: React.FC<DataAdapterConsoleProps> = ({
  universe,
  onUniverseUpdated,
  latestTradeDate,
  onSyncLatest,
  isSyncingLatest = false,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'sync' | 'api' | 'paste' | 'checklist'>('sync');
  const [jsonInput, setJsonInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);
  const [syncingSingleCode, setSyncingSingleCode] = useState<string | null>(null);
  const [isLocalSyncing, setIsLocalSyncing] = useState(false);

  // Daily checklist state
  const [checklist, setChecklist] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: false,
    4: true,
    5: false,
  });

  const toggleCheck = (id: number) => {
    setChecklist(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(label);
    setTimeout(() => setCopiedSnippet(null), 2500);
  };

  const handleSyncAll = async () => {
    if (onSyncLatest) {
      await onSyncLatest();
      return;
    }
    setIsLocalSyncing(true);
    setStatusMsg(null);
    try {
      const res = await AShareDataService.syncLatestMarketData();
      onUniverseUpdated(res.instruments);
      setSyncReport(res.report);
      setStatusMsg({
        type: 'success',
        text: `已成功同步 ${res.report.updatedCount}/${res.report.totalInstruments} 只标的至 ${res.report.latestTradingDate || '最新交易日'}，卡弗定仓引擎已自动重算目标仓位与ATR！`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `同步失败: ${err?.message || '网络连接超时'}`,
      });
    } finally {
      setIsLocalSyncing(false);
    }
  };

  const handleSyncSingle = async (code: string) => {
    setSyncingSingleCode(code);
    setStatusMsg(null);
    try {
      const res = await AShareDataService.syncLatestMarketData({ codes: [code] });
      onUniverseUpdated(res.instruments);
      setStatusMsg({
        type: 'success',
        text: `标的 ${code} 增量同步完成！`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `同步标的 ${code} 失败: ${err?.message}`,
      });
    } finally {
      setSyncingSingleCode(null);
    }
  };

  // Sample python adapter script for Tushare/AKShare
  const pythonScript = `# A-Share Data Ingest Script (适配 Tushare / AKShare 自建数据直连)
import requests
import json

# 工作台本地/服务接入端点
SERVER_URL = "http://localhost:3000/api/ashare/ingest"

# 构造标准格式数据包
instruments_payload = [
    {
        "code": "510300.SH",
        "name": "沪深300ETF",
        "isETF": True,
        "isT0": False,
        "currentPrice": 4.025,
        "preClose": 3.992,
        "changePct": 0.83,
        "dailyATR": 0.051,
        "annualizedVol": 0.185,
        "riskBudgetWeight": 0.20,
        "currentShares": 50000,
        "dividendYield": 2.75
    },
    {
        "code": "512890.SH",
        "name": "红利低波ETF",
        "isETF": True,
        "isT0": False,
        "currentPrice": 1.168,
        "preClose": 1.162,
        "changePct": 0.52,
        "dailyATR": 0.012,
        "annualizedVol": 0.118,
        "riskBudgetWeight": 0.20,
        "currentShares": 171000,
        "dividendYield": 4.85
    }
]

# 一键推送至系统化工作台
res = requests.post(SERVER_URL, json={"instruments": instruments_payload})
print("推送到卡弗工作台状态:", res.status_code, res.json())
`;

  const curlCommand = `curl -X POST http://localhost:3000/api/ashare/ingest \\
  -H "Content-Type: application/json" \\
  -d '{
    "instruments": [
      {
        "code": "510300.SH",
        "currentPrice": 4.025,
        "preClose": 3.992,
        "changePct": 0.83,
        "dailyATR": 0.051,
        "annualizedVol": 0.185
      }
    ]
  }'`;

  const handleJsonImport = async () => {
    if (!jsonInput.trim()) {
      setStatusMsg({ type: 'error', text: '请输入有效的 JSON 数据' });
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);
      const list = Array.isArray(parsed) ? parsed : (parsed.instruments || [parsed]);
      
      const updated = await AShareDataService.ingestRawPayload(list);
      onUniverseUpdated(updated);
      setStatusMsg({ type: 'success', text: `成功导入并更新 ${list.length} 个标的行情与波动率！` });
      setJsonInput('');
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `JSON 解析失败: ${err?.message || '格式错误'}` });
    }
  };

  const handleResetUniverse = () => {
    if (confirm('确认恢复默认的 A股精选 ETF 与股票标的池？')) {
      const reset = AShareDataService.resetUniverse();
      onUniverseUpdated(reset);
      setStatusMsg({ type: 'success', text: '已重置为系统默认精选标的池' });
    }
  };

  const syncing = isSyncingLatest || isLocalSyncing;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部选项栏 */}
      <div className="flex items-center justify-between p-4 bg-slate-900/70 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">
            A股数据接入中心与系统交易纪律管理
          </h2>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setActiveSubTab('sync')}
            className={`px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 ${
              activeSubTab === 'sync' ? 'bg-emerald-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-300" />
            <span>在线增量同步 (推荐)</span>
          </button>
          <button
            onClick={() => setActiveSubTab('api')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeSubTab === 'api' ? 'bg-emerald-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            接口规范与代码
          </button>
          <button
            onClick={() => setActiveSubTab('paste')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeSubTab === 'paste' ? 'bg-emerald-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            在线粘贴导入数据
          </button>
          <button
            onClick={() => setActiveSubTab('checklist')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeSubTab === 'checklist' ? 'bg-emerald-600 text-white font-medium' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            日频盘后5分钟打卡
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded text-xs flex items-center gap-2 border ${
          statusMsg.type === 'success' 
            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60' 
            : 'bg-red-950/60 text-red-300 border-red-700/60'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Tab 0: 在线实时增量行情同步 (推荐) */}
      {activeSubTab === 'sync' && (
        <div className="flex flex-col gap-6">
          {/* 状态看板 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                当前数据最新交易日
              </span>
              <span className="text-xl font-bold font-mono text-emerald-400">
                {latestTradeDate || '2026-10-09'}
              </span>
              <span className="text-[10px] text-slate-500">
                策略以此交易日收盘价计算目标仓位
              </span>
            </div>

            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                系统标的池规模
              </span>
              <span className="text-xl font-bold font-mono text-cyan-400">
                {universe.length} 只标的
              </span>
              <span className="text-[10px] text-slate-500">
                宽基/行业/债券/商品/QDII/个股
              </span>
            </div>

            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-1">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                增量补齐通道状态
              </span>
              <span className="text-xl font-bold font-mono text-amber-400 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                在线就绪
              </span>
              <span className="text-[10px] text-slate-500">
                前复权日线 + 毫秒级快照直接拉取
              </span>
            </div>

            <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                一键增量同步
              </span>
              <button
                onClick={handleSyncAll}
                disabled={syncing}
                className="mt-2 w-full py-2 px-3 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 rounded border border-emerald-500/40 flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? '正在拉取全市场数据...' : '立即同步最新交易日'}</span>
              </button>
            </div>
          </div>

          {/* 增量同步机制解释卡片 */}
          <div className="p-4 bg-slate-900/50 border border-slate-800/80 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
            <div className="flex flex-col gap-1">
              <div className="font-semibold text-slate-200 flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                增量行情自动补齐与 Carver 目标仓位联动机制
              </div>
              <div className="text-slate-400 text-[11px] leading-relaxed">
                当运行策略或载入工作台时，系统将智能对比本地数据最后一根 K 线的日期与全市场最新交易日。若滞后，将自动通过公共金融通道补齐缺失交易日的真实高开低收成交量，重新滚动计算 20/60/250 日均线与 120 日年化波动率，并驱动卡弗缓冲带判定。
              </div>
            </div>
          </div>

          {/* 各标的当前最新数据时效与指标表格 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                标的池行情时效与指标清单
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">
                共 {universe.length} 标的
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                    <th className="py-2.5 px-3">代码 / 标的名称</th>
                    <th className="py-2.5 px-3">类别</th>
                    <th className="py-2.5 px-3">最新交易日</th>
                    <th className="py-2.5 px-3 text-right">最新收盘价</th>
                    <th className="py-2.5 px-3 text-right">涨跌幅</th>
                    <th className="py-2.5 px-3 text-right">日 ATR(20)</th>
                    <th className="py-2.5 px-3 text-right">年化波动率</th>
                    <th className="py-2.5 px-3 text-right">K线总数</th>
                    <th className="py-2.5 px-3 text-center">数据源</th>
                    <th className="py-2.5 px-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {universe.map((inst) => {
                    const lastBar = inst.bars?.[inst.bars.length - 1];
                    const tradeDate = lastBar?.tradeDate || '无数据';
                    const isUpToDate = tradeDate === latestTradeDate;
                    const isSingleSyncing = syncingSingleCode === inst.code;

                    return (
                      <tr key={inst.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2 px-3 font-sans font-medium text-slate-200">
                          <div className="flex items-center gap-1.5">
                            <span>{inst.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({inst.code})</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {inst.isETF ? 'ETF基金' : 'A股个股'}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${
                            isUpToDate
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
                              : 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isUpToDate ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {tradeDate}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-slate-100">
                          ¥{inst.currentPrice.toFixed(inst.currentPrice >= 10 ? 2 : 3)}
                        </td>
                        <td className={`py-2 px-3 text-right font-medium ${
                          inst.changePct >= 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}>
                          {inst.changePct >= 0 ? `+${inst.changePct.toFixed(2)}%` : `${inst.changePct.toFixed(2)}%`}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">
                          ¥{inst.dailyATR.toFixed(3)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">
                          {(inst.annualizedVol * 100).toFixed(1)}%
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">
                          {inst.bars?.length || 0} 根
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] ${
                            inst.dataSource === 'realtime_synced'
                              ? 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/60'
                              : inst.dataSource === 'parquet'
                              ? 'bg-blue-900/50 text-blue-300 border border-blue-700/60'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {inst.dataSource === 'realtime_synced' ? '实时同步' : inst.dataSource === 'parquet' ? 'Parquet湖' : '离线拟合'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => handleSyncSingle(inst.code)}
                            disabled={isSingleSyncing || syncing}
                            title="单独同步此标的最新日线"
                            className="px-2 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 transition-colors disabled:opacity-50"
                          >
                            {isSingleSyncing ? '同步中...' : '刷新'}
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

      {/* Tab 1: API 接口文档与直连代码 */}
      {activeSubTab === 'api' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：REST API 端点规范 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Code className="w-4 h-4 text-emerald-400" />
              REST 接口定义说明 (已开放并监听)
            </h3>
            
            <div className="flex flex-col gap-3 font-mono text-[11px]">
              <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-bold text-amber-400">GET /api/ashare/sync-latest</span>
                  <span className="text-[10px] text-slate-500">在线增量拉取</span>
                </div>
                <div className="text-slate-400 text-[10px] font-sans">
                  从公共金融数据通道直接抓取最新交易日的真实 OHLCV 并自动增量合入，重算波动率与均线。
                </div>
              </div>

              <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-bold text-emerald-400">POST /api/ashare/ingest</span>
                  <span className="text-[10px] text-slate-500">外部推送数据</span>
                </div>
                <div className="text-slate-400 text-[10px] font-sans">
                  用于将您的 A 股行情或自定义因子批量推送进工作台。支持单个或批量标的对象。
                </div>
              </div>

              <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-bold text-cyan-400">GET /api/ashare/instruments</span>
                  <span className="text-[10px] text-slate-500">读取标的池</span>
                </div>
                <div className="text-slate-400 text-[10px] font-sans">
                  获取当前系统内存储的所有标的最新价格、波动率、ATR及策略指标。
                </div>
              </div>
            </div>

            {/* cURL 示例 */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-between text-slate-300 font-sans">
                <span className="font-semibold">cURL 推送测试代码：</span>
                <button
                  onClick={() => copyText(curlCommand, 'curl')}
                  className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedSnippet === 'curl' ? '已复制' : '复制命令'}</span>
                </button>
              </div>
              <pre className="p-3 bg-[#080C14] rounded border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                {curlCommand}
              </pre>
            </div>
          </div>

          {/* 右侧：Python 直连脚本 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Python 脚本 (Tushare / AKShare 直连模板)
              </h3>
              <button
                onClick={() => copyText(pythonScript, 'python')}
                className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedSnippet === 'python' ? '已复制' : '复制 Python 脚本'}</span>
              </button>
            </div>

            <p className="text-slate-400 leading-normal">
              每日收盘后（15:05），您可在本地跑此脚本自动抓取日线数据并推送至工作台。工作台接收后将立即根据新的日ATR与年化波动率重新计算卡弗目标仓位。
            </p>

            <pre className="p-3 bg-[#080C14] rounded border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-[380px] leading-relaxed">
              {pythonScript}
            </pre>
          </div>
        </div>
      )}

      {/* Tab 2: 在线粘贴导入 JSON */}
      {activeSubTab === 'paste' && (
        <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 text-emerald-400" />
              在线粘贴自定义 JSON 行情数据
            </h3>
            <button
              onClick={handleResetUniverse}
              className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors"
            >
              恢复系统初始精选池
            </button>
          </div>

          <p className="text-slate-400 leading-normal">
            若您未搭建后台推送服务，可直接在此处粘贴包含标的行情数据的 JSON 数组。
            必需字段包括: <code className="text-emerald-400 font-mono">code</code>, <code className="text-emerald-400 font-mono">currentPrice</code>, <code className="text-emerald-400 font-mono">dailyATR</code>, <code className="text-emerald-400 font-mono">annualizedVol</code>。
          </p>

          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`[\n  {\n    "code": "510300.SH",\n    "name": "沪深300ETF",\n    "currentPrice": 4.025,\n    "preClose": 3.992,\n    "changePct": 0.83,\n    "dailyATR": 0.051,\n    "annualizedVol": 0.185\n  }\n]`}
            className="w-full h-56 p-3 bg-[#080C14] border border-slate-800 rounded font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
          />

          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setJsonInput('')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium transition-colors"
            >
              清空输入
            </button>
            <button
              onClick={handleJsonImport}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition-colors flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>解析并合并入工作台</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: 日频盘后 5 分钟打卡与纪律防线 */}
      {activeSubTab === 'checklist' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 5分钟操作打卡单 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-400" />
              卡弗交易法 · 盘后 5 分钟标准化操作清单 (SOP)
            </h3>

            <p className="text-slate-400 leading-normal">
              系统化交易的魅力在于将精力从盘中杂乱无章的红绿涨跌中解脱出来。每日收盘后花 5 分钟执行以下步骤：
            </p>

            <div className="flex flex-col gap-2.5 pt-1">
              {[
                { id: 1, title: '15:05 行情拉取与更新', desc: '执行增量同步或通过 Tushare/AKShare 推送当日收盘价与ATR波幅。' },
                { id: 2, title: '15:07 检查波动率定仓变动', desc: '观察总杠杆率是否在上限 120% 以内，是否有标的因波动骤增而需被动降仓。' },
                { id: 3, title: '15:08 确认再平衡缓冲带边界', desc: '系统标记为「缓冲带触发」的标的才生成调仓单，避免无意义的微小调仓滑点。' },
                { id: 4, title: '15:09 生成明日挂单委托单', desc: '导出或记录「日频调仓执行单」，根据涨跌停与千0.5印花税规则核对股数。' },
                { id: 5, title: '15:10 记录交易日志与风险预算', desc: '关闭软件，避免盘中频繁人为干预与情绪化操作，让概率分布持续做功。' },
              ].map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleCheck(item.id)}
                  className={`p-3 rounded border flex items-start gap-3 cursor-pointer transition-colors ${
                    checklist[item.id]
                      ? 'bg-emerald-950/20 border-emerald-900/40 text-slate-200'
                      : 'bg-slate-800/30 border-slate-800 text-slate-400 hover:bg-slate-800/50'
                  }`}
                >
                  <button className="mt-0.5 text-emerald-400 shrink-0">
                    {checklist[item.id] ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                  </button>
                  <div className="flex flex-col gap-0.5">
                    <span className={`font-semibold ${checklist[item.id] ? 'text-white' : 'text-slate-300'}`}>
                      {item.title}
                    </span>
                    <span className="text-[11px] text-slate-400 leading-normal">
                      {item.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 范·撒普 R 乘数与防破产核心备忘 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              范·撒普 R 乘数与破产防线
            </h3>

            <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1.5 font-mono text-[11px]">
              <span className="text-slate-400 font-sans">100万总资本单笔风险上限 (1R):</span>
              <span className="text-lg font-bold text-amber-400 tabular-nums">¥10,000 (1.0%)</span>
              <span className="text-[10px] text-slate-500 font-sans leading-normal">
                任何一笔交易，若触发止损，最大亏损金额不得超过 10,000 元。即使遭遇连续 10 笔失败，本金仍然保留 90% 以上。
              </span>
            </div>

            <div className="text-[11px] text-slate-300 leading-relaxed flex flex-col gap-2">
              <div className="font-semibold text-white">罗伯特·卡弗的《系统化交易》心法：</div>
              <p className="text-slate-400">
                “你无法控制明天的市场走势，但你可以 100% 精确控制自己承受的波动率风险。当风险可控时，时间就是系统交易者最忠实的朋友。”
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
