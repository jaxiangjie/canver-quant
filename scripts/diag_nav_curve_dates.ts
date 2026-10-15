/**
 * 复核「风险与净值动态分析 → 组合净值曲线」的日期对齐（2026-10-15）。
 * 用法: npx tsx scripts/diag_nav_curve_dates.ts
 *
 * 复刻 PortfolioRiskContributionChart 第 152-217 行的算法：
 *   baseLength = min(各标的 bars 长度)；startIndex = baseLength - 60；
 *   第 i 根取各标的 bars[i]（**按下标，不按交易日**）；日期标签取最后一个标的的 bars[i].tradeDate。
 */
import { loadRealUniverse } from '../src/services/realData';
import { loadPersistedStore } from '../src/services/persistence';
import { DEFAULT_BUNDLES, resolveUniverseDetailed } from '../src/services/bundles';

const real: any[] = (await loadRealUniverse()) as any[];
const store: any = loadPersistedStore();
const sharesById = new Map<string, number>(
  (store?.instruments ?? []).map((i: any) => [String(i.id), Number(i.currentShares) || 0]),
);

const bundle = DEFAULT_BUNDLES.find((b) => b.id === 'balanced9') ?? DEFAULT_BUNDLES[0];
const legs = resolveUniverseDetailed(real, bundle).universe;
const legsWithBars = legs.filter((p: any) => (p.bars ?? []).length > 30);

console.log('持仓腿（按组件里的 positions 顺序）:');
for (const p of legsWithBars) {
  console.log(`  ${p.code.padEnd(10)} bars=${String(p.bars.length).padStart(5)}  当前持股=${sharesById.get(String(p.id)) ?? 0}  末根=${p.bars[p.bars.length - 1].tradeDate}`);
}

const lengths = legsWithBars.map((p: any) => p.bars.length);
const baseLength = Math.min(...lengths);
const startIndex = baseLength - 60;
console.log(`\nbaseLength(=min 长度)=${baseLength}  startIndex=${startIndex}  区间索引=[${startIndex}, ${baseLength - 1}]`);

console.log('\n各标的在同一 index 上取到的日期（下标对齐的实际后果）:');
for (const p of legsWithBars) {
  const a = p.bars[startIndex]?.tradeDate;
  const b = p.bars[baseLength - 1]?.tradeDate;
  console.log(`  ${p.code.padEnd(10)} index${startIndex}→${a}   index${baseLength - 1}→${b}`);
}

const last = legsWithBars[legsWithBars.length - 1];
console.log(`\n组件实际显示的横轴日期（取自最后一个标的 ${last.code}）:`);
console.log(`  首点 ${last.bars[startIndex]?.tradeDate} → 末点 ${last.bars[baseLength - 1]?.tradeDate}`);
console.log(`  （真实最新交易日应为 ${last.bars[last.bars.length - 1].tradeDate}）`);
