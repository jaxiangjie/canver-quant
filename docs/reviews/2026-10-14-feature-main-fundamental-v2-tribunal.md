# Tribunal — feature/main-fundamental-v2 — 2026-10-14

> Hater → judge → verdict. Mode: CODE. Object: branch diff vs local `main` (0a35bd6), including uncommitted working-tree changes (data/ files + quick-backtest UI). Audited at HEAD 9058b76 + dirty tree.
> Files: 12. Accusations: 67. Confirmed weak: 67 (6 critical / 28 major / 33 minor).
> Note: judges mostly answered "defensible in form, but agree_weak" — that split is the design working as intended (a formally-OK choice that is honestly still weak stays in `confirmed`). Read severity, not the total. 6/6 critical accusations were additionally verified factually (epoch math, Tencent protocol, mutant runs) by the judges themselves.

## ⚖️ Verdict — genuinely weak spots

**Overall state**: the branch delivers working features (diagnostic panel, 3-tier data architecture, quick backtest), but the review exposes six systemic problem patterns. The most dangerous class is **silent data corruption** — the exact failure family that burned this repo on 2026-09-01. Two promoted instruments already on disk (562500, 512660) carry the date-epoch defect (V1). The Tencent pagination bug (V2) means every promoted instrument's "full history" is actually ~640 bars (~2.6 years).

### Named systemic problems

1. **Fail-open data pipeline (silent corruption family)** — V1, V2, V5, V6, S4: every data-path defect produces plausible-looking output instead of an error. A 8-hour date skew, a truncated history, a dead VWAP detector, a guard that now rescales legal limit-up days, and a Sentinel that reports HEALTHY without reading a single file. Fix pattern everywhere: fail loud, self-verify after write, never fabricate evidence in logs.
2. **Contract drift across modules** — V11, S1, V17, V21, V26, V31, S6: CASH semantics changed in the store but 4 consumer sites kept the old contract; break-detection constants exist in 3 hand-synced copies; pool membership has 3 vocabularies (id / full code / bare); hfq→market conversion has 2 stacking owners (ATR f², VWAP double meaning). Fix pattern: one shared module per concept; grep-all-consumers discipline on semantic changes.
3. **Tests guarding photocopies** — V3, V4, V8, V9, S2: test_risk_parity.ts replicates the production function (equal-weights mutant passes everything); test_break_detection's fixture is a mathematical identity (all four tuned constants untestable); sum assertions are tautologies; the guard-narrowing that activated a data-corrosion path got zero coverage. Fix pattern: import production, assert contracts not cosmetics, mutation-check.
4. **Non-atomic / uncoordinated concurrent writes** — V13, V14, V15, V16, V22, V25, S5: staging pair-writes, registry read-failure-erases-pool, promote racing auto-sync (last-arrival-wins), two overlapping full-replace POSTs, side effects inside setState updaters. Fix pattern: per-key serialization + atomic pairs + read-modify-write.
5. **Presentation over substance** — V7, V12, V19, V20, V24, V27, V30: "精确满仓" alert on ¥0, quick-backtest green panel with all-zero metrics, quickResult showing a previous portfolio's track record, IDM "理论值" label that the formula can't reproduce, fake Sentinel report. Fix pattern: gates before claims; staleness keys on results; labels must match math.
6. **Selective hardening** — V18, V23, V28, S7: SSRF whitelist added for /proxy while three disk-mutating routes got nothing; code validated in fetch path but not promote path; portfolios POST trusts the client wholesale while /ingest validates field-by-field. Fix pattern: validate at every trust boundary, same baseline everywhere.

### Confirmed findings (by severity)

**[critical]**
- **scripts/staging_to_parquet.py:23-25 (date epoch)** — writes East-8 midnight epoch-ms while the base pool stores UTC midnight; every promoted instrument's whole daily series renders one day early, silently. **Judges verified end-to-end: the on-disk promoted 562500 parquet already carries the skew (first bar renders 2024-02-19, true trade date 2024-02-20); 562500 and 512660 are both affected.** _Fix:_ UTC midnight + read-back self-assertion; re-promote both instruments after fixing.
- **src/services/stagingData.ts:89-137 (Tencent pagination cursor)** — backward cursor placed in the `start` slot of `param=code,day,start,,count,hfq`; page 2 returns the already-fetched window, the built-in circuit breaker fires immediately; any stock >640 bars silently gets ~640 bars (~2.6y) while comments claim full history; coverage/vol/backtest all run on truncated data. Judge: severity is if anything understated. _Fix:_ cursor in the 4th (end) slot; assert page 2 introduces strictly older dates or throw.
- **src/services/realData.ts:160-168 (break-detection guard)** — fallback branch fabricates "return ≈ 0" when the VWAP window is empty; with the guard narrowed to [0.95,1.05], every |r|>12% candidate's factor (1/(1+r)) mathematically always passes → missing-amount data now rescales legal moves (+20% limit-up → −16.7% cascade); the success log claims "VWAP 平稳" when no VWAP existed. _Fix:_ no-evidence-no-action (warn-only on empty windows); guard tied to observed |r|; add a missing-amount fixture asserting rescaled===0.
- **src/services/realData.ts:81-88,131-191 (synthetic amount kills the detector)** — promoted instruments carry amount≡volume×close → vwap≡close → drift≡0 → the detector validates its own input and always concludes "legal extreme move, not rescaled" with a misleading log; breaks enter the pool unfixed and pollute 120-day vol. _Fix:_ source-tag synthetic-amount data; skip VWAP discrimination loudly instead of faking assurance.
- **scripts/test_risk_parity.ts:7-40 (replica suite)** — the entire file is a hand copy of calculateRiskParityAllocation; mutant run (equal weights) passes all assertions; the sibling script proves importing production works. _Fix:_ import the real function; pin exact per-item amounts and proportionality.
- **src/App.tsx:319-377 (lazy without ErrorBoundary)** — 7 lazy panels, zero error boundaries in src; a chunk 404 white-screens the entire tree including Header. _Fix:_ ErrorBoundary with reload action at the Suspense boundary.

**[major]** (28 — grouped)
- *Data pipeline*: stagingData spawn without timeout/kill + discarded stderr + committed personal python path (V10); readPoolRegistry failure→[]→promote erases the whole registry (V13); fetch/promote interleaving deletes freshly fetched data (V14); detectAndFixBreaks provably dead for its only caller while docstring promises recovery (V15); hfqToMarketFactor intraday timestamp race frozen into registry (V16); quote tradeDate slice bug '2026100915' (V23).
- *Server*: promote's 2-line catalog refresh truncates initStore (loses user overrides, deletedCodes, fundamentals, VWAP price basis) and races auto-sync (V11); half-committed non-retryable promote failure (V12); zero concurrency control over non-atomic staging writes — approved report ≠ promoted data (V17... see V14); Data Sentinel theater — hardcoded 22/HEALTHY served by /api/health, opens no files, ERROR unreachable, exported from the entry module (V18).
- *Frontend*: persisted 'imported' bundle never re-validated → deleted legs silently under-allocate (V19); mount-merge effect POSTs inside a setState updater — the documented full-reload accident's un-guarded twin path (V20); quickResult keyed by slot only — stale metrics shown under a different portfolio (V21); runQuickPortfolioBacktest discards portfolio.totalCapital (42万 backtested as 100万) (V24); NaN/negative-vol holes in risk parity + `?? it.amount` laundering failure into "精确满仓" (V25); merge-by-updatedAt is lexicographic string compare; no timeouts, no validation, no tombstones (V26); isOfficial:false presets persisted with module-load timestamps that always beat the server — git versioning defeated for the two most-edited portfolios (V27); quick-backtest gates backwards — all-or-nothing entry, ok:true on 20-bar samples the engine can't use (V28).
- *Cross-module*: resolveUniverse silent drop + absolute weights (V19's engine half); ATR f² double-scaling into signals and displayed positions (V29); promote vs auto-sync vs sync-latest whole-array races, and the "press F5" advice that cannot work (V30); IDM label formula irreproducible + 60-day hardcode vs selectable window (V31); vite watch.ignored fixes a mechanism that cannot occur (data/ not in module graph — empirically reproduced) while silencing the diagnostic signal (V32).

**[minor]** (33) — see full transcript. Themes: locale-bound assertions, unfalsifiable checks, dead CASH branches and stale tooltips/docstrings, duplicated result strips, notes suffixes accumulating on repeat clicks, name-anchored globs, O(N²) scans, toFixed(4) without residual, missing argv/input validation at route boundaries, non-atomic tmp names, and per-leg serial fetches without cache.

## 📜 Full transcript (hate + verdict per group)

Legend: 🔥 hater gist · ⚖️ judge (✅ defended in form / ❌ not defended) + agree_weak. All 67 confirmed.

### scripts/staging_to_parquet.py
- **[critical] date epoch** — 🔥 East-8 vs UTC midnight, whole series one day early, silent. ⚖️ ❌ not defended — verified 14667 base rows all UTC midnight; on-disk 562500 already corrupted. agree_weak ✓
- **[minor] argv/exit codes** — 🔥 exit 1 conflates dep-missing with data-bad; caller retries interpreters on any nonzero with stderr discarded. ⚖️ ✅ defended in form (multi-candidate is a deliberate Windows fix) — but agree_weak ✓ (undiagnosable real failures).
- **[minor] deterministic tmp** — 🔥 concurrent same-code promotes interwrite; residue on crash. ⚖️ ❌ not defended. agree_weak ✓

### scripts/test_break_detection.ts
- **[major] identity fixture** — 🔥 vwap≡close×0.97 → drift≡0 → 120 threshold combinations all pass. ⚖️ ❌ not defended (mutant-verified). agree_weak ✓
- **[major] guard corrosion uncovered** — 🔥 [1.5,1.5]→[0.95,1.05] activates fallback against legal +20% days; zero coverage. ⚖️ ❌ not defended (narrowing itself justified; the uncovered activated path is not). agree_weak ✓
- **[major] triple copy** — 🔥 hand replica #3, BREAK_THRESHOLD declared twice, replica already drifted. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] non-monotonic dates** — 🔥 i%28 wraps 09-28→09-01. ⚖️ ❌ not defended (fixture hygiene). agree_weak ✓
- **[minor] tolerance 2.4× the residual** — 🔥 ±5.3% window "verifies" ≈5.64 while true value 5.514. ⚖️ ❌ not defended. agree_weak ✓

### scripts/test_portfolio_import.ts
- **[minor] locale-bound assertion** — 🔥 asserts '20,000' cosmetics. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] mixed-weights path untested** — 🔥 every() all-or-nothing gate; silent fallback uncovered (judge: the sum>0 fallback is unreachable dead code — partial correction). ⚖️ ❌ not defended. agree_weak ✓
- **[minor] unfalsifiable pure-CASH check** — 🔥 degenerates to !ok (judge: the "empty bundle overwrites slot" scare is false — callers guard bundle; core weak-assertion point stands). ⚖️ ❌ not defended. agree_weak ✓
- **[minor] rotting fixture + false comment** — 🔥 double as-cast; bare-code coverage claimed but absent. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] three conflicting truths** — 🔥 tests lock new CASH semantics; docstring + 2 tooltips still promise blocking. ⚖️ ❌ not defended. agree_weak ✓

### scripts/test_risk_parity.ts
- **[critical] replica suite** — 🔥 tests a photocopy; production can change arbitrarily. ⚖️ ❌ not defended (sibling proves import works). agree_weak ✓
- **[major] no 1/vol assertion** — 🔥 equal-weights and residual-on-first-item mutants pass everything; scenario-1 residual is 0; weights only console.logged. ⚖️ ❌ not defended (mutant-verified). agree_weak ✓
- **[minor] structural no-ops** — 🔥 Map.values() filter can't fail under the bug it names; "3 items" checks 2. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] uncovered sanitization branches** — 🔥 NaN vol silently fills the map (ran it); negative vol gets the largest weight. ⚖️ ❌ not defended. agree_weak ✓

### server.ts
- **[major] promote 2-line refresh** — 🔥 truncates initStore (overrides/deletedCodes/fundamentals/VWAP basis lost) + races auto-sync. ⚖️ ❌ not defended. agree_weak ✓
- **[major] half-committed promote** — 🔥 committed-then-500, retry dead-ends (judge: "only restart recovers" overstated — re-fetch works; core half-commit stands). ⚖️ ❌ not defended. agree_weak ✓
- **[major] zero concurrency control** — 🔥 non-atomic pair writes; approved report ≠ promoted data. ⚖️ ❌ not defended. agree_weak ✓
- **[major] Sentinel theater** — 🔥 hardcoded 22/HEALTHY served by health; opens no files; ERROR unreachable; exported from entry module. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] portfolios write/read** — 🔥 POST trusts client; GET silently [] on structural mismatch (judge: true corruption → 500 with message, only structural mismatch is silent — partial correction); no fsync. ⚖️ ✅ defended in part — agree_weak ✓
- **[minor] input validation gaps** — 🔥 NaN/negative riskBudgetWeight into engine math; arbitrary category; unvalidated promote code. ⚖️ ❌ not defended (judge corrected two downstream examples; core gaps stand). agree_weak ✓

### src/App.tsx
- **[critical] lazy without boundary** — 🔥 chunk failure white-screens everything. ⚖️ ❌ not defended. agree_weak ✓
- **[major] stale imported bundle** — 🔥 persisted bundle never re-validated; deleted legs → silent under-allocation. ⚖️ ❌ not defended (Carver absolute-budget semantics partially excuse, silence does not). agree_weak ✓
- **[minor] updater side effect** — 🔥 persistBundles inside setState updater. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] slot contract unenforced** — 🔥 hidden assumption id==='imported'. ⚖️ ✅ defended (single producer hardcodes the id; latent contract, not live bug) — agree_weak ✓
- **[minor] fallback layout jump** — 🔥 no min-height (judge: "indistinguishable from empty" overstated — spinner+text are distinct). ⚖️ ✅ defended in part — agree_weak ✓

### src/components/CorrelationAnalysisMatrix.tsx
- **[major] IDM label vs math** — 🔥 "理论值" printed while ρ truncated [-0.2,1], 2.5 clamp; neighboring card shows untruncated ρ → cross-check contradiction. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] window mismatch** — 🔥 label implies execution uses displayed value; engine hardcodes 60 days vs selectable 30/60/120/250. ⚖️ ❌ not defended. agree_weak ✓

### src/components/CustomPortfolioDiagnosticPanel.tsx
- **[major] updater POST (accident twin)** — 🔥 merge path lacks the sibling's first-mount guard; server-newer scenarios reproduce the documented full-reload bounce + double POST. ⚖️ ❌ not defended (one-time bounce, not a loop — severity mitigated, defect stands). agree_weak ✓
- **[major] stale quick result** — 🔥 slot-keyed only; old portfolio's metrics under new card; slot inferred by identity compare (A=B mis-attribution). ⚖️ ❌ not defended. agree_weak ✓
- **[minor] fetch hygiene** — 🔥 no catch on response-shape trust (unhandled rejection), no timeouts, no bars cache. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] stale CASH contract** — 🔥 dead branch, unused var, tooltips still promise blocking. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] "精确满仓" lies** — 🔥 ¥0 alert while zeroing holdings; notes suffixes accumulate per click. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] duplicated strip** — 🔥 ~50 lines verbatim ×2. ⚖️ ❌ not defended. agree_weak ✓

### src/services/customPortfolioStore.ts
- **[major] totalCapital discarded** — 🔥 42万 portfolio backtested as 100万 account (caps/rounding/ADV all shifted); sibling function does it right. ⚖️ ❌ not defended (judge quantified the real distortion). agree_weak ✓
- **[major] NaN holes** — 🔥 NaN survives every guard → whole map NaN (ran it); negative vol → largest weight; `?? it.amount` launders failure. ⚖️ ❌ not defended. agree_weak ✓
- **[major] lexicographic time compare** — 🔥 '.000Z' loses to 'Z'; hand-edited formats arbitrary; no timeout/validation/tombstones. ⚖️ ❌ not defended. agree_weak ✓
- **[major] isOfficial:false presets** — 🔥 persisted with module-load timestamps that always win → external edits shadowed forever; fire-and-forget POST, no serialization. ⚖️ ❌ not defended (judge: the filter itself is correct; the load-time timestamp is the漏洞). agree_weak ✓
- **[major] gates backwards** — 🔥 one out-of-pool leg blocks all (design supports partial); 20-bar samples return ok:true with all-zero metrics rendered green. ⚖️ ❌ not defended (judge corrected one color detail). agree_weak ✓
- **[minor] vocabulary + cash-pad promise** — 🔥 3-key validation, bare-id emission, duplicate double-weight, mathematically false cash-pad sentence when capitals differ (judge corrected the bare/full attribution — hazard stands). ⚖️ ❌ not defended. agree_weak ✓
- **[minor] copy-paste failures** — 🔥 11-field fail object ×3 with drifted wording; CASH sentinel ×4; O(N²) scan. ⚖️ ❌ not defended (judge corrected count 4→3). agree_weak ✓

### src/services/realData.ts
- **[critical] synthetic amount** — 🔥 detector validates its own input; promoted breaks enter the pool; misleading "已甄别" logs. ⚖️ ✅ defended in form (documented limitation + human promote gate) — agree_weak ✓ (log still lies).
- **[critical] guard corrosion** — 🔥 fabricated "return 0" assumption; narrowed guard mathematically always passes; legal limit-ups rescaled; log fabricates evidence. ⚖️ ✅ defended in form (trigger needs amount-less base parquet — an expected condition per the optional field) — agree_weak ✓
- **[major] ATR f²** — 🔥 realData pre-scales, liveMarketSync scales again; corrupted ATR into EWMAC → target shares → UI. ⚖️ ✅ defended in form (two locally-correct owners) — agree_weak ✓
- **[major] vwapPrice dual meaning** — 🔥 genuine VWAP for base, algebraic copy of currentPrice for registry, no source flag, feeding the market-price fallback. ⚖️ ✅ defended in form (judge corrected "median" → median-filtered last value) — agree_weak ✓
- **[major] factor timestamp race** — 🔥 quote.tradeDate fetched then discarded; intraday promote bakes the day's move into the factor; consumer validates only >0. ⚖️ ✅ defended in form — agree_weak ✓
- **[minor] triplication + double read + no dedup** — 🔥 constants ×3, registry read twice per load, promote-existing-code double-lists, cwd vs module-relative path. ⚖️ ✅ defended in form — agree_weak ✓

### src/services/stagingData.ts
- **[critical] pagination cursor** — 🔥 cursor in start slot → max 2 requests → ~640 bars fake "full history" into the pool. ⚖️ ❌ not defended (comments prove intent; severity understated). agree_weak ✓
- **[major] spawn without timeout** — 🔥 hung child hangs the HTTP request forever; stderr discarded; personal absolute path committed. ⚖️ ❌ not defended. agree_weak ✓
- **[major] registry erase-on-read-failure** — 🔥 catch→[]→atomic overwrite with only the new entry; concurrent promotes share a fixed tmp. ⚖️ ❌ not defended (judge: hater missed the concurrent-different-codes entry-loss path too). agree_weak ✓
- **[major] fetch/promote interleave** — 🔥 promote unlinks the user's freshly fetched data after writing registry from stale meta. ⚖️ ❌ not defended. agree_weak ✓
- **[major] dead detection branch** — 🔥 provably unreachable rescale for the only caller; docstring promises recovery that the one-source architecture cannot deliver. ⚖️ ✅ defended in form (findings feed warnings; limitation documented) — agree_weak ✓
- **[minor] tradeDate slice** — 🔥 '2026100915' is not a date; correct parser exists in liveMarketSync. ⚖️ ❌ not defended. agree_weak ✓
- **[minor] promote path unvalidated** — 🔥 path.join with raw code (fetch path validates). ⚖️ ❌ not defended. agree_weak ✓
- **[minor] no page timeout/retry** — 🔥 one 5xx discards all collected bars (judge: the cursor bug caps it at 2 requests today — frequency mitigated, fragility stands). ⚖️ ❌ not defended. agree_weak ✓

### vite.config.ts
- **[major] fixes a non-mechanism** — 🔥 data/ not in Vite's module graph (zero imports; empirically reproduced: POST → "[no modules matched]" → nothing to browser); the real cause of any activeTab reset is still at large; the ignore silences the diagnostic signal. ⚖️ ✅ defended in form (intent was right; premise false) — agree_weak ✓
- **[minor] name-anchored glob** — 🔥 future src/data/ silently unwatched; git-tracked files silenced. ⚖️ ✅ defended in form (latent today) — agree_weak ✓
- **[minor] sixth copy of the data root** — 🔥 literal duplicates a fact living in five writers. ⚖️ ✅ defended in form — agree_weak ✓

### integration (cross-module)
- **[major] silent leg drop** — 🔥 bundles.ts:76 continue + carverEngine:136 absolute budgets + never-revalidated persisted bundle + syntheticBars second drop path. ⚖️ ✅ defended in form — agree_weak ✓
- **[major] ATR two owners** — 🔥 realData:301 + liveMarketSync:280 stack to f²; propagates into signals, target shares, UI; recomputed wrong on every sync. ⚖️ ✅ defended in form — agree_weak ✓
- **[major] three whole-array writers** — 🔥 promote/auto-sync/sync-latest race; "press F5" advice cannot work (server not restarted); GET/POST contracts inconsistent. ⚖️ ✅ defended in form — agree_weak ✓
- **[major] merge POST twin** — 🔥 updater side effect + server-newer → per-mount write; POST not read-modify-write (judge: the reload consequence depends on the mechanism vite c1 disproved; the three other defects stand independently). ⚖️ ✅ defended in form — agree_weak ✓
- **[minor] 60-day hardcode** — 🔥 engine window fixed while matrix selector claims execution linkage. ⚖️ ✅ defended in form — agree_weak ✓
- **[minor] staging pair-write** — 🔥 non-atomic pair while registry write is tmp+rename in the same file; listed-but-unpromotable states reachable. ⚖️ ✅ defended in form — agree_weak ✓
- **[minor] CASH residue ×4 sites** — 🔥 tooltips ×2, dead branch, alert text, docstring. ⚖️ ✅ defended in form — agree_weak ✓

## Suggested fix order (by risk × effort)

1. **V1 date epoch + re-promote 562500/512660** (critical, already-on-disk corruption; ~1h incl. re-promote)
2. **V2 Tencent cursor** (critical, every future promote is truncated; ~30min + protocol assertion)
3. **V5 guard/fallback** (critical, legal-move corrosion; fail-loud + fixture, ~1h)
4. **V6 synthetic-amount detector** (critical-ish; source-tag + honest warn, ~1h)
5. **V3 test_risk_parity import-production** (critical test illusion; ~1h)
6. **V7 ErrorBoundary** (critical UX failure; ~30min)
7. **V11/V12/V13/V14 promote pipeline** (major cluster; shared refreshCatalog + per-code locks + commit-order, ~half day)
8. **V19/V29/V30 catalog/ATR/sync invariants** (major cluster; ~half day)
9. **V24/V25/V26/V27 store semantics** (major cluster; ~half day)
10. **V18 Sentinel honesty** (major; real scan or UNKNOWN status, ~2h)
11. **V20/V21 panel state** (major; ~2h)
12. Minor sweep (33 items; batch by theme, ~1 day)

---
_Review protocol: hater (12 file agents + 1 integration agent) → judge (13 group agents, fact-verifying) → verdict synthesis. Judges ran mutants, recomputed arithmetic, read raw parquet epochs, and reproduced the Vite HMR behavior where claims demanded it. Report generated 2026-10-14 on feature/main-fundamental-v2 @ 9058b76 + dirty tree._
