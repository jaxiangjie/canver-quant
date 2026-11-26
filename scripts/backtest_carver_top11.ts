/**
 * 11 强组合：原 10 强去掉短端国债(511010)，加入黄金(518880)+纳指(513100)。
 * 对照原 10 强。等风险预算 1/n。
 * 用法：node_modules/.bin/tsx scripts/backtest_carver_top11.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

const V11 = ['601919', '000333', '601288', '600886', '601088', '002714', '601857', '512890', '511260', '518880', '513100'];
const V10_OLD = ['601919', '000333', '601288', '600886', '601088', '002714', '601857', '512890', '511010', '511260'];
const CUT = '2018-01-01';

async function buildFromTencent(code: string, name: string, cat: any, w: number): Promise<AShareInstrument | null> {
  let rows: any[] = [];
  for (let i = 0; i < 2; i++) {
    try { rows = await fetchTencentHfqDaily(code, 2800); if (rows.length) break; } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 1200));
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
    id: `${code}.SH`, code: `${code}.SH`, name, category: cat, isETF: true,
    isT0: true, stampDutyExempt: true,
    currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol,
    dataSource: 'parquet', bars, riskBudgetWeight: w, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

function show(tag: string, m: any) {
  console.log(`\n【${tag}】${m.startDate} → ${m.endDate}｜${m.rebalanceCount} 次`);
  for (const [k, label] of [['carver', '卡弗策略'], ['equalWeight', '等权持有']] as const) {
    const s = m[k];
    console.log(`  ${label}\t年化 ${s.cagrPct.toFixed(2)}%\t波动 ${s.annVolPct.toFixed(2)}%\t夏普 ${s.sharpe.toFixed(2)}\t回撤 ${s.maxDrawdownPct.toFixed(2)}%\tCalmar ${s.calmar.toFixed(2)}`);
  }
}

const trim = (i: AShareInstrument) => {
  const bars = (i as any).bars.filter((b: any) => b.tradeDate >= CUT);
  if (bars.length < 260) return null;
  const last = bars[bars.length - 1];
  return { ...i, bars, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
};

async function main() {
  const pool = await loadRealUniverse();
  const n = 11, w = 1 / n;

  // 11 强：9 只池内 + 511260(腾讯) + 池内黄金/纳指
  const codes11 = V11.filter(c => c !== '511260');
  const picked = codes11.map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];
  const bond = await buildFromTencent('511260', '十年国债ETF', 'bond_etf', w);
  if (bond) picked.push(bond);
  const uni11 = picked.map(i => ({ ...i, riskBudgetWeight: w }));
  console.log(`11 强（去掉短端国债，+黄金+纳指）：` + uni11.map(i => i.name).join('、'));

  // 原 10 强对照
  const old10 = V10_OLD.filter(c => c !== '511260').map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];
  const old10Bond = await buildFromTencent('511260', '十年国债ETF', 'bond_etf', 1 / 10);
  if (old10Bond) old10.push(old10Bond);
  const uni10 = old10.map(i => ({ ...i, riskBudgetWeight: 1 / 10 }));

  const settings = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };

  console.log('\n########## 近 8 年样本（2018-01 起）##########');
  const u11_8 = uni11.map(trim).filter(Boolean) as AShareInstrument[];
  const u10_8 = uni10.map(trim).filter(Boolean) as AShareInstrument[];
  for (const tv of [0.18, 0.22]) {
    show(`11强(含黄金纳指) 目标波动${tv * 100}%`, (await runRealBacktest(u11_8, { ...settings, targetAnnualVol: tv }, { minHistoryBars: 252 })).metrics);
    show(`原10强(双债)     目标波动${tv * 100}%`, (await runRealBacktest(u10_8, { ...settings, targetAnnualVol: tv }, { minHistoryBars: 252 })).metrics);
  }

  console.log('\n########## 全样本（渐进入池）##########');
  for (const tv of [0.18]) {
    show(`11强 目标波动${tv * 100}%`, (await runRealBacktest(uni11, { ...settings, targetAnnualVol: tv }, { minHistoryBars: 252 })).metrics);
    show(`原10强 目标波动${tv * 100}%`, (await runRealBacktest(uni10, { ...settings, targetAnnualVol: tv }, { minHistoryBars: 252 })).metrics);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
