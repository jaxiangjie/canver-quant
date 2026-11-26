/**
 * 独立计算任意 A 股 / ETF 的 Carver EWMAC 标量（与项目 computeEWMAC 同口径）。
 * 数据源：东财 hfq 日线（fqt=2）。
 * 用法：node_modules/.bin/tsx scripts/calc_etf_scalar.ts 561560 159611 159625 516160
 */
const TARGETS: { secid: string; name: string }[] = [
  { secid: '1.601857', name: '中国石油(对照)' },
  { secid: '1.600938', name: '中国海油' },
  { secid: '1.600028', name: '中国石化' },
  { secid: '1.601808', name: '中海油服' },
  { secid: '1.600026', name: '中远海能' },
  { secid: '1.501018', name: '南方原油ETF' },
  { secid: '0.159518', name: '油气ETF' },
  { secid: '1.601088', name: '中国神华(对照)' },
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

async function one(secid: string, name: string) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=2&lmt=400&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j: any = await r.json();
  const kl: string[] = j?.data?.klines ?? [];
  if (kl.length < 130) return { name, err: `仅 ${kl.length} 根` };

  const op: number[] = [], cl: number[] = [], hi: number[] = [], lo: number[] = [];
  for (const k of kl) {
    const p = k.split(',');
    op.push(+p[1]); cl.push(+p[2]); hi.push(+p[3]); lo.push(+p[4]);
  }
  const tr: number[] = [];
  for (let i = 0; i < cl.length; i++) {
    const pc = i > 0 ? cl[i - 1] : cl[i];
    tr.push(Math.max(hi[i] - lo[i], Math.abs(hi[i] - pc), Math.abs(lo[i] - pc)));
  }
  const atr = mean(tr.slice(-20));
  const e8 = ewmac(cl, 8, 32, atr), e16 = ewmac(cl, 16, 64, atr), e32 = ewmac(cl, 32, 128, atr);
  const composite = Number((e8 * 0.4 + e16 * 0.35 + e32 * 0.25).toFixed(1));
  const ma250 = cl.length >= 250 ? mean(cl.slice(-250)) : NaN;
  const lastClose = cl[cl.length - 1];
  return {
    name, date: kl[kl.length - 1].split(',')[0], close: lastClose,
    e8, e16, e32, composite, label: label(composite),
    ma250: Number.isFinite(ma250) ? ma250 : null,
    pass: Number.isFinite(ma250) ? lastClose > ma250 : null,
    chg20: Number((((lastClose / cl[cl.length - 21]) - 1) * 100).toFixed(1)),
  };
}

async function main() {
  console.log('name\tlastBar\tclose\te8/32\te16/64\te32/128\tcomposite\t判读\tMA250\t20日涨跌');
  for (const t of TARGETS) {
    try {
      const r: any = await one(t.secid, t.name);
      if (r.err) { console.log(`${t.name}\t${r.err}`); continue; }
      console.log(`${r.name}\t${r.date}\t${r.close}\t${r.e8}\t${r.e16}\t${r.e32}\t${r.composite}\t${r.label}\t${r.pass === null ? 'n/a' : r.pass ? 'Y' : 'N'}\t${r.chg20}%`);
    } catch (e: any) {
      console.log(`${t.name}\tFAIL ${e?.message ?? e}`);
    }
    await new Promise(res => setTimeout(res, 300));
  }
}

main();
