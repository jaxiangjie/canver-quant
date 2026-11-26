import { fetchTencentHfqDaily } from '../src/services/stagingData';

/**
 * 石油相关候选标的标量（腾讯 hfq 源，口径同 computeEWMAC）。
 * 东财被限流时的替代。用法：node_modules/.bin/tsx scripts/scan_oil_candidates.ts
 */
const TARGETS = [
  { code: '601857', name: '中国石油(对照)' },
  { code: '501018', name: '南方原油LOF' },
  { code: '161129', name: '易方达原油LOF' },
  { code: '160723', name: '嘉实原油LOF' },
  { code: '162411', name: '华宝油气(美股油股)' },
  { code: '159981', name: '能源化工期货ETF' },
  { code: '512400', name: '有色金属ETF' },
  { code: '601088', name: '中国神华(对照)' },
];

const ema = (v: number[], span: number) => {
  const a = 2 / (span + 1);
  const out = [v[0]];
  for (let i = 1; i < v.length; i++) out.push(a * v[i] + (1 - a) * out[i - 1]);
  return out;
};
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

function ewmac(closes: number[], fast: number, slow: number, atr: number) {
  if (closes.length < slow) return 0;
  const f = ema(closes, fast), s = ema(closes, slow);
  const diff = f[f.length - 1] - s[s.length - 1];
  const ratio = atr / closes[closes.length - 1];
  const useAtr = ratio > 0.25 ? closes[closes.length - 1] * 0.02 : Math.max(0.001, atr);
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

async function fetchHfq(code: string): Promise<number[]> {
  for (let k = 0; k < 3; k++) {
    try {
      const rows = await fetchTencentHfqDaily(code, 320);
      if (rows?.length > 130) return rows.map(r => [r.close, r.high, r.low] as any);
    } catch { /* retry */ }
    await new Promise(res => setTimeout(res, 800));
  }
  return [];
}

async function main() {
  console.log('name\tlastBar\tclose\te8/32\te16/64\te32/128\tcomposite\t判读\tMA250\t20日涨跌');
  for (const t of TARGETS) {
    const cl = await fetchHfq(t.code);
    if (cl.length < 130) { console.log(`${t.name}\tFAIL 仅${cl.length}根`); continue; }
    const closes = (cl as any).map((x: any) => Array.isArray(x) ? x[0] : x);
    const highs  = (cl as any).map((x: any) => Array.isArray(x) ? x[1] : x);
    const lows   = (cl as any).map((x: any) => Array.isArray(x) ? x[2] : x);
    const tr: number[] = [closes[0]];
    for (let i = 1; i < closes.length; i++) {
      const pc = closes[i - 1];
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - pc), Math.abs(lows[i] - pc)));
    }
    const atr = mean(tr.slice(-20));
    const e8 = ewmac(closes, 8, 32, atr), e16 = ewmac(closes, 16, 64, atr), e32 = ewmac(closes, 32, 128, atr);
    const composite = Number((e8 * 0.4 + e16 * 0.35 + e32 * 0.25).toFixed(1));
    const ma250 = closes.length >= 250 ? mean(closes.slice(-250)) : NaN;
    const lastClose = closes[closes.length - 1];
    const chg20 = ((lastClose / closes[closes.length - 21]) - 1) * 100;
    console.log(`${t.name}\t${t.code}\t${lastClose.toFixed(2)}\t${e8}\t${e16}\t${e32}\t${composite}\t${label(composite)}\t${Number.isFinite(ma250) ? (lastClose > ma250 ? 'Y' : 'N') : 'n/a'}\t${chg20.toFixed(1)}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
