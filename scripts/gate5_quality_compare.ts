/**
 * 闸门⑤：基本面质量守门人 (Quality-Gated ERP Tilt) 严谨对比回测
 * 
 * 对比维度：
 * 1. 基准 (Baseline): 纯动量与波动率定仓 (useERPTilt=false)
 * 2. 原始单维估值 (Raw Tilt): 纯 PE/PB 分位偏置 (useERPTilt=true, useQualityGate=false, useTrendGate=false)
 * 3. 质量过滤增强 (Quality-Gated Tilt): 排除高危价值陷阱标的 (useERPTilt=true, useQualityGate=true, useTrendGate=false)
 * 4. 质量+右侧双门槛 (Quality + Trend Gated Tilt): 质量防爆雷 + 右侧确认 (useERPTilt=true, useQualityGate=true, useTrendGate=true)
 * 
 * 运行方式：npx tsx scripts/gate5_quality_compare.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { BALANCED9_ID, DEFAULT_BUNDLES, resolveUniverse } from '../src/services/bundles';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { enrichUniverseFundamentals } from '../src/services/fundamentalService';

function fmt(x: number | undefined, digits = 2): string {
  return typeof x === 'number' ? x.toFixed(digits) : '-';
}

async function main() {
  let catalog = await loadRealUniverse();
  // 注入真实基本面财务指标
  catalog = enrichUniverseFundamentals(catalog);

  const base = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };

  for (const bundleId of [BALANCED9_ID, 'poorlab11']) {
    const bundle = DEFAULT_BUNDLES.find((b) => b.id === bundleId);
    if (!bundle) continue;
    const universe = resolveUniverse(catalog, bundle);
    console.log(`\n======================================================================`);
    console.log(`########## ${bundle.name} (${universe.length} 腿资产) 闸门⑤策略对比 ##########`);
    console.log(`======================================================================`);

    // 1. 基准：关闭估值偏置
    const mBaseline = await runRealBacktest(universe, { 
      ...base, 
      useERPTilt: false 
    });

    // 2. 原始单维估值偏置
    const mRawTilt = await runRealBacktest(universe, { 
      ...base, 
      useERPTilt: true, 
      useQualityGate: false, 
      useTrendGate: false 
    });

    // 3. 质量门槛过滤 (排除高危价值陷阱)
    const mQualityGated = await runRealBacktest(universe, { 
      ...base, 
      useERPTilt: true, 
      useQualityGate: true, 
      useTrendGate: false 
    });

    // 4. 质量 + 趋势双门槛 (质量防雷 + 右侧动量确认)
    const mDualGated = await runRealBacktest(universe, { 
      ...base, 
      useERPTilt: true, 
      useQualityGate: true, 
      useTrendGate: true 
    });

    const printRow = (label: string, m: typeof mBaseline.metrics, triggers?: number) => {
      console.log(
        label.padEnd(16),
        'CAGR', fmt(m.carver.cagrPct).padStart(6) + '%',
        '| vol', fmt(m.carver.annVolPct).padStart(5) + '%',
        '| Sharpe', fmt(m.carver.sharpe).padStart(5),
        '| Sortino', fmt(m.carver.sortino).padStart(5),
        '| MaxDD', fmt(m.carver.maxDrawdownPct).padStart(7) + '%',
        '| Calmar', fmt(m.carver.calmar).padStart(5),
        triggers !== undefined ? `| 触发: ${triggers}` : ''
      );
    };

    console.log('测试样本期:', mBaseline.metrics.startDate, '→', mBaseline.metrics.endDate,
      `（共 ${mBaseline.metrics.rebalanceCount} 次月度再平衡）\n`);

    printRow('1. 纯动量基准', mBaseline.metrics, mBaseline.valuationTiltTriggers);
    printRow('2. 原始单维估值', mRawTilt.metrics, mRawTilt.valuationTiltTriggers);
    printRow('3. 质量守门过滤', mQualityGated.metrics, mQualityGated.valuationTiltTriggers);
    printRow('4. 质量+趋势双守门', mDualGated.metrics, mDualGated.valuationTiltTriggers);

    const diff = (a: number, b: number) => (b - a >= 0 ? `+${(b - a).toFixed(2)}` : (b - a).toFixed(2));
    console.log('\n--- 相对基准增量比较 (双守门 vs 纯动量基准) ---');
    console.log(
      'CAGR:', diff(mBaseline.metrics.carver.cagrPct, mDualGated.metrics.carver.cagrPct) + 'pct',
      '| Sharpe:', diff(mBaseline.metrics.carver.sharpe, mDualGated.metrics.carver.sharpe),
      '| MaxDD:', diff(mBaseline.metrics.carver.maxDrawdownPct, mDualGated.metrics.carver.maxDrawdownPct) + 'pct',
      '| Calmar:', diff(mBaseline.metrics.carver.calmar, mDualGated.metrics.carver.calmar)
    );
  }
}

main().catch((e) => {
  console.error('GATE5 FAILED:', e);
  process.exit(1);
});
