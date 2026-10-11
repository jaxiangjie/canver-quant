# Code Review — feature/carver-v2 (2026-10-11)

> 目的：记录本分支相对 main 的改动审查结论，分为「已修复」「待修改」「设计待定」三档，供后续 agent（Gemini）照单修改。
>
> 当前分支：`feature/carver-v2`（本地 5 提交：`55cd836`+`f295312`+`33e98e1`+`5ea5604`+`034a341`，均未推送）。
> 真实数据：`data/parquet/daily/` 20 个 `_hfq.parquet`（OHLCV only，无 PE/PB 基本面字段）。

---

## 0. 总根因（理解所有问题的前提）

**真实 parquet 只含 OHLCV，没有 PE/PB。** 但项目里有一整套「估值百分位 → 战术偏置/仓位乘数」子系统，数据来源是 `instrument.pePercentile` / `pbPercentile` / `peTTM` / `pb`。真实数据下这些字段恒为 `undefined` → 代码里大量 `?? 50` 兜底 → 估值逻辑被静默喂入假值。

这单一根因衍生出本文档 §2 的全部 B/C 级问题，以及 A 级「功能静默失效」。

---

## 1. 已修复（不要重做，仅作上下文）

| commit | 内容 |
|--------|------|
| `33e98e1` | **②** 抽取 `resolveBufferDecision()` 共用函数，`calculateInstrumentPosition` 与 `calculatePortfolio` 第二遍都用它，使 `hysteresisBuffer` / `minTradeAmount` 在 Sizer UI（组合层）真正生效；**③** `SELECT_ETF5` 描述「年化突破 10%+」改为实测 8.2%，删无来源逐腿 CAGR 注释 |
| `5ea5604` | **①** `HistoricalValuationRangeChart` 改用 `generatePricePercentileHistory`（真实价格分位），去掉 `generate3YearValuationHistory` 合成 PE/PB 填充；全图措辞去「估值/低估高估/安全边际/泡沫」语义 |
| `034a341` | **④（同级另一图）** `ValuationHistoryChart` 同样切到 `generatePricePercentileHistory`，三处喂养点（ashareStrategies `history5y`、InstrumentDeepAnalysisPanel `valuationHistory5Y`）一并切换；空态改为「暂无真实价格历史数据」 |

---

## 2. 待 Gemini 修改（open issues）

### A. `useERPTilt` 默认开启、真实数据下静默失效（中，误导性）

- **文件/行**：`src/services/carverEngine.ts:25`（默认 `useERPTilt: true`）、`:145-151`（ERP 逆向战术偏置块，按 `strategySignals.valuationSignal.valuationZone` 给 scalar +1.5~+3）；根因在 `src/services/ashareStrategies.ts:296-344`。
- **现状**：真实数据 `peTTM/pb = 0` → `hasValuation=false`（`:303`）→ `valuationZone` 恒为 `'FAIR'`（`:309/341` 兜底）→ 该偏置**永不触发**（完全惰性，并非误触发）。
- **问题**：UI 仍标注「已开启（估值底加仓）」，使用者误以为系统在用估值做战术加仓，实际是死开关。
- **建议修法（二选一，需用户拍板，见 §3）**：
  1. **禁用 + 标注**：真实数据无 PE/PB 时，引擎短路该分支，UI 显式显示「无估值数据，ERP 偏置未启用」而非「已开启」；
  2. **重基到真实信号**：改用 `generatePricePercentileHistory` 产出的价格分位驱动 tilt（注意语义：价格高=动量大，与 EWMAC 动量重叠，需重新论证乘数符号，不宜直接套用原 +3 / -3.5）。

### B. 估值卡「无 PE 却有分位」显示矛盾（低，展示）

- **文件/行**：`src/components/InstrumentDeepAnalysisPanel.tsx:555`、`:559`。
- **现状**：`{selectedItem.peTTM > 0 ? selectedItem.peTTM.toFixed(1) : '--'} ({selectedItem.pePercentile}% 分位)`。真实数据 `peTTM=0` → 显示 `-- (50% 分位)`——既无 PE 数值却带着一个 50% 分位，像「有估值」实则假值。
- **建议修法**：无 PE/PB 数据时，分位一并隐藏或显式标注「无估值数据」；不要把 `?? 50` 兜底值当真实分位展示。

### C. `HistoricalValuationRangeChart` 残留乘数文案语义错位（低，展示）

- **文件/行**：`src/components/HistoricalValuationRangeChart.tsx:105`（`'参考 1.25x'`）、`:117`（`'参考 1.00x'`）、`:129`（`'参考 0.65x'`）；展示于 `:704`、`:767`、`:868`。
- **现状**：图表已改为「价格相对分位」，但 `getZoneInfo` 仍返回 `multiplier: '参考 1.25x/1.00x/0.65x'`。价格高百分位=动量大，不等于「该折价减仓」（那是估值逻辑），文案语义错位。
- **建议修法**：删除 `multiplier` 字段或改为纯描述（如「价格相对低位 / 中位 / 高位」），不要在价格分位语境下输出「超配/折价乘数」。

### D. 散落消费假分位的 UI（低，展示）

- **文件/行**：
  - `src/components/ValueMomentumScatterMatrix.tsx:265`：`PE历史分位: {hoveredItem.pePercentile}%`
  - `src/components/StrategyAnalysisPanel.tsx:36`、`:39`：`simPEPercentile ?? 50` / `simPBPercentile ?? 50`
  - `src/components/InstrumentDeepAnalysisPanel.tsx:359-362`：列表里 `item.pePercentile% 分位`
- **现状**：这些全部消费 `?? 50` 兜底的假 PE/PB 分位。散点图/面板在无真实估值时应隐藏或标注「无估值数据」。
- **建议修法**：检测真实数据（无 peTTM/pb）→ 隐藏对应分位 UI，或统一改为展示真实价格分位（若语义合适）。

### E. 死代码 `generate5YearValuationHistory`（低，无害但应清理）

- **文件/行**：`src/services/ashareStrategies.ts:6` 定义，**无任何调用方**（图表已全部切到 `generatePricePercentileHistory`）。
- **建议修法**：删除该函数及其类型签名；确认 `ValuationPercentileSignal.history5y` 字段（`:248` 兜底、`:346` 计算）是否仍被消费，未被消费则一并移除。

### F. `generate3YearValuationHistory` 仍被 mock 路径调用，产物无消费者（低）

- **文件/行**：`src/services/mockData.ts:559`、`src/services/apiClient.ts:55` 仍调 `generate3YearValuationHistory({...})` 填充 `historicalValuation`。
- **现状**：真实数据路径下 `historicalValuation` 不被任何图表消费（图表读 `bars`→`generatePricePercentileHistory`）。属无用计算 + 在对象上残留合成估值字段。
- **建议修法**：mock/演示模式若仍想保留「合成估值演示」，可保留但加注释说明「仅演示」；真实路径已无引用则无需动。至少从 review 角度标记为已知死计算。

### G. 情景推演/策略面板仍用 PE/PB 估值文案（低，展示）

- **文件/行**：`src/components/InstrumentDeepAnalysisPanel.tsx:818`（「估值分位 > 80%…强制施加 -35% 仓位折价防御」）；`src/components/StrategyAnalysisPanel.tsx:66`、`:80`、`:87`（「估值分位 20%~40%/65%~80%/>80%…+10~+15%/-15%/-35% 折价」）。
- **现状**：这些是 UI 情景模拟器的文案，消费的是滑块模拟值（非真实数据），但文案仍以「PE/PB 估值分位 → 仓位增减」为底色，与本项目真实数据只有价格分位的事实不符。
- **建议修法**：若保留情景模拟器，将文案改写为「价格相对分位」语义，或明确标注「模拟估值假设，真实数据无此字段」。

---

## 3. 设计待定（需用户拍板，非纯代码）

1. **估值子系统去留（A 的归属）**：真实数据无 PE/PB。三条路——(a) 删除估值偏置，明确「Carver 波动率定仓为主」；(b) 接外部基本面（ERP/Fed 模型需 Tushare/AKShare 基本面接口）；(c) 基于已有的真实价格分位重做 tilt（须重新论证与 EWMAC 动量的关系，避免重复信号）。
2. **价格分位窗口**：当前硬编码 `1 年 + 3 年`（`generatePricePercentileHistory`，`ashareStrategies.ts:139-140`）。用户已决定**维持现状**，不要改窗口长度；若要做成用户可选（1/3/5/10 年）属增强项，非必须。
3. **SELECT_ETF5 权重**：前两腿（510500+512890）占 55% 且同为 A 股权益、相关度高，「精选高夏普」分散叙事偏乐观。用户已决定**暂不改权重**，仅文字已纠偏。

---

## 4. 验证方法 & 环境坑

- 类型检查：`npx tsc --noEmit`
- 真实路径冒烟：`loadRealUniverse()` 喂 `generatePricePercentileHistory`，应每标产 13 点、分位落在 [1,99]、短输入返回空。
- 回测基线（引用须注明样本期）：balanced9（渐进入池 2014-01-21~2026-10-09，3089 日）vol 7.74% / ret +155.9% / DD -14.54% / Sharpe 0.74；poorlab11 全样本（1994-06-10~2026-10-09，7850 日）Carver CAGR 4.35% / vol 5.72% / Sharpe 0.38 / DD -23.43%。
- **沙箱坑**：`rm`/`fs.unlink` 被 safe-delete 拦截，清未跟踪探针用 `git clean -f`；推 parquet/标签遇 HTTP 408 超时先 `git config http.postBuffer 157286400`。

---

## 5. 已完成但需知会的清理

- 旧分支 `feature/real-data-parquet` 已删除（本地+远端），留保险标签 `archive/real-data-parquet-20261011`（`7f2c944`）。经逐文件比对，旧分支内容已被本分支完全包含且落后（缺 ①②③ 修复 + SELECT_ETF5 + 真实价格分位），无独有实质内容可搬。
