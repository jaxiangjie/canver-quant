/**
 * 闸门④：ERP 估值偏置 开/关 对比回测（balanced9 + poorlab11，渐进入池，月度再平衡）
 * 运行：npx tsx scripts/gate4_compare.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { BALANCED9_ID, DEFAULT_BUNDLES, resolveUniverse } from '../src/services/bundles';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';

function fmt(x: number | undefined, digits = 2): string {
  return typeof x === 'number' ? x.toFixed(digits) : '-';
}

async function main() {
  const catalog = await loadRealUniverse();
  const base = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };

  for (const bundleId of [BALANCED9_ID, 'poorlab11']) {
    const bundle = DEFAULT_BUNDLES.find((b) => b.id === bundleId);
    if (!bundle) continue;
    const universe = resolveUniverse(catalog, bundle);
    console.log(`\n########## ${bundle.name}（${universe.length} 腿） ##########`);

    const off = await runRealBacktest(universe, { ...base, useERPTilt: false });
    const on = await runRealBacktest(universe, { ...base, useERPTilt: true });

    const row = (label: string, m: typeof off.metrics) => {
      console.log(
        label.padEnd(8),
        'CAGR', fmt(m.carver.cagrPct).padStart(6) + '%',
        '| vol', fmt(m.carver.annVolPct).padStart(5) + '%',
        '| Sharpe', fmt(m.carver.sharpe).padStart(5),
        '| Sortino', fmt(m.carver.sortino).padStart(5),
        '| MaxDD', fmt(m.carver.maxDrawdownPct).padStart(7) + '%',
        '| Calmar', fmt(m.carver.calmar).padStart(5),
      );
    };

    console.log('样本期:', off.metrics.startDate, '→', off.metrics.endDate,
      `（${off.metrics.rebalanceCount} 次再平衡）`);
    row('tilt关', off.metrics);
    row('tilt开', on.metrics);
    console.log('tilt 触发再平衡次数:', on.valuationTiltTriggers, '/', on.metrics.rebalanceCount);

    const diff = (a: number, b: number) => (b - a).toFixed(2);
    console.log(
      '差异(开-关): CAGR', diff(off.metrics.carver.cagrPct, on.metrics.carver.cagrPct) + 'pct',
      '| vol', diff(off.metrics.carver.annVolPct, on.metrics.carver.annVolPct) + 'pct',
      '| Sharpe', diff(off.metrics.carver.sharpe, on.metrics.carver.sharpe),
      '| MaxDD', diff(off.metrics.carver.maxDrawdownPct, on.metrics.carver.maxDrawdownPct) + 'pct',
      '| Calmar', diff(off.metrics.carver.calmar, on.metrics.carver.calmar),
    );
  }
}

main().catch((e) => {
  console.error('GATE4 FAILED:', e);
  process.exit(1);
});
