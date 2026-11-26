/**
 * 快照：全池 EWMAC 卡弗标量（-20~+20），标注当前持仓。
 * 用法：node_modules/.bin/tsx scripts/check_scalars_now.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

const HOLDINGS = new Set(['518880', '512890', '562500', '513180']);

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
  const universe = await loadRealUniverse();
  const rows: any[] = [];

  for (const inst of universe) {
    const code = inst.id.replace(/\..*$/, '');
    const bars = (inst as any).bars || [];
    if (bars.length < 130) continue;
    const last = bars[bars.length - 1];
    let sig: any;
    try { sig = evaluateAShareStrategies(inst, universe); } catch { continue; }
    const f = sig?.ewmacFastSlow;
    if (!f) continue;
    rows.push({
      code, name: inst.name, lastDate: last.date, close: last.close,
      e8_32: f.ewmac8_32, e16_64: f.ewmac16_64, e32_128: f.ewmac32_128,
      composite: f.compositeScalar, final: sig.finalForecastScalar,
      ma250: sig.absoluteMomentumPass, hold: HOLDINGS.has(code),
    });
  }

  rows.sort((a, b) => b.final - a.final);

  console.log('=== 持仓标的 ===');
  console.log('code\tname\tlastBar\tclose\te8/32\te16/64\te32/128\tcomposite\tfinal\t判读\tMA250');
  for (const r of rows.filter(x => x.hold)) {
    console.log(`${r.code}\t${r.name}\t${r.lastDate}\t${r.close}\t${r.e8_32.toFixed(1)}\t${r.e16_64.toFixed(1)}\t${r.e32_128.toFixed(1)}\t${r.composite.toFixed(1)}\t${r.final.toFixed(1)}\t${label(r.final)}\t${r.ma250 ? 'Y' : 'N'}`);
  }

  console.log('\n=== 全池（按标量降序）===');
  console.log('code\tname\tlastBar\tclose\tcomposite\tfinal\t判读\tMA250');
  for (const r of rows) {
    console.log(`${r.code}\t${r.name}\t${r.lastDate}\t${r.close}\t${r.composite.toFixed(1)}\t${r.final.toFixed(1)}\t${label(r.final)}\t${r.ma250 ? 'Y' : 'N'}`);
  }

  const pos = rows.filter(r => r.final >= 2).length;
  const neg = rows.filter(r => r.final <= -2).length;
  const neu = rows.length - pos - neg;
  console.log(`\n汇总：${rows.length} 只｜看多(>=+2) ${pos}｜中性 ${neu}｜看空(<=-2) ${neg}`);
}

main().catch(e => { console.error(e); process.exit(1); });
