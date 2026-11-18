// 只读：全池复权断裂体检 —— 逐日比较「本地 hfq 收益率」与「腾讯前复权收益率」
// 正常差异只出现在除息日且幅度≈分红率（<4%）；若某日差异巨大，说明本地序列在该日发生了错误的复权重标定
import { loadRealUniverse } from '../src/services/realData';

const FROM = '2024-01-01';
const DIFF_THRESHOLD = 4; // 单日收益率差异超过 4% 判为污染

async function fetchQfq(code: string) {
  const sym = /^(6|5)/.test(code) ? `sh${code}` : `sz${code}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,${FROM},2026-11-17,1200,qfq`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j: any = await res.json();
  const node = j?.data?.[sym];
  const arr = node?.qfqday || node?.day || [];
  return new Map<string, number>(arr.map((r: any[]) => [r[0], Number(r[2])]));
}

const catalog = await loadRealUniverse();
const list = catalog.filter((i) => !i.syntheticBars && (i.bars?.length || 0) > 0);
console.log(`体检 ${list.length} 只标的，区间 ${FROM} ~ 2026-11-17\n`);

const rows = await Promise.all(
  list.map(async (inst) => {
    const code = String(inst.id).split('.')[0];
    let q: Map<string, number>;
    try { q = await fetchQfq(code); } catch (e: any) { return { code, name: inst.name, err: String(e?.message || e) }; }
    const bars = inst.bars.filter(() => !inst.syntheticBars);
    const paired: { d: string; lc: number; qc: number }[] = [];
    for (const b of bars) {
      if (b.tradeDate < FROM) continue;
      const qc = q.get(b.tradeDate);
      if (qc && qc > 0) paired.push({ d: b.tradeDate, lc: b.close, qc });
    }
    if (paired.length < 10) return { code, name: inst.name, err: `匹配不足 ${paired.length}/${bars.length}` };
    const bad: { d: string; diff: number; lr: number; qr: number }[] = [];
    for (let i = 1; i < paired.length; i++) {
      const lr = (paired[i].lc / paired[i - 1].lc - 1) * 100;
      const qr = (paired[i].qc / paired[i - 1].qc - 1) * 100;
      const diff = lr - qr;
      if (Math.abs(diff) > DIFF_THRESHOLD) bad.push({ d: paired[i].d, diff, lr, qr });
    }
    const first = paired[0], last = paired[paired.length - 1];
    return { code, name: inst.name, n: paired.length, bad, drift: (last.lc / last.qc) / (first.lc / first.qc) - 1 };
  })
);

const broken = rows.filter((r: any) => r.bad?.length);
const ok = rows.filter((r: any) => !r.bad?.length);
const err = rows.filter((r: any) => r.err);

console.log('=== ❌ 有污染的标的 ===');
for (const r of broken as any[]) {
  console.log(`\n${r.code} ${r.name} | 匹配 ${r.n} 日 | 比值累计漂移 ${(r.drift * 100).toFixed(2)}% | 污染日 ${r.bad.length} 个`);
  console.log('  ' + r.bad.slice(0, 12).map((b: any) => `${b.d}(本地${b.lr.toFixed(1)}%/腾讯${b.qr.toFixed(1)}%)`).join('  '));
  if (r.bad.length > 12) console.log(`  ... 另有 ${r.bad.length - 12} 个`);
}

console.log('\n=== ✅ 健康 ===');
console.log(ok.map((r: any) => `${r.code}(漂移${(r.drift * 100).toFixed(2)}%)`).join('  '));

if (err.length) {
  console.log('\n=== ⚠️ 无法核对（腾讯无数据/匹配不足）===');
  for (const r of err as any[]) console.log(`${r.code} ${r.name}: ${r.err}`);
}
