/**
 * 新 9 只组合：等权(1/9) vs 标量差异化 两种风险预算权重对比。
 * 国债腿 20% 上限由引擎 maxBondCap=0.20 自动约束（无需手工设权重）。
 * 用法：node_modules/.bin/tsx scripts/backtest_weight_schemes.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';
import type { AShareInstrument } from '../src/types/ashare';

const NINE = ['512890', '511260', '000333', '601919', '601088', '513100', '518880', '002714', '002223'];
const CUT = '2018-01-01';

const trim = (i: AShareInstrument) => {
  const bars = (i as any).bars.filter((b: any) => b.tradeDate >= CUT);
  if (bars.length < 260) return null;
  const last = bars[bars.length - 1];
  return { ...i, bars, currentPrice: last.close, preClose: last.preClose, changePct: last.changePct,
    dailyATR: last.atr20 ?? last.close * 0.02, barsCount: bars.length, lastBarDate: last.tradeDate } as AShareInstrument;
};
function show(tag: string, m: any) {
  const c = m.carver;
  console.log(`${tag.padEnd(34)} 年化${c.cagrPct.toFixed(2)}% 波动${c.annVolPct.toFixed(2)}% 夏普${c.sharpe.toFixed(2)} 回撤${c.maxDrawdownPct.toFixed(2)}% Calmar${c.calmar.toFixed(2)}`);
  return c;
}

async function main() {
  const pool = await loadRealUniverse();
  const base = NINE.map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];
  if (base.length !== 9) { console.log(`✗ 只找到 ${base.length}/9 只，缺：`, NINE.filter(c => !base.some(i => i.code.startsWith(c)))); return; }
  console.log('9 只：' + base.map(i => i.name).join('、'));

  // 计算每只当前标量（用工作台 evaluateAShareStrategies 真实口径）
  console.log('\n=== 各腿标量（当前）===');
  const scalars: Record<string, number> = {};
  for (const i of base) {
    const sig: any = evaluateAShareStrategies(i as any);
    const s = sig?.ewmacFastSlow?.compositeScalar ?? 0;
    scalars[i.code] = s;
    console.log(`  ${i.name.padEnd(16)} 标量 ${String(s).padStart(6)}`);
  }

  // 方案A：等权 1/9
  const equal = base.map(i => ({ ...i, riskBudgetWeight: 1 / 9 }));
  // 方案B：标量差异化 —— 乘数 = max(0.05, (标量+20)/20)，归一化到 1
  // 与引擎 forecastScalar 同思路，但做成静态风险预算
  const rawW: Record<string, number> = {};
  let sum = 0;
  for (const i of base) {
    const mult = Math.max(0.05, (scalars[i.code] + 20) / 20);
    rawW[i.code] = mult; sum += mult;
  }
  const weighted = base.map(i => ({ ...i, riskBudgetWeight: rawW[i.code] / sum }));
  console.log('\n=== 标量差异化权重 ===');
  for (const i of weighted) console.log(`  ${i.name.padEnd(16)} ${(i.riskBudgetWeight*100).toFixed(1)}%`);

  const settings = { ...DEFAULT_CARVER_SETTINGS, totalCapital: 1000000 };
  for (const [label, cut] of [['近8年(2018起)', CUT], ['全样本', '1900-01-01']] as const) {
    console.log(`\n########## ${label} ##########`);
    const tEq = cut === CUT ? equal.map(trim).filter(Boolean) as AShareInstrument[] : equal;
    const tWt = cut === CUT ? weighted.map(trim).filter(Boolean) as AShareInstrument[] : weighted;
    for (const tv of [0.18, 0.22]) {
      const s = { ...settings, targetAnnualVol: tv };
      const rEq = await runRealBacktest(tEq, s, { minHistoryBars: 252 });
      const rWt = await runRealBacktest(tWt, s, { minHistoryBars: 252 });
      const a = show(`等权 目标${(tv*100).toFixed(0)}%`, rEq.metrics);
      const b = show(`标量差异化 目标${(tv*100).toFixed(0)}%`, rWt.metrics);
      console.log(`  >>> 差异(差异化-等权)：年化 ${(b.cagrPct-a.cagrPct).toFixed(2)}pt 波动 ${(b.annVolPct-a.annVolPct).toFixed(2)}pt 夏普 ${(b.sharpe-a.sharpe).toFixed(2)} 回撤 ${(b.maxDrawdownPct-a.maxDrawdownPct).toFixed(2)}pt`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
