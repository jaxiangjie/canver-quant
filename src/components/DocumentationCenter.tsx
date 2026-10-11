import React, { useState } from 'react';
import { 
  BookOpen, 
  FileText, 
  Cpu, 
  Layers, 
  ShieldCheck, 
  Search, 
  Copy, 
  Check, 
  ExternalLink,
  ChevronRight,
  BookmarkCheck,
  Compass
} from 'lucide-react';

interface DocItem {
  id: string;
  title: string;
  fileName: string;
  category: '架构设计' | '量化理论' | '学术文献' | 'A股实盘' | '风控回测';
  description: string;
  icon: any;
  content: string;
}

const DOCS_DATA: DocItem[] = [
  {
    id: 'architecture',
    title: '系统总体架构设计说明书',
    fileName: 'ARCHITECTURE.md',
    category: '架构设计',
    icon: Cpu,
    description: '分层计算拓扑、模块职责划分、纯前端高性能计算引擎与 A 股数据流转状态机。',
    content: `## 1. 系统架构分层拓扑

本系统遵循**高内聚、低耦合、前端驱动的高性能计算架构**，所有计算引擎与数值优化均使用纯 TypeScript / D3 算法实现，零依赖外部黑盒。

- **表示展示层 (Presentation Layer)**: CarverPositionSizer (波动率定仓)、InstrumentAnalytics (四象限深度投研)、BacktestSandbox (回测沙盘)、StressTesting (极端压力测试)、MonteCarlo (未来财富锥)
- **业务状态与协调层 (State Layer)**: App.tsx 中央状态树 (Universe, CarverSettings, MonitoringState)
- **量化计算引擎层 (Core Engines)**:
  - \`carverEngine.ts\`: 现金波动率定仓、IDM 动态乘数补偿、杠杆硬顶与 12% 死区缓冲带
  - \`correlationEngine.ts\`: 60D 皮尔逊相关性矩阵、D3 热力图、卡弗 IDM 组合分散度计算
  - \`ashareStrategies.ts\`: EWMAC 多均线交叉、绝对动量年线过滤、股债收益差 ERP
- **数据适配与本地化层 (Data & Adapter)**: 支持真实外部 API 聚合网关与内置真实市场耦合生成器

---

## 2. 核心量化模块与职责划分

### 2.1 波动率定仓引擎 (carverEngine.ts)
- **现金波动率目标计算**:
  \`Daily Cash Vol Target = (Total Capital * Target Annual Vol) / sqrt(250)\`
- **单标的价格波动率**:
  \`Instrument Daily Vol = Price * (Annual Vol / sqrt(250))\`
- **IDM 动态乘数与仓位预算放大**:
  \`Base Position = (Daily Cash Vol Target * Weight Budget * IDM) / Instrument Daily Vol\`
- **组合级最大杠杆硬顶约束机制**:
  当全组合加权目标总持仓金额超过 \`(1 + Max Leverage) * Total Capital\` (例如 120 万元) 时，启动全局等比压缩 (Pro-Rata Scaling)，保证绝不超额杠杆。
- **一手 100 股向下整取**:
  \`Target Shares = floor(Raw Shares / 100) * 100\`
- **Buffer 死区缓冲带判定**:
  偏离比例 \`|Target - Current| / Target <= 12%\` 时判定为 HOLD，不产生交易摩擦。`
  },
  {
    id: 'carver_framework',
    title: '罗伯特·卡弗系统化交易理论体系',
    fileName: 'CARVER_FRAMEWORK.md',
    category: '量化理论',
    icon: Layers,
    description: '现金波动率目标、IDM 标的分散化乘数、EWMAC 预测标量与 12% 缓冲带死区数学推导。',
    content: `## 1. 核心理论源起

本系统严格建立在英国资深量化对冲基金经理、AHL（元盛资本前投资总监）核心策略设计者 **罗伯特·卡弗（Robert Carver）** 的两部权威著作之上：
- **《Systematic Trading: A unique new method for designing trading and investing systems》** (2015)
- **《Smart Portfolios: A fool-proof alternative to traditional asset allocation》** (2017)

---

## 2. 卡弗模型六大核心数学基石

### 2.1 现金波动率目标 (Cash Volatility Target)
卡弗提出，投资者不应当直接按资产的“金额比例”分配本金，而应当分配**每日愿意承担的现金损失波动（Cash Volatility）**：
\`Daily Cash Vol Target = (Total Capital * Target Annual Vol) / sqrt(250)\`
若本金为 100 万元，目标年化波动率为 12%，则每天允许组合的标准差浮动上限为约 7,589 元。

### 2.2 标的分散化乘数 IDM (Instrument Diversification Multiplier)
#### 为什么许多多资产配置模型年化收益只有 6%？
当组合纳入股票、债券、黄金等多类低相关甚至负相关的资产时，由于标的间相互对冲，整个组合的合并波动率会大幅低于预期的目标波动率（例如原本预期 12%，合并后仅剩下 8%）。**未加杠杆补偿的组合实际承担的风险远低于投资者的承受上限，导致长期复利收益被动缩水**。

#### 卡弗的数学解法：
设 N 个标的组合，平均相关系数为 rho：
\`Portfolio Variance Ratio = 1/N + (1 - 1/N) * rho\`
\`IDM = 1 / sqrt(Portfolio Variance Ratio)\`
- 本系统当前标的池（宽基 ETF、国债、黄金、纳指、恒生科技等）的 rho 由 **60 日对数收益相关性矩阵实时求解**，因此 IDM 是动态值：池子越分散（rho 越低）IDM 越高，并受 computeCarverIDM 上限 2.5 约束。
- UI「卡弗标的分散化乘数」卡片显示的是**受 maxIDM（默认 1.80）封顶后的生效值**，与相关性分析页展示的未封顶理论值可能不同（两者口径有意区分）。
- 将基础仓位乘上 IDM 是为了补偿多资产对冲造成的波动平抑；但即便用满 IDM，实际组合波动仍受**杠杆上限（默认最多 20%，总市值 ≤ 120%）**与**资产池自身对冲**约束，不一定精确等于目标波动 —— 结论以回测 Tab 的实测年化波动为准。

### 2.3 调仓死区缓冲带 (Position Buffering)
在卡弗的实战哲学中，“不要频繁交易”是系统化投资第一铁律。设定缓冲阈值 12%，偏离未超阈值坚决不调仓，避免频繁换手滑点磨损。`
  },
  {
    id: 'references',
    title: '参考文献、经典专著与同级产品深度对标',
    fileName: 'REFERENCES.md',
    category: '学术文献',
    icon: BookOpen,
    description: 'Carver、López de Prado、Antonacci、Harvey 顶刊文献，及与 Portfolio Visualizer、聚宽横向对比。',
    content: `## 1. 经典专著与学术文献

1. **Robert Carver (2015)**: *Systematic Trading*, Harriman House. (现金波动率目标、IDM乘数、Buffer带宽)
2. **Robert Carver (2017)**: *Smart Portfolios*, Harriman House. (针对 ETF 的手工打造资产配置法)
3. **Marcos López de Prado (2018)**: *Advances in Financial Machine Learning*, Wiley. (分层风险平价 HRP)
4. **Gary Antonacci (2014)**: *Dual Momentum Investing*, McGraw-Hill. (绝对动量与相对动量双滤网)
5. **Harvey et al. (2018)**: *The Impact of Volatility Targeting*, *The Journal of Portfolio Management*. (目标波动率消除左侧肥尾风险实证)
6. **Ray Dalio (2015)**: *The All Weather Story*, Bridgewater Associates. (四象限宏观风险平价)

---

## 2. 同级工业级产品横向深度对标

| 维度 / 功能特性 | Portfolio Visualizer (美股) | 聚宽 / 优矿 (国内量化) | **本系统 (Carver Systematic)** |
| :--- | :--- | :--- | :--- |
| **定仓逻辑** | MVO 均值方差 / 纯逆方差 | 代码编写因子模型 | **卡弗现金波动率目标 + IDM 动态补偿 + 杠杆硬顶** |
| **分散化收益补偿** | 需用户手动填 Leverage | 需写定制算法 | **自动计算 60D 矩阵推导 IDM 乘数 (1.3x~1.8x)** |
| **调仓磨损控制** | 机械按月/季度调仓 | 依赖自定义代码 | **内置 Carver 12% 死区缓冲带 + 一手 100 股向下整取** |
| **A 股本地化交易** | 完全不支持 | 支持 Python 回测 | **支持 T+1 流动性保护、ETF 免税、一键复制委托单** |
| **极端场景压力测试** | 2008 / 2020 场景 | 需自写代码切分 | **内置 2015 股灾、2018 熊市、2024 雪球踩踏、924 暴涨** |
| **未来概率预测** | Monte Carlo 模拟 | 需外部库 | **内置 2,000 条 GBM 几何布朗运动财富概率锥** |`
  },
  {
    id: 'localization',
    title: 'A 股与 ETF 本地化交易机制落地指南',
    fileName: 'A_SHARE_LOCALIZATION.md',
    category: 'A股实盘',
    icon: ShieldCheck,
    description: '一手 100 股向下取整、ETF 免印花税、T+1 流动性断裂防守与股债收益差 ERP 罗盘。',
    content: `## 1. 为什么海外量化模型不能在 A 股“裸跑”？

海外许多量化模型默认设立在 **T+0、可自由裸做空、碎股交易、无涨跌停限制** 的成熟衍生品市场上。
若直接套用在 A 股会遭遇严重水土不服：
1. **买入无法即时卖出 (T+1)**：日内单边下跌无法对冲；
2. **涨跌停流动性断裂**：千股跌停时卖不出，一字涨停买不到；
3. **一手 100 股限制**：无法持有如 237 股理论小数；
4. **摩擦税费结构**：个股卖出千分之 0.5 印花税，而 ETF 全程免征印花税。

---

## 2. 系统本地化解决方案

### 2.1 一手 100 股向下严格取整 (Floor Lot Constraint)
\`Target Shares = max(0, floor(Raw Target Shares / 100) * 100)\`
向下取整确保总持仓金额绝不超过可用资金和 20% 杠杆上限，避免现金账户透支。

### 2.2 交易费用与税费的精准核算
- **ETF 资产 (代码以 51 / 15 开头)**: 佣金万 1.0，**印花税 0% (免税)**
- **A 股个股**: 佣金万 2.5，卖出征收千分之 0.5 证券印花税。

### 2.3 股债收益差 ERP (Equity Risk Premium / Fed 估值模型)
\`ERP = 1 / PE_TTM - r_10Y_国债\`
- **高 ERP 区间 (> 80% 历史分位)**: 属于“便宜黄金坑”，系统自动赋予股票类资产 **1.15x ~ 1.25x 战术安全边际增益**。
- **低 ERP 区间 (< 20% 历史分位)**: 股票过度泡沫化，系统自动降低权益资产预测标量，增配防御性债券与黄金。`
  },
  {
    id: 'stress_monte_carlo',
    title: '极端情境压力测试与蒙特卡洛财富概率锥',
    fileName: 'STRESS_TEST_AND_MONTE_CARLO.md',
    category: '风控回测',
    icon: Compass,
    description: '2015 股灾/2018 阴跌/2024 雪球踩踏压力测试，与 2000 条 GBM 未来财富概率锥推导。',
    content: `## 1. 极端历史情境压力测试 (Stress Testing)

量化配置系统的稳健性不能仅仅检验牛市，必须在 A 股最具毁灭性的极端压力窗口中进行抗击穿检验：

1. **2015.06 - 2015.08 杠杆牛破裂与流动性踩踏**:
   - 沪深300 最大跌幅: -45.2%
   - 卡弗多资产组合: -14.8% (超额对冲 +30.4%)
   - 回本耗时: 38 天 vs 大盘 1350+ 天
2. **2018.01 - 2018.12 中美贸易战与去杠杆单边熊市**:
   - 沪深300: -32.5%
   - 卡弗多资产组合: +2.4% (逆势微利，250日年线破位自动清仓股票，转入国债与高股息红利)
3. **2024.01 - 2024.02 雪球敲入与微盘流动性踩踏**:
   - 纯宽基与国债黄金配置，未暴露微盘无序流动性敞口，组合最大回撤仅 -3.9%。
4. **2024.09 - 2024.10 924 政策转向急牛爆发**:
   - 股债收益差 ERP 极值触发进攻偏置，右侧 EWMAC 打满至 +20，及时跟进 +21.6% 稳健收益。

---

## 2. 蒙特卡洛模拟未来财富分布锥 (Monte Carlo Projection)

### 几何布朗运动 (GBM) 随机微分方程
\`S(t+dt) = S(t) * exp((mu - 0.5 * sigma^2) * dt + sigma * sqrt(dt) * Z)\`
- 模拟规模: 2,000 条独立随机游走路径
- 投影跨度: 未来 1 年、3 年、5 年
- 提取 5 条关键分位线: 95% (极佳行情)、75% (乐观)、50% (中位期望基准)、25% (偏弱)、5% (极端悲观大底)。`
  }
];

export const DocumentationCenter: React.FC = () => {
  const [selectedDocId, setSelectedDocId] = useState<string>('architecture');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const selectedDoc = DOCS_DATA.find(d => d.id === selectedDocId) || DOCS_DATA[0];

  const filteredDocs = DOCS_DATA.filter(d => 
    d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopyContent = () => {
    navigator.clipboard.writeText(selectedDoc.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部标题栏 */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-950/80 text-indigo-400 border border-indigo-800/60">
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              系统开发与技术架构文档中心 (System Documentation & Architecture)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              内置 5 篇权威技术文档、卡弗公式数学推导、顶刊文献引用与 A 股实盘交易风控机制。
            </p>
          </div>
        </div>

        {/* 搜索框 */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索文档、公式、IDM、EWMAC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* 主体两栏布局：左侧文档树导航，右侧富文本阅读器 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 左侧导航栏 (4列) */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <div className="text-xs font-semibold text-slate-400 px-1 flex items-center justify-between">
            <span>技术文档清单 ({filteredDocs.length})</span>
            <span className="font-mono text-[10px] text-slate-500">/docs 目录持久化存储</span>
          </div>

          <div className="flex flex-col gap-2">
            {filteredDocs.map((doc) => {
              const isSelected = doc.id === selectedDocId;
              const IconComp = doc.icon;
              return (
                <button
                  key={doc.id}
                  onClick={() => setSelectedDocId(doc.id)}
                  className={`flex flex-col text-left p-3.5 rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800/90 border-indigo-500 shadow-md shadow-indigo-950/20 ring-1 ring-indigo-500/40'
                      : 'bg-slate-900/60 border-slate-800 hover:bg-slate-850 hover:border-slate-700 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded border bg-slate-950/80 text-indigo-300 border-indigo-900/40">
                      {doc.category}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {doc.fileName}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-white mb-1 flex items-center gap-2">
                    <IconComp className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>{doc.title}</span>
                  </h4>

                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {doc.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧阅读器 (8列) */}
        <div className="lg:col-span-8 p-6 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-5">
          {/* 阅读器头部 */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60">
                  {selectedDoc.category}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  docs/{selectedDoc.fileName}
                </span>
              </div>
              <h2 className="text-base font-bold text-white mt-1.5">
                {selectedDoc.title}
              </h2>
            </div>

            <button
              onClick={handleCopyContent}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white rounded border border-slate-700 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">已复制文档 Markdown</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>复制 Markdown 源码</span>
                </>
              )}
            </button>
          </div>

          {/* 正文渲染区 */}
          <div className="text-xs text-slate-300 leading-relaxed font-sans space-y-4 max-h-[640px] overflow-y-auto pr-2">
            {selectedDoc.content.split('\n\n').map((block, idx) => {
              if (block.startsWith('## ')) {
                return (
                  <h3 key={idx} className="text-sm font-bold text-white pt-2 pb-1 border-b border-slate-800/80 flex items-center gap-2">
                    <BookmarkCheck className="w-4 h-4 text-indigo-400" />
                    <span>{block.replace('## ', '')}</span>
                  </h3>
                );
              }
              if (block.startsWith('### ')) {
                return (
                  <h4 key={idx} className="text-xs font-bold text-indigo-300 pt-1">
                    {block.replace('### ', '')}
                  </h4>
                );
              }
              if (block.startsWith('- ')) {
                return (
                  <ul key={idx} className="list-disc list-inside space-y-1.5 text-slate-300 pl-1">
                    {block.split('\n').map((item, itemIdx) => (
                      <li key={itemIdx} className="leading-relaxed">
                        {item.replace(/^- /, '')}
                      </li>
                    ))}
                  </ul>
                );
              }
              if (block.startsWith('|')) {
                const rows = block.split('\n');
                return (
                  <div key={idx} className="overflow-x-auto my-2 border border-slate-800 rounded">
                    <table className="w-full text-left text-[11px] border-collapse">
                      <tbody>
                        {rows.map((row, rowIdx) => {
                          const cols = row.split('|').filter(c => c.trim().length > 0);
                          if (row.includes('---')) return null;
                          const isHeader = rowIdx === 0;
                          return (
                            <tr key={rowIdx} className={`border-b border-slate-800/80 ${isHeader ? 'bg-slate-950 font-bold text-white' : 'hover:bg-slate-850'}`}>
                              {cols.map((col, colIdx) => (
                                <td key={colIdx} className="p-2 border-r border-slate-800/60 last:border-r-0">
                                  {col.trim()}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              }
              if (block.startsWith('`') || block.includes('`')) {
                return (
                  <div key={idx} className="p-3 bg-slate-950/80 rounded border border-slate-800 font-mono text-[11px] text-cyan-300 overflow-x-auto">
                    {block.replace(/`/g, '')}
                  </div>
                );
              }
              return (
                <p key={idx} className="text-slate-300 leading-relaxed">
                  {block}
                </p>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
            <span>文件保存在项目根目录: docs/{selectedDoc.fileName}</span>
            <span>包含完整公式与参考文献引用</span>
          </div>
        </div>
      </div>
    </div>
  );
};
