/**
 * 扫描市场主要 ETF / 标杆个股的 Carver EWMAC 标量，找出「强势但未入池」的标的。
 * 数据源：东财 hfq 日线（fqt=2）。与项目 computeEWMAC 同口径。
 * 用法：node_modules/.bin/tsx scripts/scan_market_scalars.ts
 */
type T = { secid: string; name: string; group: string };

// 池内已有的 22 只不重复扫描
const TARGETS: T[] = [
  // 宽基
  { secid: '1.510050', name: '上证50ETF', group: '宽基' },
  { secid: '1.512100', name: '中证1000ETF', group: '宽基' },
  { secid: '0.159915', name: '创业板ETF', group: '宽基' },
  { secid: '1.512050', name: '中证A500ETF', group: '宽基' },
  { secid: '0.159949', name: '创业板50ETF', group: '宽基' },
  { secid: '1.563300', name: '中证2000ETF', group: '宽基' },
  // 红利 / 价值
  { secid: '1.510880', name: '红利ETF', group: '红利' },
  { secid: '0.159545', name: '恒生红利低波ETF', group: '红利' },
  { secid: '1.515180', name: '红利ETF易方达', group: '红利' },
  // 金融
  { secid: '1.512800', name: '银行ETF', group: '金融' },
  { secid: '1.512000', name: '券商ETF', group: '金融' },
  { secid: '1.510230', name: '金融ETF', group: '金融' },
  // 消费 / 医药
  { secid: '0.159928', name: '消费ETF', group: '消费医药' },
  { secid: '1.512690', name: '酒ETF', group: '消费医药' },
  { secid: '0.159996', name: '家电ETF', group: '消费医药' },
  { secid: '1.512010', name: '医药ETF', group: '消费医药' },
  { secid: '0.159992', name: '创新药ETF', group: '消费医药' },
  // 科技 / 成长
  { secid: '1.512480', name: '半导体ETF', group: '科技' },
  { secid: '1.515790', name: '光伏ETF', group: '科技' },
  { secid: '0.159755', name: '电池ETF', group: '科技' },
  { secid: '1.515880', name: '通信ETF', group: '科技' },
  { secid: '0.159819', name: '人工智能ETF', group: '科技' },
  // 周期 / 资源
  { secid: '1.512400', name: '有色金属ETF', group: '周期' },
  { secid: '1.515220', name: '煤炭ETF', group: '周期' },
  { secid: '1.516950', name: '基建ETF', group: '周期' },
  { secid: '0.159980', name: '有色期货ETF', group: '周期' },
  { secid: '1.501018', name: '南方原油', group: '周期' },
  // 债券
  { secid: '1.511260', name: '十年国债ETF', group: '债券' },
  { secid: '1.511090', name: '30年国债ETF', group: '债券' },
  { secid: '1.511220', name: '城投债ETF', group: '债券' },
  // 海外 / 港股
  { secid: '1.513500', name: '标普500ETF', group: '海外' },
  { secid: '1.513030', name: '德国30ETF', group: '海外' },
  { secid: '0.159509', name: '纳指科技ETF', group: '海外' },
  { secid: '1.513050', name: '中概互联ETF', group: '港股' },
  { secid: '0.159920', name: '恒生ETF', group: '港股' },
  { secid: '1.513660', name: '恒生中国企业ETF', group: '港股' },
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
  const last = closes[closes.length - 1];
  const useAtr = atr / last > 0.25 ? last * 0.02 : Math.max(0.001, atr);
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

async function one(t: T) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${t.secid}&klt=101&fqt=2&lmt=400&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const j: any = await r.json();
  const kl: string[] = j?.data?.klines ?? [];
  if (kl.length < 130) return null;
  const cl: number[] = [], hi: number[] = [], lo: number[] = [];
  for (const k of kl) { const p = k.split(','); cl.push(+p[2]); hi.push(+p[3]); lo.push(+p[4]); }
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
    ...t, date: kl[kl.length - 1].split(',')[0], close: lastClose,
    e8, e16, e32, composite, label: label(composite),
    pass: Number.isFinite(ma250) ? lastClose > ma250 : false,
    chg20: Number((((lastClose / cl[cl.length - 21]) - 1) * 100).toFixed(1)),
    chg60: cl.length > 61 ? Number((((lastClose / cl[cl.length - 61]) - 1) * 100).toFixed(1)) : null,
  };
}

async function main() {
  const rows: any[] = [];
  for (const t of TARGETS) {
    try {
      const r = await one(t);
      if (r) rows.push(r); else console.log(`SKIP ${t.name} 数据不足`);
    } catch (e: any) { console.log(`FAIL ${t.name} ${e?.message ?? e}`); }
    await new Promise(res => setTimeout(res, 280));
  }
  rows.sort((a, b) => b.composite - a.composite);

  console.log('\n=== 全部结果（按标量降序）===');
  console.log('标量\t判读\tMA250\t20日\t60日\tgroup\tname\tclose');
  for (const r of rows) {
    console.log(`${r.composite}\t${r.label}\t${r.pass ? 'Y' : 'N'}\t${r.chg20}%\t${r.chg60 ?? 'n/a'}%\t${r.group}\t${r.name}\t${r.close}`);
  }

  const strong = rows.filter(r => r.composite >= 2 && r.pass);
  console.log(`\n=== 强势且站上 MA250（${strong.length} 只）===`);
  for (const r of strong) console.log(`  +${r.composite}\t${r.group}\t${r.name}\t20日 ${r.chg20}%`);
}

main();
