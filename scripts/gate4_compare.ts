/**
 * 闸门④：ERP 估值偏置 开/关 对比回测（balanced9，渐进入池，月度再平衡）
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
  const bundle = DEFAULT_BUNDLES.find((b) => b.id === BALANCED9_ID)!;
  const universe = resolveUniverse(catalog, bundle);
  console.log(`universe: ${bundle.name}（${universe.length} 腿）`);

  const base = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };
  const off = await runRealBacktest(universe, { ...base, useERPTilt: false });
  const on = await runRealBacktest(universe, { ...base, useERPTilt: true });

  const row = (label: string, m: typeof off.metrics) => {
    console.log(
      label.padEnd(14),
      'CAGR', fmt(m.carver.cagrPct).padStart(6) + '%',
      '| vol', fmt(m.carver.annVolPct).padStart(5) + '%',
      '| Sharpe', fmt(m.carver.sharpe).padStart(5),
      '| Sortino', fmt(m.carver.sortino).padStart(5),
      '| MaxDD', fmt(m.carver.maxDrawdownPct).padStart(6) + '%',
      '| Calmar', fmt(m.carver.calmar).padStart(5),
    );
  };

  console.log('\n===== Carver（受保护）净值：ERP tilt 关 vs 开 =====');
  console.log('样本期:', off.metrics.startDate, '→', off.metrics.endDate,
    `（${off.metrics.rebalanceCount} 次再平衡）`);
  row('tilt 关', off.metrics);
  row('tilt 开', on.metrics);
  console.log('\ntilt 触发的再平衡次数:', on.valuationTiltTriggers, '/', on.metrics.rebalanceCount);

  const diff = (a: number, b: number) => (b - a).toFixed(2);
  console.log('\n===== 差异（开 - 关） =====');
  console.log(
    'CAGR', diff(off.metrics.carver.cagrPct, on.metrics.carver.cagrPct) + 'pct',
    '| vol', diff(off.metrics.carver.annVolPct, on.metrics.carver.annVolPct) + 'pct',
    '| Sharpe', diff(off.metrics.carver.sharpe, on.metrics.carver.sharpe),
    '| MaxDD', diff(off.metrics.carver.maxDrawdownPct, on.metrics.carver.maxDrawdownPct) + 'pct',
    '| Calmar', diff(off.metrics.carver.calmar, on.metrics.carver.calmar),
  );

  // 等权与基准参照（不受 tilt 影响，验证两组样本一致）
  console.log('\n(参照) 等权 Sharpe:', fmt(off.metrics.equalWeight.sharpe),
    '沪深300 Sharpe:', fmt(off.metrics.csi300.sharpe));
}

main().catch((e) => {
  console.error('GATE4 FAILED:', e);
  process.exit(1);
});
