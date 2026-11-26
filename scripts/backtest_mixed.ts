/**
 * 混合版组合回测：静态权重（月度再平衡）+ Carver 动态，对比沪深300。
 * 数据源：东财 hfq 日线（fqt=2）；失败时回退腾讯 hfq。
 * 用法：node_modules/.bin/tsx scripts/backtest_mixed.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const RF = 0.022;

type Sec = { secid: string; code: string; name: string; isETF: boolean; cat: any; w: number };

// w = 目标权重（17 万口径：国债7 银行3 海控1.5 美的1.5 国投1.5 现金2.5）
const MIXED: Sec[] = [
  { secid: '1.511260', code: '511260.SH', name: '十年国债ETF', isETF: true, cat: 'bond_etf', w: 7 / 17 },
  { secid: '1.512800', code: '512800.SH', name: '银行ETF', isETF: true, cat: 'sector_etf', w: 3 / 17 },
  { secid: '1.601919', code: '601919.SH', name: '中远海控', isETF: false, cat: 'stock_cn', w: 1.5 / 17 },
  { secid: '0.000333', code: '000333.SZ', name: '美的集团', isETF: false, cat: 'stock_cn', w: 1.5 / 17 },
  { secid: '1.600886', code: '600886.SH', name: '国投电力', isETF: false, cat: 'stock_cn', w: 1.5 / 17 },
];
const CASH_W = 2.5 / 17;

function emaOf(v: number[], span: number) { const a = 2 / (span + 1); const o = [v[0]]; for (let i = 1; i < v.length; i++) o.push(a * v[i] + (1 - a) * o[i - 1]); return o; }
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

async function fetchBars(code: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const rows = await fetchTencentHfqDaily(code, 2800);
      if (rows && rows.length) {
        return rows.map(r => `${r.tradeDate},${r.open},${r.close},${r.high},${r.low},${r.volume},${r.amount}`);
      }
    } catch (e: any) { console.log(`    retry ${code}: ${e?.message ?? e}`); }
    await new Promise(res => setTimeout(res, 1200));
  }
  return [];
}

function toInstrument(s: Sec, kl: string[]): AShareInstrument | null {
  if (kl.length < 260) return null;
  const rows = kl.map(k => { const p = k.split(','); return { d: p[0], o: +p[1], c: +p[2], h: +p[3], l: +p[4], v: +p[5], a: +p[6] }; });
  const tr: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const pc = i > 0 ? rows[i - 1].c : rows[i].c;
    tr.push(Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - pc), Math.abs(rows[i].l - pc)));
  }
  const bars = rows.map((r, i) => {
    const atr20 = i >= 20 ? Number(mean(tr.slice(i - 19, i + 1)).toFixed(3)) : undefined;
    const ma20 = i >= 19 ? Number(mean(rows.slice(i - 19, i + 1).map(x => x.c)).toFixed(3)) : undefined;
    const ma60 = i >= 59 ? Number(mean(rows.slice(i - 59, i + 1).map(x => x.c)).toFixed(3)) : undefined;
    const ma250 = i >= 249 ? Number(mean(rows.slice(i - 249, i + 1).map(x => x.c)).toFixed(3)) : undefined;
    const pc = i > 0 ? rows[i - 1].c : r.c;
    return {
      tradeDate: r.d, open: r.o, high: r.h, low: r.l, close: r.c, preClose: pc,
      volume: r.v, amount: r.a, turnover: 0,
      changePct: Number((((r.c / pc) - 1) * 100).toFixed(2)),
      ma20, ma60, ma250, atr20,
    } as any;
  });
  const last = bars[bars.length - 1];
  const rets: number[] = [];
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i++) rets.push(Math.log(bars[i].close / bars[i - 1].close));
  const vol = Math.sqrt(mean(rets.map(r => (r - mean(rets)) ** 2)) * DAYS);
  return {
    id: s.code, code: s.code, name: s.name, category: s.cat, isETF: s.isETF,
    isT0: s.isETF, stampDutyExempt: s.isETF,
    currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol,
    dataSource: 'parquet', bars, riskBudgetWeight: s.w, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

/** 静态权重 + 月度再平衡 */
function staticBacktest(seriesMap: Map<string, Map<string, number>>, dates: string[], weights: Record<string, number>) {
  const eq: { d: string; v: number }[] = [];
  let nav = 1; let lastRebalMonth = ''; const w: Record<string, number> = { ...weights };
  const dailyRets: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], pd = dates[i - 1];
    let r = 0; let ok = true;
    for (const code of Object.keys(weights)) {
      if (code === 'CASH') continue;
      const a = seriesMap.get(code)?.get(pd), b = seriesMap.get(code)?.get(d);
      if (!(a && b && a > 0)) { ok = false; break; }
      r += w[code] * (b / a - 1);
    }
    if (!ok) continue;
    r += (w['CASH'] ?? 0) * (RF / DAYS);
    nav *= 1 + r; dailyRets.push(r); eq.push({ d, v: nav });
    // 月度再平衡：回到目标权重
    const m = d.slice(0, 7);
    if (m !== lastRebalMonth) {
      lastRebalMonth = m;
      for (const code of Object.keys(weights)) w[code] = weights[code];
    }
  }
  const yrs = eq.length / DAYS;
  const cagr = (Math.pow(nav, 1 / yrs) - 1) * 100;
  const vol = Math.sqrt(mean(dailyRets.map(x => (x - mean(dailyRets)) ** 2)) * DAYS) * 100;
  const sharpe = vol > 0 ? (cagr - RF * 100) / vol : 0;
  let peak = 1, mdd = 0;
  for (const p of eq) { peak = Math.max(peak, p.v); mdd = Math.min(mdd, p.v / peak - 1); }
  return { cagr, vol, sharpe, mdd: mdd * 100, final: nav, start: eq[0]?.d, end: eq[eq.length - 1]?.d, n: eq.length };
}

const CUT = '2017-08-24'; // 511260 上市日：全部标的共同可用起点
function trim(inst: AShareInstrument): AShareInstrument {
  const bars = (inst as any).bars.filter((b: any) => b.tradeDate >= CUT);
  const last = bars[bars.length - 1];
  return { ...inst, bars, currentPrice: last.close, preClose: last.preClose,
    changePct: last.changePct, dailyATR: last.atr20 ?? last.close * 0.02,
    barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
}

async function main() {
  console.log('拉取数据…');
  const insts: AShareInstrument[] = [];
  const local = await loadRealUniverse();
  for (const s of MIXED) {
    const inPool = local.find(i => i.code === s.code);
    if (inPool && (inPool as any).bars?.length > 260) {
      console.log(`  ✓ ${s.name} 取自池内 ${(inPool as any).bars.length} 根 ${(inPool as any).bars[0].tradeDate} → ${(inPool as any).bars.at(-1).tradeDate}`);
      insts.push({ ...inPool, riskBudgetWeight: s.w } as AShareInstrument);
      continue;
    }
    const kl = await fetchBars(s.code);
    const inst = toInstrument(s, kl);
    if (!inst) { console.log(`  ✗ ${s.name} 数据不足 (${kl.length})`); continue; }
    console.log(`  ✓ ${s.name} ${inst.bars!.length} 根 ${inst.bars![0].tradeDate} → ${inst.bars![inst.bars!.length - 1].tradeDate}`);
    insts.push(inst);
  }
  if (insts.length < 4) { console.log('可用标的不足，退出'); return; }
  for (let i = 0; i < insts.length; i++) insts[i] = trim(insts[i]);
  console.log(`\n统一样本起点 ${CUT}，各腿根数：` + insts.map(i => `${i.name}${(i as any).bars.length}`).join(' '));

  // 1) 静态混合组合
  const seriesMap = new Map<string, Map<string, number>>();
  const dateSet = new Set<string>();
  for (const i of insts) {
    const m = new Map<string, number>();
    for (const b of i.bars!) { m.set(b.tradeDate, b.close); dateSet.add(b.tradeDate); }
    seriesMap.set(i.code, m);
  }
  const dates = Array.from(dateSet).sort();
  const weights: Record<string, number> = { CASH: CASH_W };
  for (const s of MIXED) if (insts.find(i => i.code === s.code)) weights[s.code] = s.w;
  const tot = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(weights)) weights[k] /= tot;

  const st = staticBacktest(seriesMap, dates, weights);
  console.log('\n========== 静态混合组合（月度再平衡）==========');
  console.log(`样本期 ${st.start} → ${st.end}（${st.n} 交易日 / ${(st.n / DAYS).toFixed(1)} 年）`);
  console.log(`年化 ${st.cagr.toFixed(2)}% | 年化波动 ${st.vol.toFixed(2)}% | 夏普 ${st.sharpe.toFixed(2)} | 最大回撤 ${st.mdd.toFixed(2)}% | 期末净值 ${st.final.toFixed(3)}`);

  // 2) Carver 动态（同 6 只标的，引擎按标量定仓）
  console.log('\n========== Carver 动态（同标的集）==========');
  const bt = await runRealBacktest(insts, { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 }, { minHistoryBars: 252 });
  const m = bt.metrics;
  console.log(`样本期 ${m.startDate} → ${m.endDate}（${m.rebalanceCount} 次再平衡）`);
  for (const [k, label] of [['carver', '卡弗策略'], ['equalWeight', '等权持有'], ['csi300', '沪深300']] as const) {
    const s = (m as any)[k];
    console.log(`${label}\t年化 ${s.cagrPct.toFixed(2)}% | 波动 ${s.annVolPct.toFixed(2)}% | 夏普 ${s.sharpe.toFixed(2)} | 回撤 ${s.maxDrawdownPct.toFixed(2)}% | 期末 ${s.finalEquity.toFixed(3)}`);
  }

  // 3) 对照：现有 22 只池的 Carver
  console.log('\n========== 对照：池内 22 只全量 Carver =========');
  const all = await loadRealUniverse();
  const bt2 = await runRealBacktest(all, { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 }, { minHistoryBars: 252 });
  const m2 = bt2.metrics;
  console.log(`样本期 ${m2.startDate} → ${m2.endDate}（${m2.rebalanceCount} 次）`);
  console.log(`卡弗  年化 ${m2.carver.cagrPct.toFixed(2)}% | 波动 ${m2.carver.annVolPct.toFixed(2)}% | 夏普 ${m2.carver.sharpe.toFixed(2)} | 回撤 ${m2.carver.maxDrawdownPct.toFixed(2)}%`);
  console.log(`沪深300 年化 ${m2.csi300.cagrPct.toFixed(2)}% | 波动 ${m2.csi300.annVolPct.toFixed(2)}% | 夏普 ${m2.csi300.sharpe.toFixed(2)} | 回撤 ${m2.csi300.maxDrawdownPct.toFixed(2)}%`);
  // 4) 归因：各腿单独表现（同区间）
  console.log('\n========== 单腿归因（同区间）==========');
  for (const inst of insts) {
    const m1 = new Map<string, number>();
    for (const b of (inst as any).bars) m1.set(b.tradeDate, b.close);
    const single = staticBacktest(new Map([[inst.code, m1]]), dates, { [inst.code]: 1 });
    console.log(`${inst.name.padEnd(8)} 年化 ${single.cagr.toFixed(2)}% | 波动 ${single.vol.toFixed(2)}% | 夏普 ${single.sharpe.toFixed(2)} | 回撤 ${single.mdd.toFixed(2)}%`);
  }

  // 5) 纯股票版（剔除国债，剩余权重重分配）
  const noBond: Record<string, number> = {};
  for (const s2 of MIXED) if (s2.code !== '511260.SH') noBond[s2.code] = s2.w;
  const ssum = Object.values(noBond).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(noBond)) noBond[k] /= ssum;
  const st2 = staticBacktest(seriesMap, dates, noBond);
  console.log('\n========== 纯股票版（剔除国债，权重重分配）==========');
  console.log(`年化 ${st2.cagr.toFixed(2)}% | 波动 ${st2.vol.toFixed(2)}% | 夏普 ${st2.sharpe.toFixed(2)} | 回撤 ${st2.mdd.toFixed(2)}%`);

  // 6) 基准：沪深300ETF 510300
  const hsPool = await loadRealUniverse();
  const hs = hsPool.find(i => i.code === '510300.SH');
  if (hs) {
    const m3 = new Map<string, number>();
    for (const b of (hs as any).bars) if (b.tradeDate >= CUT) m3.set(b.tradeDate, b.close);
    const st3 = staticBacktest(new Map([['510300', m3]]), dates, { '510300': 1 });
    console.log(`\n========== 基准 沪深300ETF 510300 ==========`);
    console.log(`年化 ${st3.cagr.toFixed(2)}% | 波动 ${st3.vol.toFixed(2)}% | 夏普 ${st3.sharpe.toFixed(2)} | 回撤 ${st3.mdd.toFixed(2)}%`);
  }
  // 7) 无选择偏差对照：2017-08-24 已上市的池内标的等权
  const avail = hsPool.filter(i => (i as any).bars?.[0]?.tradeDate <= CUT && (i as any).bars.some((b: any) => b.tradeDate >= CUT));
  const eqMap = new Map<string, Map<string, number>>();
  const eqW: Record<string, number> = {};
  for (const i of avail) {
    const m = new Map<string, number>();
    for (const b of (i as any).bars) if (b.tradeDate >= CUT) m.set(b.tradeDate, b.close);
    if (m.size > 100) { eqMap.set(i.code, m); eqW[i.code] = 1; }
  }
  const n = Object.keys(eqW).length;
  for (const k of Object.keys(eqW)) eqW[k] = 1 / n;
  const st4 = staticBacktest(eqMap, dates, eqW);
  console.log(`\n========== 无选择偏差对照：2017年已上市的池内 ${n} 只等权 ==========`);
  console.log(avail.map(i => i.name).join('、'));
  console.log(`年化 ${st4.cagr.toFixed(2)}% | 波动 ${st4.vol.toFixed(2)}% | 夏普 ${st4.sharpe.toFixed(2)} | 回撤 ${st4.mdd.toFixed(2)}%`);
  // 8) 国债权重敏感性扫描
  console.log('\n========== 国债权重扫描（其余腿按比例缩放）==========');
  console.log('国债占比\t年化\t波动\t夏普\t最大回撤');
  const bondW = MIXED[0].w; // 7/17
  const others = MIXED.slice(1);
  for (const target of [0, 0.2, 0.3, 0.41, 0.5, 0.6, 0.71]) {
    const w: Record<string, number> = { CASH: CASH_W * (1 - target) / (1 - bondW) };
    if (target > 0) w['511260.SH'] = target;
    const restW = 1 - target - (w['CASH'] ?? 0);
    const restBase = others.reduce((a, x) => a + x.w, 0);
    for (const o of others) w[o.code] = restW * (o.w / restBase);
    const r1 = staticBacktest(seriesMap, dates, w);
    console.log(`${(target * 100).toFixed(0)}%\t${r1.cagr.toFixed(2)}%\t${r1.vol.toFixed(2)}%\t${r1.sharpe.toFixed(2)}\t${r1.mdd.toFixed(2)}%`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
