/**
 * 反查：用户截图那条净值曲线属于哪个组合、什么口径（2026-10-15）
 * 截图特征：10-13 组合 1.105 (+10.5%) / "沪深300 买入持有" 1.1256 (+12.56%) ← 基准在涨，本池不可能
 * 用法: npx tsx scripts/check_nav_synthetic.ts
 */
import { generateHistoricalBars } from '../src/services/mockData';
import { DEFAULT_BUNDLES } from '../src/services/bundles';

const LOOKBACK = 60;
const BASE = 'http://localhost:3000';
const insts: any[] = await (await fetch(`${BASE}/api/ashare/instruments`)).json();
const byId = new Map(insts.map((i) => [String(i.id), i]));

const r2 = (v: number) => Number(v.toFixed(4));

async function curve(legIds: string[], useSynthetic: boolean) {
  const legs = legIds.map((id) => byId.get(id)).filter((i: any) => i && (i.currentShares || 0) > 0);
  if (legs.length < 1) return null;
  const seriesList: any[] = [];
  for (const inst of legs) {
    const price = Number(inst.currentPrice) || 1;
    const vol = Number(inst.annualizedVol) || 0.18;
    const bars = useSynthetic
      ? generateHistoricalBars(price, vol, 0.05, 'oscillator')
      : ((await (await fetch(`${BASE}/api/ashare/bars/${inst.code}?limit=90`)).json()).bars ?? []);
    const byDate = new Map<string, number>();
    for (const b of bars) if (b?.tradeDate && b.close > 0) byDate.set(b.tradeDate, b.close);
    seriesList.push({ code: inst.code, mv: (inst.currentShares || 0) * price, byDate });
  }
  const totalMv = seriesList.reduce((a, s) => a + s.mv, 0);
  const series = seriesList.map((s) => ({ ...s, weight: s.mv / totalMv }));
  const others = series.slice(1).map((s) => new Set(s.byDate.keys()));
  const common = [...series[0].byDate.keys()].filter((d) => others.every((s) => s.has(d))).sort();
  const win = common.slice(-(LOOKBACK + 1));
  const bench = series.find((s) => s.code === '510300.SH') ?? series[0];

  let nav = 1, csi = 1;
  const trail: { d: string; nav: number; csi: number }[] = [];
  for (let i = 1; i < win.length; i++) {
    let d = 0;
    for (const s of series) {
      const p = s.byDate.get(win[i - 1]); const c = s.byDate.get(win[i]);
      if (p && c && p > 0 && c > 0) d += (c / p - 1) * s.weight;
    }
    nav *= 1 + d;
    const bp = bench.byDate.get(win[i - 1]); const bc = bench.byDate.get(win[i]);
    csi *= 1 + (bp && bc && bp > 0 && bc > 0 ? bc / bp - 1 : 0);
    trail.push({ d: win[i], nav, csi });
  }
  return { win, nav, csi, benchCode: bench.code, legs: legs.length, trail, series, totalMv };
}

for (const b of DEFAULT_BUNDLES) {
  const ids = (b as any).items.map((i: any) => i.id);
  const r = await curve(ids, false);
  if (!r) continue;
  const t = r.trail.find((x) => x.d.endsWith('-10-13')) ?? r.trail[r.trail.length - 1];
  console.log(
    `\n【${(b as any).id}】真实 K 线 · 持仓腿=${r.legs} · 总市值 ¥${Math.round(r.totalMv).toLocaleString()} · 窗口 ${r.win[0]}~${r.win[r.win.length - 1]}`,
  );
  console.log(`  权重构成: ${r.series.map((s: any) => `${s.code.split('.')[0]} ${(s.weight * 100).toFixed(1)}%`).join('  ')}`);
  console.log(
    `  终点 组合 ${r2(r.nav)} (${((r.nav - 1) * 100).toFixed(2)}%)   基准[${r.benchCode}] ${r2(r.csi)} (${((r.csi - 1) * 100).toFixed(2)}%)` +
      `   ·  10-13 组合 ${r2(t.nav)} (${((t.nav - 1) * 100).toFixed(2)}%)`,
  );
}
console.log('\n（用户截图：10-13 组合 1.105 / 基准 1.1256 —— 那是调仓前的持仓；23:24 已执行调仓，故现值不同）');
