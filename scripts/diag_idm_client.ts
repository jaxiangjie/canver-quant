/**
 * 验证 IDM 修复（2026-10-15）：浏览器口径为何恒为 1、修复后变成多少、对目标股数影响多大。
 * 用法: npx tsx scripts/diag_idm_client.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { hydrateInstrument } from '../src/services/apiClient';
import { computeUniverseCorrelationMatrix } from '../src/services/correlationEngine';
import { calculatePortfolio, IDM_CORRELATION_WINDOW, DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { DEFAULT_BUNDLES, resolveUniverseDetailed } from '../src/services/bundles';

function stripBars(inst: any) {
  const { bars, ...rest } = inst;
  return { ...rest, barsCount: Array.isArray(bars) ? bars.length : 0 };
}

const REAL: any[] = (await loadRealUniverse()) as any[];
const CLIENT = REAL.map(stripBars).map(hydrateInstrument); // 模拟浏览器：bars 被合成

// ── 1. 全池口径：证明「浏览器恒为 1」的根因 ──
const rSrv = computeUniverseCorrelationMatrix(REAL, IDM_CORRELATION_WINDOW);
const rCli = computeUniverseCorrelationMatrix(CLIENT, IDM_CORRELATION_WINDOW);
console.log('【全池 22 只】');
console.log(`  真实 bars : 参与=${rSrv.instruments.length}  ρ=${rSrv.averageUniverseCorrelation}  IDM(raw)=${rSrv.carverIDM}`);
console.log(`  浏览器    : 参与=${rCli.instruments.length}  ρ=${rCli.averageUniverseCorrelation}  IDM(raw)=${rCli.carverIDM}  ← 全被 syntheticBars 过滤`);

// ── 2. 用 90 根尾部 K 线模拟 App 的 ensureRealBars(limit=90)，验证与全量口径等价 ──
const sliced = REAL.map((i) => ({ ...i, bars: (i.bars || []).slice(-90) }));
const rSlice = computeUniverseCorrelationMatrix(sliced, IDM_CORRELATION_WINDOW);
console.log('【全池 22 只 · 仅取尾部 90 根】');
console.log(`  参与=${rSlice.instruments.length}  ρ=${rSlice.averageUniverseCorrelation}  IDM(raw)=${rSlice.carverIDM}` +
  `  → 与全量口径${Math.abs(rSlice.averageUniverseCorrelation - rSrv.averageUniverseCorrelation) < 1e-6 ? '一致 ✅' : '不一致 ⚠️'}`);

// ── 3. 对激活组合（balanced9）算目标仓位变化 ──
const bundle = DEFAULT_BUNDLES.find((b) => b.id === 'balanced9') ?? DEFAULT_BUNDLES[0];
for (const tag of ['balanced9']) {
  console.log(`\n【激活组合 ${tag}】`);
  const legsReal = resolveUniverseDetailed(REAL, bundle).universe;
  const legsClient = legsReal.map(stripBars).map(hydrateInstrument);
  const legsSlice = legsReal.map((i: any) => ({ ...i, bars: (i.bars || []).slice(-90) }));
  const r = computeUniverseCorrelationMatrix(legsSlice, IDM_CORRELATION_WINDOW);
  console.log(`  腿数=${legsReal.length}  ρ=${r.averageUniverseCorrelation}  IDM(raw)=${r.carverIDM} → 封顶 1.80 后生效 ${Math.min(1.8, r.carverIDM)}`);

  const before = calculatePortfolio(legsClient, DEFAULT_CARVER_SETTINGS); // 旧行为：IDM 退化 1.0
  const after = calculatePortfolio(legsClient, DEFAULT_CARVER_SETTINGS, {
    idm: r.carverIDM, avgCorrelation: r.averageUniverseCorrelation, legCount: r.instruments.length,
  });
  console.log(`  引擎 IDM      : ${before.summary.carverIDM} → ${after.summary.carverIDM}`);
  console.log(`  组合年化波动  : ${before.summary.effectiveAnnualVol}% → ${after.summary.effectiveAnnualVol}%（ρ 由 0 变为真实值）`);
  console.log(`  目标总市值    : ¥${before.summary.targetEquityValue.toLocaleString()} (${before.summary.targetLeverageRatio}%) → ¥${after.summary.targetEquityValue.toLocaleString()} (${after.summary.targetLeverageRatio}%)`);
  console.log(`  杠杆硬顶生效  : ${before.summary.isLeverageConstrained} → ${after.summary.isLeverageConstrained}`);
  const pick = ['510300.SH', '511010.SH', '518880.SH'];
  for (const c of pick) {
    const b = before.positions.find((p: any) => p.instrument?.code === c);
    const a = after.positions.find((p: any) => p.instrument?.code === c);
    if (b && a) console.log(`    ${c} 目标股数 ${b.targetShares} → ${a.targetShares}`);
  }
}
