# Tribunal — feature/main-fundamental-v2 — 2026-11-18

> Hater → judge → verdict。Mode: **CODE**。对象:分支 diff @ merge-base `9058b76`(含工作区未提交改动与未跟踪脚本),HEAD `1968a70`。
> **main 已分叉且领先 2 个提交(`ddfe88f`、`7abab55`),属主分支侧代码,按用户要求未纳入审查**;审查基准因此取 merge-base 而非 main tip。
> Hater 拆分:按用户要求开 2 个领域 hater(计算原理 / 数据与框架),未按文件拆分。Judge 阶段 2 个法官并行逐条核证(含只读实测复现)。
> Files: ~45 个代码文件 + 2 个未跟踪脚本。Accusations: **15**。Confirmed weak: **15**(1 critical / 7 major / 7 minor)。
> 注:15 条全部确认,其中 7 条是法官先驳回了 hater 的过头措辞(`defensible:true`)再承认实质弱点(`agree_weak:true`)——**读严重度,别读总数**;严重度已按法官核证结果校准。

## ⚖️ Verdict — genuinely weak spots

**总评:计算链的路由与数据管线在结构上是认真的(闸门、fail-closed、备份、dry-run 默认),但分支自己标榜的两大主题——「口径必须一致」与「绝不假装成功」——各有一条最关键的口子没关上。** 系统性模式五类:

1. **口径混用贯穿信号链(hfq ↔ 市价)** — 分支把 EWMAC 分母、ATR、净值曲线的口径全改齐了,却把趋势门槛 `currentPrice >= ma250` 留成市价对 hfq 的跨口径比较(实测已复现,部署态全股票腿被系统性打 0.4x 熊市折价)。这是全案最贵的一条。
2. **合成/假数据兜底未清零** — 风险贡献图的净值曲线兜底到 251 根合成序列、数据适配台把合法 `barsCount:0` 折叠成 undefined 后回退显示「251 根」。展示路径违背仓库自己的数据诚信标准。
3. **共享可变状态三把不相交的锁 + 跨组合脏读** — instrumentsStore 的三条写路径锁互不相认;切组合那一帧用旧组合的 IDM/ρ 给新组合定仓;同步闸门用「任意一只最新」冒充「全体最新」且把失败包装成「无新增」。
4. **内存快照整文件覆写 parquet = 外部修复的回滚器** — syncOne 不重读盘上数据,repair 脚本(已写盘 ×1.0421/×1.2595 段)在服务器存活下会被下一次同步静默冲掉;「不动任何历史 bar」的头注释没有任何代码强制。
5. **验证脚本名不副实** — 恒真退出码、读不存在的字段、无断言的手抄副本、死分支冒充能力。

- **[critical] src/services/ashareStrategies.ts:239 (evaluateAShareStrategies)** — `absoluteMomentumPass = trendBarsUnavailable ? true : currentPrice >= ma250`:currentPrice 是市价口径(server.ts finalizeCatalog 第 5 步覆盖为 vwapPrice),ma250 是 hfq 后复权收盘均线;后复权因子只增不减,对有分红历史的股票几乎恒假。法官实测精确复现:农业银行 hfq 17.13 > hfq-MA250 15.69(真实上升趋势)判 false,finalScalar 6.5→2.6(0.4x);中国石油 5.1→2.1;511010 市价口径下也翻 false(0.6→0.2)。该 false 经 attachSignals 下发,carverEngine MA250 惩罚无条件消费(ERP gate 需 useERPTilt 开启,是条件消费)。同函数 L213-222 刚为 EWMAC 分母修过一模一样的口径错位,注释自认其害——明知故漏。
  _Fix:_ 同口径比较:`const lastHfqClose = closes[closes.length - 1]; absoluteMomentumPass = trendBarsUnavailable ? true : lastHfqClose >= ma250;`(照抄 computeEWMAC 的 priceRef 做法)。

- **[major] src/components/CarverPositionSizer / App.tsx:153-183 ↔ carverEngine.ts:283-296** — `PortfolioCorrelationOverride` 与 universe 无身份绑定(只有 {idm, avgCorrelation, legCount},overrideUsable 只查 legCount>1/isFinite);App 里 activeUniverse 变化同一帧,useMemo 即用上一个组合的旧 corrInputs 给新组合定仓(目标股数、carverIDM、缓冲带告警全是别的组合的相关性结构),还会随「导入主页面」流出。9 腿的 override 可合法给 5 腿用。
  _Fix:_ override 增加 `codes: string[]` 并在引擎内校验与 universe 码集合一致,不一致 fail-loud 退化为 IDM=1;activeUniverse 变化时同步 `setCorrInputs(null)`。

- **[major] src/components/PortfolioRiskContributionChart.tsx:163-167** — `barsOf = barsMap.get(code) || p.instrument.bars || []` 兜底到 hydrateInstrument 的 251 根合成 oscillator 序列,validPositions 无 syntheticBars 检查;且服务端 stripBars 后浏览器 universe 的 instrument.bars 恒为合成序列——不是「首帧」,是每腿 fetch 成功前一直用假价格画「近 60 交易日净值」,catch 静默吞失败则永久。correlationEngine/BacktestSandbox/ashareStrategies 都挡了,唯独这条展示曲线裸奔。
  _Fix:_ 过滤加 `!p.instrument.syntheticBars`;数据未到齐时渲染与 BacktestSandbox 同款「正在加载真实 K 线」状态。

- **[major] src/services/ashareStrategies.ts:151-153 (computeEWMAC)** — `if (!(atrRatio >= 0.002 && atrRatio <= 0.25)) atr = priceRef * 0.02` 把合法低波当腐败:511010 国债 ETF ATR/price=0.06%(正常物理量级)被分母放大 ~33x,标量 0.6 vs 真实 ~20,经 bond_etf multiplier 传导配仓 ~2.0x→~1.03x,界面显示 0.6(看似中性)与真实强趋势严重背离。法官核实 guard 对 L222 的 dailyATR 回退路径仍有残余防护价值(非纯死伤),但 0.2% 下限未按资产类别校准是真弱点。
  _Fix:_ 按资产类别/年化波动换算设下限(如 `priceRef * (annualizedVol/√250) * 0.2`),上限保留抓腐败;绝不用「发明一个 2% ATR」修数据。

- **[major] src/services/dailyBarSync.ts:118-124, 327-340, 385** — 闸门取全池末根日期**最大值**判定整轮 skip:实测 510500/588000 parquet 末根 2026-11-13(滞后),而 511010=11-17 → 今天点全局按钮必 skip 且 reason 写「本地已是最新」;失败腿当天无法经全局按钮重试(单只重试路径 POST codes 不受拦,法官修正)。且 `updated===0` 即记 30s 冷却——全轮网络失败也被盖「刚刚检查过且无新增日线」,失败包装成无新增;skipped 文案是 info「K 线未改动」。
  _Fix:_ 按标的判定 stale 只同步 stale;冷却仅在 `updated===0 && failed===0` 时记;skipped reason 如实给出 min/max 覆盖范围。

- **[major] server.ts:379-435 + 199-217(三把不相交的锁)** — singleFlight 的 key 含 codes/模式,GET、POST 指定 codes、snapshot 是三个 key 真并发;instrumentsStore 赋值点(204/416/430/459/724)无共享互斥,stagingData 的 withStagingLock 与 dailyBarSync 的 serialize 互不相认。promote 与 sync-latest 的 finalizeCatalog 窗口重叠时可丢更新(新晋标的从活目录消失)——法官修正:损害是**会话级**(promote 不写 store.json,重启从 registry 重载即恢复),窗口比 hater 所称窄,但「共享可变 store 三把锁+赋值裸奔」的结构弱点属实。
  _Fix:_ 所有写 instrumentsStore/store.json 的路径收敛到一把共享 async mutex,临界区内完成 load→finalize→赋值→落盘;或按 registry.updatedAt 做版本 CAS。

- **[major] src/services/dailyBarSync.ts:203-215, 262-267 ↔ realData.ts:137** — syncOne 用「内存 inst.bars + appended」整文件覆写 parquet,existing 段不重读盘上数据。① realData 每次加载跑 scanAndRescaleBreaks(>12% 跳变按 VWAP 判据改写 OHLC)只改内存——一旦某标的命中 rescale 分支,下一次同步把启发式改写永久写穿 parquet,头注释「不动任何历史 bar」无代码强制(法官实测:510500 2022-08-29 -12.7%、588000 2024-09-30 +19.9% 当前判 vwap_aligned warn-only,全池 rescaled_events=0,**待触发而非进行中**;护栏本身极重,「重标定后写穿=传播修复」的立场也可成立)。② 它是外部修复的回滚器:repair_hfq_breaks 已写盘(实测备份确认 511010 2026-09-28 起 ×1.0421、601318 2026-10-23 起 ×1.2595),服务器存活时下一次 syncOne 会把修复静默冲掉。
  _Fix:_ syncOne 落盘前重读盘上 parquet 校验末根日期/收盘一致性,不一致拒绝并提示重载;existing 段一律取盘上数据;repair 脚本探测 3000 端口拒绝在服务运行时 --apply。

- **[major] scripts/repair_hfq_breaks.ts:64-71(未跟踪 ops 脚本)** — 末根对齐 `while (bars[bars.length-1].tradeDate > tcLast) bars.pop()` 无条件删数据:无阈值、无删根数上限、无跨标的一致性佐证,与同脚本「判污染需 ≥3 只一致」完全不对称。法官核实的减轻情节:已实战一次且行为符合意图(601318 实际只删 1 根未定稿 bar);结构性下界——本地尾部超出腾讯的 bar 只能来自腾讯锚定 append,大规模误删需腾讯对单 code 历史序列本身滞后。弱在腾讯对 ETF/债类更新滞后是已知现象,--apply 会静默截断真实尾部,只剩人工评审一道防线。
  _Fix:_ 删除过闸门(限污染窗口内/根数≤2 且有跨标的一致性佐证),或加 `--drop-tail` 显式开关拆开「修收益率」与「删 K 线」两个语义。

- **[minor] scripts/repair_hfq_breaks.ts:24-25, 98, 107-118** — DIFF_PT=2pp + MIN_CODES=3:分红除权扎堆日 ≥3 只标的两口径收益差 >2pp 即判「同步污染日」,把所有偏离标的整段 ×k 切到腾讯复权基准(一条序列两种复权口径);头注释自认历史除权日本就差 2~8%。目标窗口(10-11 月)避开分红季,但复用到 6-8 月必然误伤。现成的零成本第二证据没用上:data/backup/parquet/<date> 写盘日记录(实测存在 12 个日期目录)。
  _Fix:_ 污染日加第二证据(日期出现在备份目录 = 当天真发生过写盘,或偏离方向一致性)。

- **[minor] scripts/test_bar_sync_gate.ts:32-58 ↔ dailyBarSync.ts:69, 247-267** — 测试 fixture 用真实在池标的 '510300.SH',PARQUET_DIR 硬编码无注入点,测试与生产数据共享写入路径。今天安全靠构造(fail-closed 护栏在备份/写盘之前,法官修正:用例 3 实际命中的是 stitch 无重叠锚护栏而非 MAX_GAP_DAYS,'2000-01-03' 是刻意选的),但 fixture 日期改成近期任一交易日就会真实覆写 510300 底座(读回校验只验行数/末根,拦不住内容假)。
  _Fix:_ PARQUET_DIR/BACKUP_DIR 提供环境变量覆盖,测试指向临时目录;或 fixture 用 '999999'(在 existsSync 处天然 fail-safe)。

- **[minor] src/services/apiClient.ts:122 ↔ DataAdapterConsole.tsx:424** — `Number(raw?.barsCount ?? ...) || undefined` 把服务端合法下发的 `barsCount: 0`(无 parquet/fallback 标的)折叠成 undefined,UI 回退显示合成 bars 的「251 根」,与 dataSource 徽标 fallback 同屏自相矛盾——正是本 diff 在 types/ashare.ts:51-52 宣称要消灭的场景。0 是信息,undefined 是缺信息。
  _Fix:_ 保留 0;UI 对 0 显示「0 根/无数据」。

- **[minor] scripts/test_atr_scale_isolation.ts:36-38** — 退出码只看 failIso,badATR/extreme 只打印不阻断;实测「ATR 越界: 1」照样 ✅ + exit 0。法官:与脚本命名主题一致,且 atrOk 界 [0.2,25] 会把 511010 的合法 0.06% 永远判越界——真 gate 会永久红灯(与 computeEWMAC floor 之争同源)。但文件头声称「ATR 合理性 + 标量异常扫描」,三计数器两个不参与判定,验证承诺大于执行。
  _Fix:_ 退出码覆盖全部计数,越界>0 打 ❌;或先把 ATR 合理界按资产类别校准再 gate。

- **[minor] scripts/check_engine_full.ts:39, 44-45** — 对账脚本读不存在的字段(idmMultiplier/dailyTotalCashVol/dailyCashVol/bufferStatus,实际是 carverIDM/dailyExpectedRisk/withinBuffer),IDM 行打 undefined、buffer 列恒 '?'。法官:scalar/targetShares 等主对账列字段全对,TOPKEYS 也打印真实字段名——「对账了个寂寞」言过其实,但两个最关键的数字确实失能。
  _Fix:_ 按真实字段名读。

- **[minor] scripts/verify_nav_curve_fix.ts:全文件** — 无断言、数据不一致时恒 exit 0(法官修正:fetch 失败仍会非零退出),硬编码 tooltip 值(0.9515/0.8813)靠人眼比对;且是 PortfolioRiskContributionChart 净值算法的第三份逐行手抄,违背 test_risk_parity.ts:2 刚立的「不再复刻副本」原则。
  _Fix:_ 从 /api 实时拉界面数字 + 真断言 + 非零退出码;算法抽成可 import 纯函数共用。

- **[minor] scripts/check_nav_synthetic.ts:55** — 判「合成 vs 真实口径」的唯一工具(useSynthetic 对照分支)全部调用点硬编码 false,死代码,声称的口径甄别从未被执行。法官:作者实际用另一条路径(截图值对应调仓前持仓)回答了核心问题,死分支是交互调试残留,危害低,但名实不符。
  _Fix:_ 两种口径并排跑;或删掉死分支与 mockData import。

## 📜 Full transcript (hate + defense per group)

### Group A — 计算原理 (hater: agent_0e57620f / judge: agent_8f6cfd49)

- **[critical] ashareStrategies.ts:239 (c1)**
  - 🔥 Hater:市价 currentPrice 对 hfq ma250 跨口径,后复权因子只增不减 → 恒假;实测农行 6.5→2.6、中石油 5.1→2.1,池内 hfq/市价因子 1.85~95.36;经 attachSignals/carverEngine 0.4x 惩罚双重消费,部署态全股票腿趋势标量被打成熊市折价。
  - 💡 Should have been:用 bars 最后一根 hfq 收盘对 hfq MA250(照抄 computeEWMAC priceRef 做法)。
  - ⚖️ Judge(❌ not defended, agree_weak:true):逐数字复现一致(17.13/15.69、6.5→2.6、5.1→2.1 全对);server.ts L634-666、stripBars L43-52、前端 early-return、carverEngine L159-170 消费链两头核实;同函数 L213-222 刚修过同款口径错位,属明知疏忽。唯一修正:ERP gate 消费是条件性的,0.4x 惩罚无条件发生。511010 市价口径也翻 false(0.6→0.2),债券腿同样吃折价。
- **[major] ashareStrategies.ts:151-153 (c2)**
  - 🔥 Hater:0.2%~25% 当普适常数,511010 ATR/price=0.06% 分母放大 33x,标量 0.6 vs 真实 ~20,配仓 ~2.0x→~1.0x;要防的事故已被 hfqATR 同口径结构性修掉,只剩伤害。
  - 💡 Should have been:按资产类别/年化波动换算下限,上限保留抓腐败。
  - ⚖️ Judge(✅ defended, agree_weak:true):guard 是本分支新增、注释文档化的刻意取舍(2026-10-15 事故动机),复现一致;L222 dailyATR 回退路径下 guard 仍有残余防护价值——「只剩伤害」过头。但 0.2% 对国债 ETF 是把合法量级当腐败,33x 压缩与界面显示背离是真弱点。
- **[major] carverEngine.ts:283-296 ↔ App.tsx:153-183 (c3)**
  - 🔥 Hater:override 与 universe 无绑定,activeUniverse 变化同帧用旧组合 corrInputs 给新组合定仓,9 腿 override 给 5 腿用,随导入主页流出。
  - 💡 Should have been:override 加 codes 绑定校验 + activeUniverse 变化时 setCorrInputs(null)。
  - ⚖️ Judge(❌ not defended, agree_weak:true):两头契约核实;useEffect 只在 <2 腿/fetch 失败时清空,变化那一帧不清;legCount 只做下限,instruments=new Array(legCount) 使 corrUsable 恒真。唯一辩护:ensureRealBars 有缓存,切回看过的组合窗口≈1 帧,但首次切换是真实网络窗口,且无任何注释表明是已知取舍——与该分支其他地方的契约钉死风格反差鲜明,属疏漏。
- **[major] PortfolioRiskContributionChart.tsx:163-167 (c4)**
  - 🔥 Hater:|| 兜底合成 251 根序列,无 syntheticBars 检查;首帧必假、fetch 失败永久假;同分支其他路径都挡了,唯独展示曲线裸奔。
  - 💡 Should have been:过滤加 !syntheticBars,数据未到齐显示加载态。
  - ⚖️ Judge(✅ defended, agree_weak:true):有可辩护定位(纯展示、不回灌定仓/回测,给演示/模板腿提供「有得看」降级);但实际比指控更重——stripBars 后浏览器 universe 的 instrument.bars 恒为合成序列,兜底是「每腿 fetch 成功前一直假」。在「绝不假装成功」的代码库里画无标注的假净值,违背自己的数据诚信标准。
- **[minor] test_atr_scale_isolation.ts:36-38 (c5)**
  - 🔥 Hater:退出码只看 failIso,「ATR 越界: 1」照样 ✅ exit 0,三统计量两个是装饰品。
  - 💡 Should have been:退出码覆盖全部计数。
  - ⚖️ Judge(✅ defended, agree_weak:true):实测复现(越界的正是 511010 合法 0.06%);与命名主题一致、真 gate 会因合法值永久红灯是现实原因;但头重脚轻、承诺大于执行属实。
- **[minor] check_engine_full.ts:39,44-45 (c6)**
  - 🔥 Hater:读不存在字段,IDM: undefined、buffer 列恒 ?,对账了个寂寞。
  - 💡 Should have been:按 carverIDM/dailyExpectedRisk/withinBuffer 读。
  - ⚖️ Judge(✅ defended, agree_weak:true):字段名指控属实;但主对账列(scalar/targetShares/…)全对、TOPKEYS 打印真实字段名——「寂寞」言过其实,minor 相称。
- **[minor] verify_nav_curve_fix.ts (c7)**
  - 🔥 Hater:无断言、恒 exit 0、硬编码 tooltip 值、第三份手抄副本,违背 test_risk_parity 刚立的原则。
  - 💡 Should have been:/api 实时拉数 + 真断言 + 纯函数共用。
  - ⚖️ Judge(✅ defended, agree_weak:true):「没有非零退出码」略过头(fetch 失败会非零),准确说法是数据不一致时恒 exit 0;其自我定位是事故对账助手,硬编码供人眼比对符合定位;但第三份拷贝按仓库自己标准是已知脚枪,弱成立。
- **[minor] check_nav_synthetic.ts:55 (c8)**
  - 🔥 Hater:口径甄别的唯一工具硬编码 false,死分支,声称的能力从未被执行。
  - 💡 Should have been:两种口径并排跑或删死分支。
  - ⚖️ Judge(✅ defended, agree_weak:true):死分支属实;作者实际用另一条路径回答了核心问题,属交互调试残留,危害低,但名实不符。

### Group B — 数据与框架 (hater: agent_3359e2a9 / judge: agent_a9962e62)

- **[major] dailyBarSync.ts:118-124,327-340,385 (c1)**
  - 🔥 Hater:全池 max 冒充全体状态;失败腿当天无法重试;updated===0 无条件冷却把失败包装成「无新增」;skipped 文案说谎。
  - 💡 Should have been:按标的判定 stale;冷却仅 updated===0 && failed===0;reason 给 min/max 覆盖。
  - ⚖️ Judge(✅ defended, agree_weak:true):全部核实,且是活的——实测 510500/588000 末根 11-13,今天点必 skip 谎称最新,滞后 2 个交易日。「永远无法重试」夸大:单只重试路径先按 codes 过滤再算 localMax,不受拦;失败首轮有 error toast,次日 gate 前移自然重试。但 max 判据 + 无条件冷却 + 文案三点无法辩护。
- **[major] server.ts:379-435 + 199-217 (c2)**
  - 🔥 Hater:key 三分真并发;三路径无条件覆盖共享 store;promote/sync 交错丢新晋标的并固化进 store.json;三把不相交的锁等于没锁。
  - 💡 Should have been:共享 async mutex 或版本 CAS。
  - ⚖️ Judge(✅ defended, agree_weak:true):结构核实(key 三分、赋值点无共享互斥、两锁互不相认、loadRealUniverse 数秒窗口)。「三路径都无条件覆盖」偏宽:430 行 map 有 codeMap 保底,真丢更新只在 416 与 promote 窗口重叠时;「固化进 store.json」不成立(promote 不写 store.json,重启从 registry 重载即恢复,损害会话级);前端无轮询。共享可变 store 三把锁+赋值裸奔的结构弱点属实。
- **[major] dailyBarSync.ts:203-215,262-267 ↔ realData.ts:137 (c3)**
  - 🔥 Hater:内存快照整文件覆写;scanAndRescaleBreaks 内存改写会被写穿;「不动历史 bar」注释无代码强制;是外部修复的回滚器(511010 ×1.0421、601318 ×1.2595 已写盘)。
  - 💡 Should have been:落盘前重读盘上 parquet 校验;repair 脚本探测端口拒绝运行时 --apply。
  - ⚖️ Judge(✅ defended, agree_weak:true):机制两头核实;实测 -12.7%/+19.9% 判 vwap_aligned 一字不差,但全池 rescaled_events=0——写穿是「待触发」而非「进行中」;rescale 护栏极重(fail-closed),「写穿=传播修复」的立场可成立。弱在:同一份盘上历史存在两个口径不一致的修复者,syncOne 不校验盘上末根,头注释契约被打破。
- **[major] repair_hfq_breaks.ts:64-71 (c4)**
  - 🔥 Hater:无条件删末根,无阈值/无上限/无一致性佐证,与判污染的谨慎完全不对称;--apply 会静默砍真实尾部。
  - 💡 Should have been:删除过闸门或 --drop-tail 显式开关。
  - ⚖️ Judge(✅ defended, agree_weak:true):范围说明——脚本未入 merge-base diff,是工作区 ops 脚本。指控事实属实;已实战一次行为符合意图(601318 只删 1 根);结构性下界使大规模误删需腾讯历史序列本身滞后。弱在腾讯对单 code 滞后时只剩人工评审一道防线。
- **[minor] repair_hfq_breaks.ts:24-25,98,107-118 (c5)**
  - 🔥 Hater:DIFF_PT=2+MIN_CODES=3 在分红扎堆日必误伤,整段切腾讯复权基准造成一条序列两种口径;备份目录这个现成第二证据没用。
  - 💡 Should have been:污染日加第二证据(备份目录记录/偏离方向一致)。
  - ⚖️ Judge(✅ defended, agree_weak:true):核实属实(备份目录实测 12 个日期);dry-run 默认+窗口+复验+人工评审压小半径,目标窗口避开分红季;复用到 6-8 月必然误伤,第二证据零成本未做,弱成立。
- **[minor] test_bar_sync_gate.ts:32-58 ↔ dailyBarSync.ts:69,247-267 (c6)**
  - 🔥 Hater:fixture 用真实在池标的,无目录隔离,日期一改就真实覆写生产底座,在用户数据目录上练枪。
  - 💡 Should have been:环境变量覆盖 PARQUET_DIR/BACKUP_DIR 或 fixture 用 '999999'。
  - ⚖️ Judge(✅ defended, agree_weak:true):今天安全是构造性的(fail-closed 护栏在写盘之前;用例 3 实际命中的是无重叠锚护栏,'2000-01-03' 是刻意选的)——hater 的 MAX_GAP_DAYS 机制描述略偏但同为 fail-closed;用例 3 今天还打真实腾讯网络。测试安全依赖巧合而非隔离,真弱点。
- **[minor] apiClient.ts:122 ↔ DataAdapterConsole.tsx:424 (c7)**
  - 🔥 Hater:`|| undefined` 把合法 0 洗成 undefined,UI 回退显示合成「251 根」,与徽标同屏自相矛盾;0 是信息,undefined 是缺信息。
  - 💡 Should have been:保留 0,UI 显示「0 根/无数据」。
  - ⚖️ Judge(❌ not defended, agree_weak:true):全部核实、无打偏(251 根精确:days=250 循环含端点);types/ashare.ts:51-52 本 diff 自己立的契约正被 UI 行为违背;唯一可辩的「徽标已可区分」不足。

---
*方法说明:2 个领域 hater(计算原理/数据与框架)+ 2 个法官,全部经 Agent 工具并行执行;法官做了只读实测复现(数值逐位对账、parquet/备份目录抽查),未执行任何写操作。main 侧 2 个提交(ddfe88f、7abab55)按用户指令未审查;合并前注意 main 的「unify IDM correlation window」与本分支 IDM/口径改动的重叠。*
