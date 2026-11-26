/**
 * 7只定稿组合 vs 8只(加牧原)：卡弗工作台引擎对照。
 * 同时统计牧原在回测各期的实际目标仓位，验证"仓位不高所以不影响"的假设。
 * 用法：node_modules/.bin/tsx scripts/backtest_muyuan_effect.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS, calculatePortfolio } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const CUT = '2018-01-01';

// 定稿7只
const V7 = ['512890', '511260', '000333', '601919', '601088', '513100', '518880'];
const MUYUAN = '002714';
const TECH = '600660';

async function buildFromTencent(code: string, name: string, cat: any, w: number): Promise<AShareInstrument | null> {
  let rows: any[] = [];
  for (let i = 0; i < 3; i++) {
    try { rows = await fetchTencentHfqDaily(code, 2800); if (rows.length) break; } catch { /* */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!rows || rows.length < 260) return null;
  const tr: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const pc = i > 0 ? rows[i - 1].close : rows[i].close;
    tr.push(Math.max(rows[i].high - rows[i].low, Math.abs(rows[i].high - pc), Math.abs(rows[i].low - pc)));
  }
  const bars = rows.map((r, i) => {
    const atr20 = i >= 20 ? Number(mean(tr.slice(i - 19, i + 1)).toFixed(3)) : undefined;
    const ma250 = i >= 249 ? Number(mean(rows.slice(i - 249, i + 1).map(x => x.close)).toFixed(3)) : undefined;
    const pc = i > 0 ? rows[i - 1].close : r.close;
    return { tradeDate: r.tradeDate, open: r.open, high: r.high, low: r.low, close: r.close, preClose: pc,
      volume: r.volume, amount: r.amount, turnover: 0,
      changePct: Number((((r.close / pc) - 1) * 100).toFixed(2)), ma250, atr20 } as any;
  });
  const last = bars[bars.length - 1];
  const rets: number[] = [];
  for (let i = Math.max(1, bars.length - 20); i < bars.length; i++) rets.push(Math.log(bars[i].close / bars[i - 1].close));
  const vol = Math.sqrt(mean(rets.map(r => (r - mean(rets)) ** 2)) * DAYS);
  return {
    id: `${code}.SH`, code: `${code}.SH`, name, category: cat, isETF: false,
    isT0: false, stampDutyExempt: false,
    currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol,
    dataSource: 'parquet', bars, riskBudgetWeight: w, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

const trim = (i: AShareInstrument) => {
  const bars = (i as any).bars.filter((b: any) => b.tradeDate >= CUT);
  if (bars.length < 260) return null;
  const last = bars[bars.length - 1];
  return { ...i, bars, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
};

function show(tag: string, m: any) {
  const c = m.carver, e = m.equalWeight;
  console.log(`${tag.padEnd(26)} 卡弗 年化${c.cagrPct.toFixed(2)}% 波动${c.annVolPct.toFixed(2)}% 夏普${c.sharpe.toFixed(2)} 回撤${c.maxDrawdownPct.toFixed(2)}% Calmar${c.calmar.toFixed(2)} | 等权年化${e.cagrPct.toFixed(2)}%`);
  return c;
}

async function main() {
  const pool = await loadRealUniverse();
  const bond = await buildFromTencent('511260', '十年国债ETF', 'bond_etf', 1 / 7);

  const build = async (codes: string[], n: number) => {
    const w = 1 / n;
    const arr = codes.filter(c => c !== '511260').map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];
    if (bond) arr.push({ ...bond, riskBudgetWeight: w });
    return arr.map(i => ({ ...i, riskBudgetWeight: w }));
  };

  const uni7 = await build(V7, 7);
  const uni8 = await build([...V7, MUYUAN], 8);
  const uni9 = await build([...V7, MUYUAN, TECH], 9);
  console.log(`7只：${uni7.map(i => i.name).join('、')}`);
  console.log(`8只：${uni8.map(i => i.name).join('、')}`);
  console.log(`9只：${uni9.map(i => i.name).join('、')}`);

  const settings = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };

  for (const [label, cut] of [['近8年(2018起)', CUT], ['全样本', '1900-01-01']] as const) {
    console.log(`\n########## ${label} ##########`);
    const t7 = cut === CUT ? uni7.map(trim).filter(Boolean) as AShareInstrument[] : uni7;
    const t8 = cut === CUT ? uni8.map(trim).filter(Boolean) as AShareInstrument[] : uni8;
    for (const tv of [0.18, 0.22]) {
      const s = { ...settings, targetAnnualVol: tv };
      const t9 = cut === CUT ? uni9.map(trim).filter(Boolean) as AShareInstrument[] : uni9;
      const r7 = await runRealBacktest(t7, s, { minHistoryBars: 252 });
      const r8 = await runRealBacktest(t8, s, { minHistoryBars: 252 });
      const r9 = await runRealBacktest(t9, s, { minHistoryBars: 252 });
      const c7 = show(`7只 目标波动${(tv*100).toFixed(0)}%`, r7.metrics);
      const c8 = show(`8只+牧原 目标波动${(tv*100).toFixed(0)}%`, r8.metrics);
      const c9 = show(`9只+牧原+中石油 ${(tv*100).toFixed(0)}%`, r9.metrics);
      console.log(`  >>> 差异(8-7)：年化 ${(c8.cagrPct-c7.cagrPct).toFixed(2)}pt 波动 ${(c8.annVolPct-c7.annVolPct).toFixed(2)}pt 夏普 ${(c8.sharpe-c7.sharpe).toFixed(2)} 回撤 ${(c8.maxDrawdownPct-c7.maxDrawdownPct).toFixed(2)}pt`);
      console.log(`  >>> 差异(9-8)：年化 ${(c9.cagrPct-c8.cagrPct).toFixed(2)}pt 波动 ${(c9.annVolPct-c8.annVolPct).toFixed(2)}pt 夏普 ${(c9.sharpe-c8.sharpe).toFixed(2)} 回撤 ${(c9.maxDrawdownPct-c8.maxDrawdownPct).toFixed(2)}pt`);
    }
  }

  // 牧原当前目标仓位（工作台真实 calculatePortfolio）
  console.log('\n########## 当前时点各腿目标权重 ##########');
  const cur8 = uni8.map(trim).filter(Boolean) as AShareInstrument[];
  const corr = undefined;
  const pf: any = calculatePortfolio(cur8, { ...settings, targetAnnualVol: 0.18 } as any, undefined as any);
  const pos = pf.positions || [];
  console.log('  标的            标量   乘数   目标权重  目标市值  动作');
  for (const l of pos) {
    const nm = (l.instrument?.name ?? '?').toString();
    const cap = (l.targetCapital ?? 0) / 10000;
    console.log(`  ${nm.padEnd(16)} ${String(l.forecastScalar ?? '?').padEnd(6)} ${String(l.scalarMultiplier?.toFixed?.(2) ?? '?').padEnd(6)} ${(l.targetWeight*100).toFixed(1).padEnd(8)}% ${cap.toFixed(1).padEnd(8)}万 ${l.action ?? ''}`);
  }
  console.log('  组合摘要:', JSON.stringify(pf.summary).slice(0,400));
}
main().catch(e => { console.error(e); process.exit(1); });
