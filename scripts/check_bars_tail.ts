/** 临时诊断：poorlab11 bars 截止日与当日涨跌幅字段。 */
import { loadRealUniverse } from '../src/services/realData';

async function main() {
  const u = await loadRealUniverse();
  for (const code of ['601288', '601899', '002223']) {
    const i: any = u.find(x => x.id.startsWith(code));
    if (!i) { console.log(code, 'MISSING'); continue; }
    const bars: any[] = i.bars || [];
    const last = bars[bars.length - 1] || {};
    console.log(`${code} ${i.name} bars=${bars.length} lastKeys=${JSON.stringify(Object.keys(last))}`);
    console.log(`  last=${JSON.stringify(last)} prev=${JSON.stringify(bars[bars.length - 2] || {})}`);
    console.log(`  changePct=${i.changePct} currentPrice=${i.currentPrice}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
