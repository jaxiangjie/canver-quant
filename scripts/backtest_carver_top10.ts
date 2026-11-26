/**
 * 卡弗 10 强组合回测：池内 9 只正标量标的 + 十年国债，等风险预算 1/10。
 * 扫描不同目标波动率，找年化 ≥12% 的配置。
 * 用法：node_modules/.bin/tsx scripts/backtest_carver_top10.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

// 池内 9 只（正标量且 MA250 通过，按标量降序）+ 511260 十年国债
const POOL_CODES = ['601919', '000333', '601288', '600886', '601088', '002714', '601857', '512890', '511010'];
const EXTRA = { code: '511260', name: '十年国债ETF', cat: 'bond_etf' as const };

async function buildExtra(): Promise<AShareInstrument | null> {
  let rows: any[] = [];
  for (let i = 0; i < 2; i++) {
    try { rows = await fetchTencentHfqDaily(EXTRA.code, 2800); if (rows.length) break; } catch { /* retry */ }
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
    id: `${EXTRA.code}.SH`, code: `${EXTRA.code}.SH`, name: EXTRA.name, category: EXTRA.cat, isETF: true,
    isT0: true, stampDutyExempt: true,
    currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol,
    dataSource: 'parquet', bars, riskBudgetWeight: 1 / 10, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

function show(tag: string, m: any) {
  console.log(`\n【${tag}】${m.startDate} → ${m.endDate}｜${m.rebalanceCount} 次再平衡`);
  for (const [k, label] of [['carver', '卡弗策略'], ['equalWeight', '等权持有'], ['csi300', '沪深300']] as const) {
    const s = m[k];
    console.log(`  ${label}\t年化 ${s.cagrPct.toFixed(2)}%\t波动 ${s.annVolPct.toFixed(2)}%\t夏普 ${s.sharpe.toFixed(2)}\t回撤 ${s.maxDrawdownPct.toFixed(2)}%\tCalmar ${s.calmar.toFixed(2)}\t期末 ${s.finalEquity.toFixed(2)}`);
  }
}

async function main() {
  const pool = await loadRealUniverse();
  const picked = POOL_CODES.map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];
  console.log(`池内入选 ${picked.length} 只：` + picked.map(i => i.name).join('、'));
  const extra = await buildExtra();
  if (extra) { console.log(`  + ${extra.name} ${(extra as any).bars.length} 根`); picked.push(extra); }

  // 等风险预算 1/n
  const w = 1 / picked.length;
  const uni = picked.map(i => ({ ...i, riskBudgetWeight: w }));
  console.log(`\n等风险预算 ${ (w * 100).toFixed(1) }%/只，共 ${uni.length} 腿`);

  for (const tv of [0.12, 0.15, 0.18, 0.22]) {
    const bt = await runRealBacktest(uni, { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000, targetAnnualVol: tv }, { minHistoryBars: 252 });
    show(`目标波动 ${(tv * 100).toFixed(0)}%`, bt.metrics);
  }
  // 近 8 年样本（2018 起）：与"综合24只"对照
  const CUT = '2018-01-01';
  const trim = (i: AShareInstrument) => {
    const bars = (i as any).bars.filter((b: any) => b.tradeDate >= CUT);
    if (bars.length < 260) return null;
    const last = bars[bars.length - 1];
    return { ...i, bars, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
      dailyATR: last.atr20 ?? last.close * 0.02, barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
  };
  const uni8 = uni.map(trim).filter(Boolean) as AShareInstrument[];
  console.log(`\n===== 近 8 年样本（2018-01 起，${uni8.length} 腿）=====`);
  for (const tv of [0.18, 0.22]) {
    const bt = await runRealBacktest(uni8, { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000, targetAnnualVol: tv }, { minHistoryBars: 252 });
    show(`近8年 · 目标波动 ${(tv * 100).toFixed(0)}%`, bt.metrics);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
