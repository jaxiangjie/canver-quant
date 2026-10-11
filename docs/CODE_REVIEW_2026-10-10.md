# 代码审查报告（2026-10-10）

分支：`feature/real-data-parquet`
审查范围：commit `d5b27ed`（真实 parquet 数据 + walk-forward 回测 + 文件持久化）、`086dd35`（enforceTargetVol + 恒科入池 + IDM 显示）

审查方式：两个子代理并行——A 审「回测/定仓引擎正确性」，B 审「数据加载/持久化/服务端/前端接入」。

---

## 一、回测与定仓引擎（子代理 A）

### P0 阻断

**A1. 缓冲带在回测中完全失效 — `backtestEngine.ts:263-265`**
`targetCarver.set(code, p.targetShares)` 取的是**未过缓冲带**的原始目标；`applyTrades`(281-303) 也不读 `withinBuffer`。Carver 12% 死区（`carverEngine.ts:257-261`）只影响 `recommendedShares`，回测从未使用。
→ 净值曲线不代表引擎真实行为，换手与成本被系统性放大，与 UI「建议执行股数」不一致。
修：`targetShares` / `recommendedShares` 二选一并显式传入（建议 `withinBuffer ? 0 : target`，保持 `targetShares` 语义）。

**A2. 全球同步激活，样本被最新标的截断 + 幸存者偏差 — `backtestEngine.ts:185-200`**
`startIdx = Math.max(...activeFrom)` 要求**所有**标的都攒够 252 根才开跑。513180（恒生科技，2021-05 上市）把回测起点拖到 ~2022 中，510300 自 2012 起的历史全部丢弃；且用「今天的 9 只名单」回测历史本身即选择偏差。
修：改为逐标的渐进入池（`i >= activeFrom[k]` 才进 snapshot，等权分母用当期激活数），或显式暴露实际起止区间。

### P1 重要

**A3. 相关性未按交易日对齐 — `correlationEngine.ts:177`**
`calculatePearsonCorrelation` 用 `Math.min(x.length, y.length)` 按下标配对。任一标的停牌/缺日，两条收益序列即错位，IDM 失真（极端可得 ρ<0）。
修：先按 `tradeDate` 取交集再算。

**A4. ADV 单位错误，冲击成本恒为 45bps — `realData.ts:139` + `backtestEngine.ts:242`**
`turnover` 是 `volume × close / 100` 的合成值（parquet 里已有 `amount` 却没用），再 `.toFixed(0)` 量纲到万元 → 早期低流动性样本直接为 0 → `participation = 1` → 恒定 45bps 冲击。整个「流动性保护」结论建立在这个错数上。
修：直接用 `amount`，去掉万元取整。

**A5. 同 bar 决策 + 成交（轻微前视）— `backtestEngine.ts:228-263`**
当日收盘价既用于算 EWMAC/波动/目标仓位，又作为成交价。实盘不可得。
修：信号用 t 日，成交用 t+1 开盘（或标注为乐观偏差）。

**A6. Sortino 公式错误 — `backtestEngine.ts:107-108,112`**
下行标准差用「取负收益后求 std」，分母是 `N_neg` 且减了负收益均值。等幅下跌时 `downStd = 0` → sortino = 0，完全失真。
修：标准半方差 `sqrt(Σ min(r,0)² / N)`。

**A7. 受保护分支是「纸面保护」— `backtestEngine.ts:136-144,307-329`**
protected/unprotected 都一次性全量成交，只是定价不同；真实的「T+1 多日拆单」未模拟，也不限制当日实际成交量。`savedCum` 因此高估保护收益。
修：按 `advCapRatio` 真实拆单到多日，或明确降格为「成本假设对比」。

### P2 建议
- `carverEngine.ts:104-105`：债券 `enforceTargetVol=false` 时 `(scalar+10)/10` 无上限（scalar=20 → 3.0x），缺 `Math.min(2.0)`。
- `carverEngine.ts:210 vs 213`：manual fallback `maxIDM||2.20`、auto `||1.80`，默认值不一致。
- `backtestEngine.ts:207-210`：无现金下限校验、无融资利息（20% 杠杆是免费的）。
- `backtestEngine.ts:198`：找不到 510300 时回退 `safeUniverse[0]`，会把任意标的冒充「沪深300」。
- `backtestEngine.ts:346-347`：`Math.max(...points.map())` 每日全表扫描，O(n²)。
- `buildSnapshot` 置空 PE/PB → ERP 战术偏置（`carverEngine.ts:88-94`）在回测中静默失效，UI 却不体现。

### 已核查正确（A）
前视偏差主体（union 轴 two-pointer `prefixLen`、`buildSnapshot` trailing 120 日波动 / 20 日 ATR、EWMAC 走全前缀、`atr20`/`ma250` 逐根对齐）均无未来数据；`preHeldCarver` 快照正确，无漏计费/重复计费；月度触发正确；佣金/印花税/整手取整/现金结算符号正确；CAGR / 年化波动 / 最大回撤 / Calmar 公式正确；杠杆封顶基于已过单标的 cap 的 rawTarget 缩放后再取整手，方向正确；`enforceTargetVol` 主分支 clamp(0,2) 语义符合声明；除零/NaN/空 universe 边界安全。

---

## 二、数据加载 / 持久化 / 服务端 / 前端（子代理 B）

### P0 阻断

**B1. 自选标的重启后 bars 丢失，被静默替换成随机合成数据**
`persistence.ts:41`（落盘 strip bars）+ `persistence.ts:83`（未命中整体追加）+ `apiClient.ts:26-28`（`bars.length < 20` 时调 `generateHistoricalBars`）。
用户通过 UI 新增的标的，重启后从 `store.json` 追加回来时无 `bars`，前端 hydrate 直接造出一段伪随机 K 线 —— 该标的的回测净值、相关性矩阵、ATR、波动率全部建立在合成数据上，且**界面无任何标识**。
修：落盘保留自定义标的 bars，或对无 bars 项打 `synthetic: true` 并在 UI 红色标注 + 从回测/相关性计算中排除。

### P1 重要

**B2. `mergeStores` 只增不减，删除无法持久化 — `persistence.ts:73-87`**
base 恒为 `INITIAL_INSTRUMENTS` 全量池，删除的标的重启后复活；用户改的 name/category/peTTM 等（非 `currentShares`/`riskBudgetWeight`）全部回滚。
修：落盘 `{ deletedCodes: [] }`，或改为「以 persisted 为准、base 仅补行情」。

**B3. 落盘非原子 — `persistence.ts:48`**
`writeFileSync` 直接覆盖，进程中断/磁盘满会留下半截 JSON，`loadPersistedStore` 静默 `return null`，全部持仓编辑无声丢失。
修：写 `store.json.tmp` 后 `fs.renameSync`（同目录 rename 原子）。

**B4. 降级链路谎报成功 — `realData.ts:76-80` + `server.ts:90-97`**
缺失/损坏文件回退模板，故 `real.length` 恒 > 0，即使 parquet 目录整个不存在也会打印 `loaded N instruments from parquet`。用户以为在看真实行情。
修：统计成功读取数，日志与 `/api/health` 暴露 `realCount / totalCount / dataSource`。

**B5. 年化波动用全样本而非 120 日窗口 — `realData.ts:92-95`**
`rets` 从 i=1 取到 n-1（可能十年全历史），与 120 日口径及 mock 不一致，老标的定仓严重偏离近期波动状态。
修：`rets.slice(-120)`。

**B6. 回测无防抖，滑块拖动触发连续全量计算 — `BacktestSandbox.tsx:78-91`**
`setTimeout(...,0)` 只错开一帧，不是 debounce；`cancelled` 只能拦未执行的 timer，进入 `runRealBacktest` 后无法中断。拖动 ADV 滑块每次 onChange 跑一遍全量 walk-forward，主线程掉帧。
修：150~300ms debounce，或移入 Web Worker。

**B7. SSRF — `server.ts:54-71`**
`/api/ashare/proxy` 允许客户端指定任意 `targetUrl` 由服务端 fetch，可探测内网。
修：域名白名单或移除该端点。

**B8. `effectiveAnnualVol` 口径误导 — `carverEngine.ts:300-301`**
`weightedVolSum × 0.85 × min(1.30, IDM×0.82)`，0.85/0.82 为无推导魔法数；真实组合波动应是 √(wᵀΣw)（已有相关性矩阵可直接算）。该值标为「有效年化波动」，与回测 Tab 的真实 `annVolPct` 相邻展示，数字对不上。且 `expectedAnnualReturn = 2.2 + 0.85×vol - 0.35` 是由波动反推收益的循环论证。
修：改用协方差矩阵实算，或在 UI 明确标为「估算值（非实测）」。

**B9. 文档过时 — `DocumentationCenter.tsx:95-96`**
「IDM 约 1.45~1.60」「年化 10~14%+」是硬编码示例，实际 IDM 由 60D 相关性求解并受 `maxIDM` 封顶，与该区间无对应关系。

### P2 建议
- `BacktestSandbox.tsx:79-90`：`try/finally` 无 `catch`，回测抛错将冒泡为未捕获异常，旧 `dataPoints` 残留。
- `realData.ts:142-153`：ma20/60/250 每根 bar 三次 `slice().map()`，O(n·k)，3000 根 × 10 标的约千万级运算，改滚动和。
- `realData.ts:43-46`：`normDate` 缺数字分支，若某文件 date 为 epoch 数值会产出 `"1234567890"` 字符串，与 `getTime()` 排序不一致。
- `CorrelationAnalysisMatrix.tsx:390` 显示未封顶理论 IDM，sizer:357 显示封顶生效值，两处差异无说明。
- `server.ts:36-45`：落盘失败返 500 但内存态已改；`DELETE /api/ashare/store` 只删文件不清内存态。

### 已核查正确（B）
日期排序用 `getTime()`（非字符串比较）✓；统一读 `_hfq` 后复权 ✓；ATR(20) 边界与 TR 定义正确 ✓；`unionDates` 用 `YYYY-MM-DD` 字典序排序等价时序 ✓；两处相关性窗口均为 60D ✓；hyparquet 用 `createReadStream` 无 fd 泄漏 ✓；三个预设 `maxLeverage` 均 ≤0.20 ✓；`STORE_PATH` 固定、无路径注入 ✓。

---

## 三、建议修复批次

**批次 1（结论正确性，直接影响回测数字可信度）**
A1 缓冲带失效 · A4 ADV 单位 → 冲击成本 · A6 Sortino · B5 年化波动窗口 · A3 相关性交易日对齐

**批次 2（数据可信度与持久化正确性）**
B1 自选标的合成数据标识 · B4 降级谎报成功 · B2 删除持久化 · B3 原子写

**批次 3（工程与安全）**
B7 SSRF · B6 防抖/Web Worker · B8 effectiveAnnualVol 口径 · B9 文档同步 · A2 渐进入池（也可提前，因影响样本期）
