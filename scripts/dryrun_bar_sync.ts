/** 干跑：验证收益率延续对全池 22 只是否安全（不写盘）。 */
import { loadRealUniverse } from '../src/services/realData';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import { stitchByReturns } from '../src/services/dailyBarSync';

async function main() {
  const universe = (await loadRealUniverse()) as any[];
  console.log(`池内标的: ${universe.length}\n`);
  let ok = 0, fail = 0, uptodate = 0;
  for (const inst of universe) {
    const bare = String(inst.code).slice(0, 6);
    const bars = inst.bars || [];
    const lastDate = bars.length ? bars[bars.length - 1].tradeDate : '';
    try {
      const tc = await fetchTencentHfqDaily(bare, 1280, lastDate);
      const r = stitchByReturns(bars, tc);
      if (!r.ok) {
        fail++;
        console.log(`❌ ${bare} ${inst.name}\t${r.reason}`);
        continue;
      }
      if (!r.appended.length) {
        uptodate++;
        console.log(`— ${bare} ${inst.name}\t已是最新（${lastDate}）`);
        continue;
      }
      ok++;
      const detail = r.appended
        .map((b, i) => {
          const pc = i === 0 ? bars[bars.length - 1].close : r.appended[i - 1].close;
          return `${b.tradeDate.slice(5)} ${(((b.close - pc) / pc) * 100).toFixed(2)}%`;
        })
        .join(' | ');
      console.log(`✅ ${bare} ${inst.name}\t${lastDate} → ${r.appended[r.appended.length - 1].tradeDate} (+${r.appended.length})  ${detail}`);
    } catch (e: any) {
      fail++;
      console.log(`❌ ${bare} ${inst.name}\t拉取异常：${e?.message || e}`);
    }
  }
  console.log(`\n可更新=${ok}  已最新=${uptodate}  失败=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
