/**
 * 先把持仓 4 只的日线推进到最近已收盘交易日，再算 EWMAC 标量。
 * 用法：node_modules/.bin/tsx scripts/refresh_scalars.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { syncDailyBars } from '../src/services/dailyBarSync';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

const HOLD = ['601919','000333','601288','600886','601088','002714','601857','600660','601318','002223','601899'];

function label(s: number): string {
  if (s >= 15) return '强烈看多';
  if (s >= 6) return '看多';
  if (s >= 2) return '偏多';
  if (s > -2) return '中性';
  if (s > -6) return '偏空';
  if (s > -15) return '看空';
  return '强烈看空';
}

async function main() {
  console.log('--- 同步日线（仅持仓 4 只）---');
  const u0 = await loadRealUniverse();
  try {
    const rep = await syncDailyBars(u0, { codes: HOLD });
    console.log(`gate=${rep.gateDate} total=${rep.total} updated=${rep.updated} upToDate=${rep.upToDate} failed=${rep.failed} skipped=${!!rep.skipped}`);
    for (const r of rep.results) {
      console.log(`  ${r.code} ${r.name}: ${r.beforeLast} -> ${r.afterLast} appended=${r.appended} ${r.status}${r.reason ? ' | ' + r.reason : ''}`);
    }
  } catch (e: any) {
    console.log('同步失败：', e?.message ?? e);
  }

  console.log('\n--- 标量 ---');
  const u = await loadRealUniverse();
  console.log('code\tname\tlastBar\tclose(hfq)\te8/32\te16/64\te32/128\tcomposite\tfinal\t判读\tMA250');
  for (const code of HOLD) {
    const inst = u.find(i => i.id.startsWith(code));
    if (!inst) { console.log(`${code}\tMISSING`); continue; }
    const bars: any[] = (inst as any).bars || [];
    const last = bars[bars.length - 1];
    const sig: any = evaluateAShareStrategies(inst, u);
    const f = sig.ewmacFastSlow;
    console.log(`${code}\t${inst.name}\t${last?.tradeDate}\t${last?.close}\t${f.ewmac8_32.toFixed(1)}\t${f.ewmac16_64.toFixed(1)}\t${f.ewmac32_128.toFixed(1)}\t${f.compositeScalar.toFixed(1)}\t${sig.finalForecastScalar.toFixed(1)}\t${label(sig.finalForecastScalar)}\t${sig.absoluteMomentumPass ? 'Y' : 'N'}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
