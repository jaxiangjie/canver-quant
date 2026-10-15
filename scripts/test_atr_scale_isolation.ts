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

    const atrOk = Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 25;
    if (!atrOk) badATR++;
    if (Math.abs(base) >= 20) extreme++;

    console.log(
      `${String(inst.code ?? inst.id).slice(0, 6)}\t${(inst.name || '').slice(0, 8)}\t${inst.category || '-'}\t` +
        `${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'}\t\t${base}\t\t${polluted}\t\t${iso ? 'OK' : 'FAIL'}`,
    );
  }

  console.log(`\n口径隔离失败: ${failIso} | ATR 越界: ${badATR} | 标量打满 ±20: ${extreme}`);
  console.log(failIso === 0 ? '✅ 全池口径隔离通过（修复对所有组合生效）' : '❌ 存在未覆盖标的');
  process.exit(failIso === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
