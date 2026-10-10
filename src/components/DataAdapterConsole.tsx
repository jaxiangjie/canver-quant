import React, { useState } from 'react';
import { AShareInstrument, ExternalDataAdapterConfig } from '../types/ashare';
import { AShareDataService } from '../services/apiClient';
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
  Upload
} from 'lucide-react';

interface DataAdapterConsoleProps {
  universe: AShareInstrument[];
  onUniverseUpdated: (updated: AShareInstrument[]) => void;
}

export const DataAdapterConsole: React.FC<DataAdapterConsoleProps> = ({
  universe,
  onUniverseUpdated,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'api' | 'paste' | 'checklist'>('api');
  const [jsonInput, setJsonInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

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
        "name": "沪深300ETF",
        "currentPrice": 4.025,
        "annualizedVol": 0.185,
        "dailyATR": 0.051,
        "riskBudgetWeight": 0.20
      }
    ]
  }'`;

  const handleParseJson = async () => {
    setStatusMsg(null);
    if (!jsonInput.trim()) {
      setStatusMsg({ type: 'error', text: '请先粘贴或输入 JSON 数据' });
      return;
    }

    try {
      const parsed = JSON.parse(jsonInput);
      const items = Array.isArray(parsed) ? parsed : (parsed.instruments || [parsed]);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('未识别到有效的标的数组 (需要包含 instruments 数组或标的对象)');
      }

      const updated = await AShareDataService.ingestRawPayload(items);
      onUniverseUpdated(updated);
      setStatusMsg({ type: 'success', text: `成功接入并解析 ${items.length} 个标的数据！` });
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

              <div className="p-3 bg-slate-800/40 rounded border border-slate-800 flex flex-col gap-1">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="font-bold text-amber-400">POST /api/ashare/proxy</span>
                  <span className="text-[10px] text-slate-500">外部转发代理</span>
                </div>
                <div className="text-slate-400 text-[10px] font-sans">
                  向工作台传递本地目标 URL (如 localhost:8000)，解决浏览器跨域限制。
                </div>
              </div>
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between text-slate-400 mb-1">
                <span className="font-sans text-[11px]">cURL 快速测试调用：</span>
                <button
                  onClick={() => copyText(curlCommand, 'curl')}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copiedSnippet === 'curl' ? '已复制' : '复制命令'}</span>
                </button>
              </div>
              <pre className="p-3 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-300 overflow-x-auto">
                {curlCommand}
              </pre>
            </div>
          </div>

          {/* 右侧：Python 直连推送脚本模板 */}
          <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-cyan-400" />
                Python 自动化推送脚本 (Tushare / AKShare)
              </h3>
              <button
                onClick={() => copyText(pythonScript, 'python')}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedSnippet === 'python' ? '已复制' : '复制代码'}</span>
              </button>
            </div>

            <pre className="p-3 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-300 overflow-x-auto h-80 leading-relaxed">
              {pythonScript}
            </pre>

            <div className="text-[11px] text-slate-400 font-sans leading-relaxed">
              提示：脚本可配置为盘后定时任务（如每日 15:30 自动抓取当日收盘数据并推送到工作台），工作台自动根据卡弗公式更新明日委托股数。
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 在线粘贴/导入 JSON 数据 */}
      {activeSubTab === 'paste' && (
        <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                粘贴自定义 A 股标的数据 (JSON 格式)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                支持直接将外部获取的字典或数组粘贴至此，系统将自动映射字段并更新到定仓计算器。
              </p>
            </div>

            <button
              onClick={handleResetUniverse}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-red-400 bg-slate-800/80 rounded border border-slate-700 transition-colors"
            >
              恢复默认标的池
            </button>
          </div>

          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            placeholder={`示例 JSON：
[
  {
    "code": "512480.SH",
    "name": "半导体ETF",
    "currentPrice": 0.985,
    "annualizedVol": 0.285,
    "dailyATR": 0.024,
    "riskBudgetWeight": 0.10,
    "currentShares": 0
  }
]`}
            rows={10}
            className="w-full bg-slate-950 font-mono text-xs text-slate-200 p-3 rounded border border-slate-800 focus:outline-none focus:border-emerald-500"
          />

          <div className="flex items-center justify-between">
            <span className="text-slate-500 text-[11px]">
              必填字段建议包含: code (代码), name (名称), currentPrice (现价), annualizedVol (年化波动率)
            </span>
            <button
              onClick={handleParseJson}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>一键解析并注入标的池</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab 3: 日频盘后 5 分钟打卡与范·撒普风控 */}
      {activeSubTab === 'checklist' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4 text-xs">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-emerald-400" />
              业余选手日频盘后 5 分钟自检清单 (EOD Checklist)
            </h3>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              系统化交易的精髓在于“将执行与情绪完全隔离”。收盘后花 5 分钟逐项打卡，明天开盘前直接交由既定规则执行，杜绝盘中临时起意。
            </p>

            <div className="flex flex-col gap-3 mt-2">
              {[
                { id: 1, title: '检查单标的最大风险敞口', desc: '确认没有单只标的亏损超过总资金 1% (即 10,000 元硬止损底线，范·撒普法则)。' },
                { id: 2, title: '核对卡弗 12% 死区缓冲带', desc: '凡是偏离度未超出缓冲带的标的，坚决不进行调仓，杜绝为券商打工。' },
                { id: 3, title: '核实 250 日年线大盘状态', desc: '确认沪深300及标的当前牛熊阶段，若处于年线下方，绝不主观抄底加杠杆。' },
                { id: 4, title: '检查总杠杆与现金流动性', desc: '确认账户权益占比合理，保持充足备用现金以应对黑天鹅冲击。' },
                { id: 5, title: '生成并预埋明日集合竞价单', desc: '在调仓执行单页面复制委托指令并在券商软件预设挂单，明日盘中坚决不盯盘。' },
              ].map((item) => {
                const isChecked = !!checklist[item.id];
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleCheck(item.id)}
                    className={`p-3 rounded border cursor-pointer transition-colors flex items-start gap-3 ${
                      isChecked
                        ? 'bg-emerald-950/20 border-emerald-800/40 text-slate-200'
                        : 'bg-slate-800/30 border-slate-800 text-slate-400'
                    }`}
                  >
                    <button className="mt-0.5 text-emerald-400">
                      {isChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                    </button>
                    <div className="flex flex-col gap-0.5">
                      <div className={`font-semibold text-xs ${isChecked ? 'text-white' : 'text-slate-300'}`}>
                        {item.id}. {item.title}
                      </div>
                      <div className="text-[11px] text-slate-400 leading-normal">
                        {item.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
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
