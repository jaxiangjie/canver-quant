/**
 * 长江电力 vs 国投电力：标量 + 相互相关度 + 与红利/神华的相关度。
 * 统一用 fetchTencentHfqDaily（定稿 hfq 口径），避免不同源混用。
 * 用法：node_modules/.bin/tsx scripts/check_power_pair.ts
 */
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import { calculatePearsonCorrelation } from '../src/services/correlationEngine';

const TARGETS = [
  { code: '600900', name: '长江电力' },
  { code: '600886', name: '国投电力' },
  { code: '601985', name: '中国核电' },
  { code: '601088', name: '中国神华' },
  { code: '512890', name: '红利低波' },
  { code: '601919', name: '中远海控' },
  { code: '000333', name: '美的集团' },
  { code: '511260', name: '十年国债' },
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

type Bar = { date: string; close: number };
async function fetchBars(code: string): Promise<Bar[]> {
  for (let k = 0; k < 3; k++) {
    try {
      const rows = await fetchTencentHfqDaily(code, 320);
      if (rows?.length > 130) return rows.map(r => ({ date: r.tradeDate, close: r.close }));
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
    // 腾讯 hfq 无独立 high/low 时退化为 |close - prevClose|，这里用 rows 的 high/low 更准，见下
    tr.push(Math.abs(cl[i] - pc));
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
  const datesA = a.map(x => x.date).filter(d => ma.has(d) && mb.has(d));
  for (let i = 1; i < datesA.length; i++) {
    const d = datesA[i], p = datesA[i - 1];
    if (/^\d{4}-/.test(d) && ma.has(p) && mb.has(p)) {
      ra.push(ma.get(d)! / ma.get(p)! - 1);
      rb.push(mb.get(d)! / mb.get(p)! - 1);
    }
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

  console.log('\n=== 相关度（60日 / 250日）===');
  const pairs: [string, string][] = [
    ['600900', '600886'], ['600900', '601985'],
    ['600900', '512890'], ['600900', '601088'], ['600900', '000333'], ['600900', '601919'],
    ['600886', '512890'], ['600886', '601088'],
    ['601088', '512890'],
  ];
  const name = (c: string) => TARGETS.find(t => t.code === c)?.name ?? c;
  for (const [x, y] of pairs) {
    const bx = data.get(x)!, by = data.get(y)!;
    if (bx.length < 60 || by.length < 60) continue;
    console.log(`${name(x)} ↔ ${name(y)}\t60日 ${corrOf(bx, by, 60).toFixed(3)}\t250日 ${corrOf(bx, by, 250).toFixed(3)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
