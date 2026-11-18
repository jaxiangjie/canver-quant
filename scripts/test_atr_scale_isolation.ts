/**
 * 全池覆盖验证（2026-10-15 ATR 事故）：22 只标的 × 污染隔离 + ATR 合理性 + 标量异常扫描。
 * 覆盖 balanced9 / select_etf5 / poorlab11 三个组合的全部标的。
 */
import { loadRealUniverse } from '../src/services/realData';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

async function main() {
  const universe = await loadRealUniverse();
  console.log(`全池标的数: ${universe.length}\n`);
  console.log('code\tname\tcat\tATR/price%\tscalar(原)\tscalar(污染)\t隔离');
  let failIso = 0, badATR = 0, extreme = 0;

  for (const inst of universe as any[]) {
    const bars = inst.bars || [];
    const last = bars[bars.length - 1] || {};
    const hfqATR: number | undefined = last.atr20;
    const price = last.close || 0;
    const ratio = hfqATR && price ? (hfqATR / price) * 100 : NaN;

    const base = evaluateAShareStrategies(inst, universe).finalForecastScalar;
    const polluted = evaluateAShareStrategies({ ...inst, dailyATR: 0.0005 }, universe).finalForecastScalar;
    const iso = base === polluted;
    if (!iso) failIso++;

    // ATR 合理界按资产类别校准（2026-11-18 tribunal，与 computeEWMAC 的 ATR_RATIO_FLOOR 同口径）：
    // 旧统一 0.2% 下限会把国债 ETF 的合法日波（511010 实测 ≈0.06%）永久判越界。
    const floorPct = inst.category === 'bond_etf' ? 0.02 : inst.category === 'commodity_etf' ? 0.08 : 0.2;
    const atrOk = Number.isFinite(ratio) && ratio >= floorPct && ratio <= 25;
    if (!atrOk) badATR++;
    if (Math.abs(base) >= 20) extreme++;

    console.log(
      `${String(inst.code ?? inst.id).slice(0, 6)}\t${(inst.name || '').slice(0, 8)}\t${inst.category || '-'}\t` +
        `${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'}\t\t${base}\t\t${polluted}\t\t${iso ? 'OK' : 'FAIL'}`,
    );
  }

  // 退出码覆盖全部判定项（2026-11-18 tribunal）：旧实现只看 failIso —— 全池 ATR 都越界
  // 也照样 ✅ + exit 0，三个计数器两个是装饰品。extreme（标量打满 ±20）是信息项：
  // 强趋势里 |20| 可以是合法值，不参与判定、只打印提醒。
  console.log(`\n口径隔离失败: ${failIso} | ATR 越界: ${badATR} | 标量打满 ±20: ${extreme}（信息项）`);
  const ok = failIso === 0 && badATR === 0;
  console.log(
    ok
      ? '✅ 口径隔离 + ATR 合理性通过（修复对所有组合生效）'
      : '❌ 存在未覆盖标的或 ATR 越界（越界多为口径错位/数据腐败，逐行排查上表）',
  );
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
