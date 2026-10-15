/**
 * 临时诊断：poorlab11 十一只标的的 EWMAC 卡弗标量（-20~+20）快照。
 * 用法：node_modules/.bin/tsx scripts/check_ewmac_poorlab11.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

const POORLAB11 = [
  '601288', '601318', '601857', '600886', '601088', '601919', '601899',
  '000333', '600660', '002714', '002223',
];

async function main() {
  const universe = await loadRealUniverse();
  const byCode = new Map(universe.map(i => [i.id.replace(/\..*$/, ''), i]));

  console.log('code\tname\tlastBar\tclose\tchg%\t8/32\t16/64\t32/128\tcomposite\tfinalScalar\tMA250pass');
  for (const code of POORLAB11) {
    const inst = byCode.get(code);
    if (!inst) { console.log(`${code}\tMISSING`); continue; }
    const bars = (inst as any).bars || [];
    const last = bars[bars.length - 1];
    const sig = evaluateAShareStrategies(inst, universe);
    const f = sig.ewmacFastSlow;
    console.log(
      `${code}\t${inst.name}\t${last?.date ?? '?'}\t${last?.close ?? '?'}\t${inst.changePct ?? '?'}` +
      `\t${f.ewmac8_32.toFixed(1)}\t${f.ewmac16_64.toFixed(1)}\t${f.ewmac32_128.toFixed(1)}` +
      `\t${f.compositeScalar.toFixed(1)}\t${sig.finalForecastScalar.toFixed(1)}\t${sig.absoluteMomentumPass}`
    );
  }
}

main().catch(e => { console.error(e); process.exit(1); });
