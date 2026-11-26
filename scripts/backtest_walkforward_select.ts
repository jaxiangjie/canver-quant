/**
 * 干净版 walk-forward 回测：每月月初按【当时可见的】标量重选前 10，规则化换仓。
 * 无未来信息：选标的、算标量、定权重全部只用截至当日的数据。
 * 规则：composite ≥ +2 且 close > MA250，按标量降序取前 10；等权 1/10（变体：波动率倒数定权）。
 * 成本：换手 × 0.25%（佣金+印花税+滑点近似）。
 * 用法：node_modules/.bin/tsx scripts/backtest_walkforward_select.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const RF = 0.022;
const FEE = 0.0025;          // 单边成本近似（佣金+印花税+滑点）
const TOP_N = 10;
const MIN_SCALAR = 2;        // 入选门槛（与卡弗死区一致）
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const emaOf = (v: number[], span: number) => { const a = 2 / (span + 1); const o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(a * v[i] + (1 - a) * o[i - 1]); return o; };

function scalarSeries(bars: any[]): Map<string, { s: number; pass: boolean }> {
  const closes = bars.map(b => b.close);
  const f8 = emaOf(closes, 8), f16 = emaOf(closes, 16), f32 = emaOf(closes, 32);
  const s16 = emaOf(closes, 32), s64 = emaOf(closes, 64), s128 = emaOf(closes, 128);
  // 注意：8/32、16/64、32/128 的 slow 分别是 32/64/128
  const tr: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const pc = i > 0 ? bars[i - 1].close : bars[i].close;
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  const out = new Map<string, { s: number; pass: boolean }>();
  for (let i = 128; i < bars.length; i++) {
    const atr = i >= 20 ? mean(tr.slice(i - 19, i + 1)) : bars[i].close * 0.02;
    const useAtr = atr / bars[i].close > 0.25 ? bars[i].close * 0.02 : Math.max(0.001, atr);
    const e1 = Math.max(-20, Math.min(20, ((f8[i] - s16[i]) / useAtr * 4.2)));
    const e2 = Math.max(-20, Math.min(20, ((f16[i] - s64[i]) / useAtr * 4.2)));
    const e3 = Math.max(-20, Math.min(20, ((f32[i] - s128[i]) / useAtr * 4.2)));
    const comp = e1 * 0.4 + e2 * 0.35 + e3 * 0.25;
    const ma250 = i >= 249 ? mean(closes.slice(i - 249, i + 1)) : NaN;
    out.set(bars[i].tradeDate, { s: Number(comp.toFixed(1)), pass: Number.isFinite(ma250) ? closes[i] > ma250 : false });
  }
  return out;
}

function volSeries(bars: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 60; i < bars.length; i++) {
    const rets: number[] = [];
    for (let j = i - 59; j <= i; j++) rets.push(Math.log(bars[j].close / bars[j - 1].close));
    const m = mean(rets);
    out.set(bars[i].tradeDate, Math.sqrt(mean(rets.map(r => (r - m) ** 2)) * DAYS));
  }
  return out;
}

interface Leg { code: string; name: string; close: Map<string, number>; scalar: Map<string, { s: number; pass: boolean }>; vol: Map<string, number>; isETF: boolean }

async function buildLegs(): Promise<Leg[]> {
  const pool = await loadRealUniverse();
  const legs: Leg[] = [];
  for (const i of pool) {
    const bars: any[] = (i as any).bars;
    if (!bars || bars.length < 300) continue;
    legs.push({ code: i.code, name: i.name, close: new Map(bars.map(b => [b.tradeDate, b.close])), scalar: scalarSeries(bars), vol: volSeries(bars), isETF: i.isETF });
  }
  let rows: any[] = [];
  for (let k = 0; k < 2; k++) {
    try { rows = await fetchTencentHfqDaily('511260', 2800); if (rows.length) break; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (rows?.length > 300) {
    const bars = rows;
    legs.push({ code: '511260.SH', name: '十年国债ETF', close: new Map(bars.map(b => [b.tradeDate, b.close])), scalar: scalarSeries(bars), vol: volSeries(bars), isETF: true });
  }
  return legs;
}

function run(legs: Leg[], dates: string[], mode: 'equal' | 'invVol') {
  let nav = 1; const eq: { d: string; v: number }[] = []; const dailyRets: number[] = [];
  let weights: Record<string, number> = {}; let lastMonth = ''; let rebalances = 0; let totalTurnover = 0;
  const history: { d: string; picks: string[] }[] = [];

  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], pd = dates[i - 1];
    // 月初重选
    const month = d.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      const cands = legs.filter(l => {
        const sc = l.scalar.get(d);
        return sc && sc.pass && sc.s >= MIN_SCALAR && l.close.has(d) && l.vol.has(d);
      }).sort((a, b) => (b.scalar.get(d)!.s) - (a.scalar.get(d)!.s)).slice(0, TOP_N);

      const newW: Record<string, number> = {};
      if (mode === 'equal') {
        for (const c of cands) newW[c.code] = 1 / cands.length;
      } else {
        const invs = cands.map(c => ({ c, iv: 1 / c.vol.get(d)! }));
        const sum = invs.reduce((s, x) => s + x.iv, 0);
        for (const x of invs) newW[x.c.code] = x.iv / sum;
      }
      let turnover = 0;
      for (const k of new Set([...Object.keys(newW), ...Object.keys(weights)])) {
        turnover += Math.abs((newW[k] ?? 0) - (weights[k] ?? 0));
      }
      totalTurnover += turnover;
      nav *= 1 - turnover * FEE;                    // 换手成本
      weights = newW;
      rebalances++;
      history.push({ d, picks: cands.map(c => c.name) });
    }

    // 当日收益
    let r = 0; let invested = 0;
    for (const [code, w] of Object.entries(weights)) {
      const leg = legs.find(l => l.code === code)!;
      const a = leg.close.get(pd), b = leg.close.get(d);
      if (a && b && a > 0) { r += w * (b / a - 1); invested += w; }
    }
    r += (1 - invested) * (RF / DAYS);              // 空仓部分吃无风险利率
    nav *= 1 + r; dailyRets.push(r); eq.push({ d, v: nav });
  }

  const yrs = eq.length / DAYS;
  const cagr = (Math.pow(nav, 1 / yrs) - 1) * 100;
  const m = mean(dailyRets);
  const vol = Math.sqrt(mean(dailyRets.map(x => (x - m) ** 2)) * DAYS) * 100;
  const sharpe = vol > 0 ? (cagr - RF * 100) / vol : 0;
  let peak = 1, mdd = 0;
  for (const p of eq) { peak = Math.max(peak, p.v); mdd = Math.min(mdd, p.v / peak - 1); }
  return { cagr, vol, sharpe, mdd: mdd * 100, nav, start: eq[0]?.d, end: eq[eq.length - 1]?.d, rebalances, avgTurnover: totalTurnover / rebalances, history };
}

async function main() {
  console.log('构建数据（池内 22 只 + 十年国债 511260）…');
  const legs = await buildLegs();
  console.log(`可用 ${legs.length} 只`);
  const dateSet = new Set<string>();
  for (const l of legs) for (const d of l.close.keys()) dateSet.add(d);
  const dates = Array.from(dateSet).sort();

  for (const mode of ['equal', 'invVol'] as const) {
    const r = run(legs, dates, mode);
    console.log(`\n===== walk-forward 每月重选前${TOP_N}（${mode === 'equal' ? '等权' : '波动率倒数定权'}）=====`);
    console.log(`样本期 ${r.start} → ${r.end}｜${r.rebalances} 次月度重选｜月均换手 ${r.avgTurnover.toFixed(2)}`);
    console.log(`年化 ${r.cagr.toFixed(2)}% | 波动 ${r.vol.toFixed(2)}% | 夏普 ${r.sharpe.toFixed(2)} | 最大回撤 ${r.mdd.toFixed(2)}% | 期末净值 ${r.nav.toFixed(3)}`);
    // 抽样打印近几年的入选名单
    for (const h of [r.history[0], r.history[Math.floor(r.history.length / 2)], r.history[r.history.length - 1]]) {
      if (h) console.log(`  ${h.d}: ${h.picks.join('、') || '(全现金)'}`);
    }
  }
  // 分段样本：池子成型后（2015 起 / 2018 起）
  for (const start of ['2015-01-01', '2018-01-01']) {
    const ds = dates.filter(d => d >= start);
    const r1 = run(legs, ds, 'equal');
    const r2 = run(legs, ds, 'invVol');
    console.log(`\n===== 起点重置 ${start.slice(0,4)}（等权 | 波动率倒数）=====`);
    const line = (t: string, r: ReturnType<typeof run>) =>
      console.log(`  ${t}	年化 ${r.cagr.toFixed(2)}%\t波动 ${r.vol.toFixed(2)}%\t夏普 ${r.sharpe.toFixed(2)}\t回撤 ${r.mdd.toFixed(2)}%\t期末 ${r.nav.toFixed(2)}\t月均换手 ${r.avgTurnover.toFixed(2)}`);
    line('等权', r1); line('倒权', r2);
    console.log(`  样本 ${r1.start} → ${r1.end}｜${r1.rebalances} 次重选`);
    for (const h of r1.history.slice(0, 3)) console.log(`  ${h.d}: ${h.picks.slice(0, 6).join('、')}${h.picks.length > 6 ? ` …共${h.picks.length}只` : ''}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
