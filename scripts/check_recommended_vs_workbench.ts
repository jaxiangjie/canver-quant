/**
 * 把推荐的 11 强导入工作台引擎，查看工作台实际给出的目标仓位。
 * 用法：node_modules/.bin/tsx scripts/check_recommended_vs_workbench.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { calculatePortfolio, DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const DAYS = 250;

const CODES = ['601919', '000333', '601288', '600886', '601088', '002714', '601857', '512890', '518880', '513100'];

async function bond(): Promise<AShareInstrument | null> {
  let rows: any[] = [];
  for (let i = 0; i < 2; i++) {
    try { rows = await fetchTencentHfqDaily('511260', 2800); if (rows.length) break; } catch { /* */ }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (!rows?.length) return null;
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
    id: '511260.SH', code: '511260.SH', name: '十年国债ETF', category: 'bond_etf', isETF: true,
    isT0: true, stampDutyExempt: true, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, annualizedVol: vol, dataSource: 'parquet',
    bars, riskBudgetWeight: 1 / 11, barsCount: bars.length, lastBarDate: last.tradeDate,
  } as AShareInstrument;
}

async function main() {
  const pool = await loadRealUniverse();
  const uni = CODES.map(c => pool.find(i => i.code.startsWith(c))!).filter(Boolean).map(i => ({ ...i, currentShares: 0, riskBudgetWeight: 1 / 11 }));
  const b = await bond();
  if (b) uni.push({ ...b, currentShares: 0 });
  console.log(`组合 ${uni.length} 只，等风险预算 9.09%/腿，currentShares=0（全新建仓）`);

  const { positions, summary } = calculatePortfolio(uni as any, DEFAULT_CARVER_SETTINGS);
  console.log('\n代码\t名称\t标量\t乘数\t年化波动\t目标权重\t目标金额(万)\t动作');
  for (const p of positions.sort((a: any, b: any) => b.targetWeight - a.targetWeight)) {
    const s: any = p.instrument?.signals;
    console.log(`${p.instrument.code}\t${p.instrument.name}\t${(s?.finalForecastScalar ?? 0).toFixed(1)}\t${p.scalarMultiplier.toFixed(2)}x\t${(p.instrument.annualizedVol * 100).toFixed(1)}%\t${(p.targetWeight * 100).toFixed(1)}%\t${(p.targetCapital / 10000).toFixed(1)}\t${p.action}`);
  }
  console.log(`\n组合有效波动 ${summary.effectiveAnnualVol}%（目标 18%）`);
  console.log(`目标总敞口 ${(summary.targetEquityValue / 10000).toFixed(1)} 万 = ${(summary.targetEquityValue / summary.totalCapital * 100).toFixed(1)}%`);
  console.log(`杠杆约束 ${summary.isLeverageConstrained} | IDM ${summary.carverIDM?.toFixed(2)} | ρ ${summary.avgCorrelation?.toFixed(3)}`);
  console.log(`预期年化(引擎口径) ${summary.expectedAnnualReturn}%`);

  // 对比：推荐组合与工作台三个预设的标的重叠
  const bundles: Record<string, string[]> = {
    'balanced9': ['510300', '510500', '588000', '512890', '601857', '511010', '518880', '513100', '513520'],
    'select_etf5': ['510500', '512890', '518880', '513100', '510300'],
    'poorlab11': ['601288', '601318', '601857', '600886', '601088', '601919', '601899', '000333', '600660', '002714', '002223'],
  };
  const rec = new Set([...CODES, '511260']);
  console.log('\n=== 与工作台预设组合的标的重叠 ===');
  for (const [name, list] of Object.entries(bundles)) {
    const hit = list.filter(c => rec.has(c));
    console.log(`${name}: ${hit.length}/${list.length} 重叠 → ${hit.join('、')}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
