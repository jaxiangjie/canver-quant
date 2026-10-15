/**
 * 「风险与净值动态分析 → 组合净值曲线」验证 + 与界面对账（2026-10-15）
 * 用法: npx tsx scripts/verify_nav_curve_fix.ts
 *
 * ⚠️ 价格必须用**市价**口径：loadRealUniverse() 的 currentPrice 是后复权价（福耀 5286 vs 市价 54.5），
 * 拿它算权重会让权重严重失真（首版脚本因此算出 +0.64%，而界面是 −4.85%）。
 * 这里直接用 /api/ashare/instruments + /api/ashare/bars?limit=90（= 界面同源），结果必须与界面一致。
 */
const LOOKBACK = 60;
const BASE = 'http://localhost:3000';

const insts: any[] = await (await fetch(`${BASE}/api/ashare/instruments`)).json();
const byId = new Map(insts.map((i) => [String(i.id), i]));

// balanced9 的腿（与前端 bundles 顺序一致）
const CODES = ['510300.SH', '510500.SH', '588000.SH', '512890.SH', '601857.SH', '511010.SH', '518880.SH', '513100.SH', '513520.SH'];

const legs: any[] = [];
for (const code of CODES) {
  const inst = insts.find((i) => i.code === code);
  if (!inst) continue;
  const shares = Number(inst.currentShares) || 0;
  if (shares <= 0) continue; // 组件口径：只保留持仓 >0 的腿
  const bars = (await (await fetch(`${BASE}/api/ashare/bars/${code}?limit=90`)).json()).bars ?? [];
  legs.push({ code, shares, price: Number(inst.currentPrice), bars });
}

const totalMv = legs.reduce((a, l) => a + l.shares * l.price, 0);
console.log(`参与腿 ${legs.length} 只（持仓>0），组合总市值 ¥${Math.round(totalMv).toLocaleString()}（= 界面 121.2% 仓位附近）`);
for (const l of legs) console.log(`  ${l.code.padEnd(10)} 市价 ${String(l.price).padStart(8)}  持股 ${String(l.shares).padStart(7)}  市值 ¥${String(Math.round(l.shares * l.price)).padStart(9)}  w=${((l.shares * l.price) / totalMv * 100).toFixed(1)}%`);

// ── NEW 算法（按交易日对齐） ──
const series = legs.map((l) => {
  const byDate = new Map<string, number>();
  for (const b of l.bars) if (b?.tradeDate && b.close > 0) byDate.set(b.tradeDate, b.close);
  return { code: l.code, weight: (l.shares * l.price) / totalMv, byDate };
});
const others = series.slice(1).map((s) => new Set(s.byDate.keys()));
const common = [...series[0].byDate.keys()].filter((d) => others.every((s) => s.has(d))).sort();
const win = common.slice(-(LOOKBACK + 1));
const bench = series.find((s) => s.code === '510300.SH') ?? series[0];

let nav = 1, csi = 1, peak = 1, maxDD = 0;
for (let i = 1; i < win.length; i++) {
  let d = 0;
  for (const s of series) {
    const p = s.byDate.get(win[i - 1]); const c = s.byDate.get(win[i]);
    if (p && c && p > 0 && c > 0) d += (c / p - 1) * s.weight;
  }
  nav *= 1 + d;
  const bp = bench.byDate.get(win[i - 1]); const bc = bench.byDate.get(win[i]);
  csi *= 1 + (bp && bc && bp > 0 && bc > 0 ? bc / bp - 1 : 0);
  peak = Math.max(peak, nav);
  maxDD = Math.min(maxDD, nav / peak - 1);
}
console.log(`\n【NEW 按交易日对齐】共同交易日 ${common.length} 个 → 窗口 ${win[0]} ~ ${win[win.length - 1]}（${win.length - 1} 个交易日）`);
console.log(`  组合累计净值 ${nav.toFixed(4)}（${((nav - 1) * 100).toFixed(2)}%）  基准 ${csi.toFixed(4)}（${((csi - 1) * 100).toFixed(2)}%）  最大回撤 ${(maxDD * 100).toFixed(2)}%`);

console.log('\n────── 收益分解（权重 = 当前市值占比，算术贡献） ──────');
let sum = 0;
for (const s of series) {
  const first = s.byDate.get(win[0])!;
  const last = s.byDate.get(win[win.length - 1])!;
  let contrib = 0;
  for (let i = 1; i < win.length; i++) {
    const p = s.byDate.get(win[i - 1])!; const c = s.byDate.get(win[i])!;
    contrib += s.weight * (c / p - 1);
  }
  sum += contrib;
  console.log(`  ${s.code.padEnd(10)} 权重 ${(s.weight * 100).toFixed(1).padStart(5)}%  区间涨跌 ${(((last / first) - 1) * 100).toFixed(2).padStart(7)}%  贡献 ${(contrib * 100).toFixed(2).padStart(6)}%`);
}
console.log(`  贡献算术合计 ${(sum * 100).toFixed(2)}%  vs  复利结果 ${((nav - 1) * 100).toFixed(2)}%（差额 = 日频再平衡交叉项）`);
console.log(`\n对账：界面 tooltip 显示 10-15 组合净值 0.9515 / 基准 0.8813 → 本脚本 ${nav.toFixed(4)} / ${csi.toFixed(4)}`);
