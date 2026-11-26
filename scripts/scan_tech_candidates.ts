/**
 * 科技类候选标的：标量 + 与现有8只组合的相关度。
 * 腾讯 hfq 定稿口径，完整ATR（max(H-L,|H-pc|,|L-pc|)），与 computeEWMAC 一致。
 * 用法：node_modules/.bin/tsx scripts/scan_tech_candidates.ts
 */
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import { calculatePearsonCorrelation } from '../src/services/correlationEngine';

const TARGETS = [
  { code: '600660', name: '福耀玻璃' },
  { code: '002223', name: '鱼跃医疗' },
  { code: '002714', name: '牧原(对照)' },
  { code: '000333', name: '美的(对照)' },
  { code: '601088', name: '神华(对照)' },
];

const ema = (v: number[], span: number) => {
  const a = 2 / (span + 1);
  const out = [v[0]];
  for (let i = 1; i < v.length; i++) out.push(a * v[i] + (1 - a) * out[i - 1]);
  return out;
};
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
function ewmac(cl: number[], fast: number, slow: number, atr: number) {
  if (cl.length < slow) return 0;
  const f = ema(cl, fast), s = ema(cl, slow);
  const diff = f[f.length - 1] - s[s.length - 1];
  const ratio = atr / cl[cl.length - 1];
  const useAtr = ratio > 0.25 ? cl[cl.length - 1] * 0.02 : Math.max(0.001, atr);
  return Math.max(-20, Math.min(20, Number(((diff / useAtr) * 4.2).toFixed(1))));
}
function label(s: number) {
  if (s >= 15) return '强烈看多';
  if (s >= 6) return '看多';
  if (s >= 2) return '偏多';
  if (s > -2) return '中性';
  if (s > -6) return '偏空';
  if (s > -15) return '看空';
  return '强烈看空';
}

type Bar = { date: string; close: number; high: number; low: number };
async function fetchBars(code: string): Promise<Bar[]> {
  for (let k = 0; k < 3; k++) {
    try {
      const rows = await fetchTencentHfqDaily(code, 320);
      if (rows?.length > 130) return rows.map(r => ({ date: r.tradeDate, close: r.close, high: r.high, low: r.low }));
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 800));
  }
  return [];
}
function scalarOf(bars: Bar[]) {
  const cl = bars.map(b => b.close);
  const tr = [cl[0]];
  for (let i = 1; i < cl.length; i++) {
    const pc = cl[i - 1];
    tr.push(Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc)));
  }
  const atr = mean(tr.slice(-20));
  const e8 = ewmac(cl, 8, 32, atr), e16 = ewmac(cl, 16, 64, atr), e32 = ewmac(cl, 32, 128, atr);
  const composite = Number((e8 * 0.4 + e16 * 0.35 + e32 * 0.25).toFixed(1));
  const ma250 = cl.length >= 250 ? mean(cl.slice(-250)) : NaN;
  const chg20 = ((cl[cl.length-1] / cl[cl.length-21]) - 1) * 100;
  return { e8, e16, e32, composite, pass: Number.isFinite(ma250) ? cl[cl.length-1] > ma250 : null, chg20 };
}
function corrOf(a: Bar[], b: Bar[], days: number) {
  const ma = new Map(a.map(x => [x.date, x.close]));
  const mb = new Map(b.map(x => [x.date, x.close]));
  const ra: number[] = [], rb: number[] = [];
  const datesA = a.map(x => x.date).filter(d => ma.has(d) && mb.has(d)).sort();
  for (let i = 1; i < datesA.length; i++) {
    const d = datesA[i], p = datesA[i - 1];
    ra.push(ma.get(d)! / ma.get(p)! - 1);
    rb.push(mb.get(d)! / mb.get(p)! - 1);
  }
  const n = Math.min(days, ra.length);
  return calculatePearsonCorrelation(ra.slice(-n), rb.slice(-n));
}

async function main() {
  const data = new Map<string, Bar[]>();
  for (const t of TARGETS) data.set(t.code, await fetchBars(t.code));

  console.log('name\tcode\te8/32\te16/64\te32/128\tcomposite\t判读\tMA250\t20日');
  for (const t of TARGETS) {
    const bars = data.get(t.code)!;
    if (bars.length < 130) { console.log(`${t.name}\tFAIL ${bars.length}根`); continue; }
    const s = scalarOf(bars);
    console.log(`${t.name}\t${t.code}\t${s.e8}\t${s.e16}\t${s.e32}\t${s.composite}\t${label(s.composite)}\t${s.pass === null ? 'n/a' : s.pass ? 'Y' : 'N'}\t${s.chg20.toFixed(1)}%`);
  }

  console.log('\n=== 与纳指/红利/黄金 相关度（60日 / 250日）===');
  const base = [['513100', '纳指'], ['512890', '红利'], ['518880', '黄金'], ['511260', '国债'], ['002714', '牧原'], ['000333', '美的'], ['601088', '神华']];
  for (const [bc, bn] of base) {
    if (!data.has(bc)) data.set(bc, await fetchBars(bc));
  }
  for (const t of TARGETS) {
    if (t.code === '513100') continue;
    const b = data.get(t.code)!;
    if (b.length < 60) continue;
    const parts: string[] = [];
    for (const [bc, bn] of base) {
      const ob = data.get(bc)!;
      if (ob.length < 60) continue;
      parts.push(`${bn} ${corrOf(b, ob, 60).toFixed(2)}/${corrOf(b, ob, 250).toFixed(2)}`);
    }
    console.log(`${t.name.padEnd(16)} ${parts.join('  ')}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
