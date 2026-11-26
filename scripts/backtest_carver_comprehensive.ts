/**
 * 综合标的 · 卡弗策略工作台回测
 * 池内 22 只 + 十年国债ETF(511260) + 银行ETF(512800)，用项目 runRealBacktest 跑。
 * 用法：node_modules/.bin/tsx scripts/backtest_carver_comprehensive.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const DAYS = 250;
const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

const EXTRA: { code: string; name: string; cat: any; w: number }[] = [
  { code: '511260', name: '十年国债ETF', cat: 'bond_etf', w: 1 / 24 },
  { code: '512800', name: '银行ETF', cat: 'sector_etf', w: 1 / 24 },
];

async function buildInstrument(s: typeof EXTRA[number]): Promise<AShareInstrument | null> {
  let rows: any[] = [];
  for (let i = 0; i < 2; i++) {
    try { rows = await fetchTencentHfqDaily(s.code, 2800); if (rows.length) break; } catch { /* retry */ }
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
    id: `${s.code}.SH`, code: `${s.code}.SH`, name: s.name, category: s.cat, isETF: true,
    isT0: true, stampDutyExempt: true,
    currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol,
    dataSource: 'parquet', bars, riskBudgetWeight: s.w, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

function show(tag: string, m: any) {
  console.log(`\n【${tag}】${m.startDate} → ${m.endDate}｜${m.rebalanceCount} 次再平衡`);
  for (const [k, label] of [['carver', '卡弗策略'], ['equalWeight', '等权持有'], ['csi300', '沪深300']] as const) {
    const s = m[k];
    console.log(`  ${label}\t年化 ${s.cagrPct.toFixed(2)}%\t波动 ${s.annVolPct.toFixed(2)}%\t夏普 ${s.sharpe.toFixed(2)}\t索提诺 ${s.sortino.toFixed(2)}\t回撤 ${s.maxDrawdownPct.toFixed(2)}%\tCalmar ${s.calmar.toFixed(2)}`);
  }
}

async function main() {
  const pool = await loadRealUniverse();
  console.log(`池内基础 ${pool.length} 只`);

  const extras: AShareInstrument[] = [];
  for (const s of EXTRA) {
    const inst = await buildInstrument(s);
    if (inst) {
      console.log(`  ✓ ${inst.name} ${(inst as any).bars.length} 根 ${(inst as any).bars[0].tradeDate} → ${(inst as any).bars.at(-1).tradeDate}`);
      extras.push(inst);
    } else console.log(`  ✗ ${s.name} 拉取失败`);
  }

  const settings = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };

  // A. 基准：池内 22 只
  const A = await runRealBacktest(pool, settings, { minHistoryBars: 252 });
  show('A · 池内 22 只（基准）', A.metrics);

  // B. 综合 24 只
  if (extras.length === 2) {
    const uni = [...pool, ...extras];
    const B = await runRealBacktest(uni, settings, { minHistoryBars: 252 });
    show('B · 综合 24 只（+国债+银行）', B.metrics);

    // C. 综合 24 只 · 等风险预算 1/24
    const uniEq = uni.map(i => ({ ...i, riskBudgetWeight: 1 / 24 }));
    const C = await runRealBacktest(uniEq, settings, { minHistoryBars: 252 });
    show('C · 综合 24 只（等风险预算 1/24）', C.metrics);

    // D. 只看 2017 之后（与混合版同区间）—— 裁掉早期，观察新标的加入后的近 8 年
    const CUT = '2017-08-24';
    const trim = (i: AShareInstrument) => {
      const bars = (i as any).bars.filter((b: any) => b.tradeDate >= CUT);
      if (bars.length < 260) return null;
      const last = bars[bars.length - 1];
      return { ...i, bars, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
        dailyATR: last.atr20 ?? last.close * 0.02, barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
    };
    const uni8 = uni.map(trim).filter(Boolean) as AShareInstrument[];
    const D = await runRealBacktest(uni8, settings, { minHistoryBars: 252 });
    show(`D · 综合 ${uni8.length} 只（仅 2017-08 之后）`, D.metrics);

    // E. 同期基准：池内 22 只也裁到 2017 后
    const pool8 = pool.map(trim).filter(Boolean) as AShareInstrument[];
    const E = await runRealBacktest(pool8, settings, { minHistoryBars: 252 });
    show(`E · 池内 ${pool8.length} 只（仅 2017-08 之后）`, E.metrics);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
