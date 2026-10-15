/**
 * 复核（2026-10-15）：前端宇宙里的 bars 到底是真实 parquet K 线，还是 hydrateInstrument 合成的伪随机序列？
 * 以及这对 EWMAC → Carver 标量（进而目标股数）的实际影响有多大。
 *
 * 用法: npx tsx scripts/check_client_bars_gap.ts
 *
 * 背景：/api/ashare/instruments 走 stripBars 瘦身（只下发 barsCount），
 * 而 hydrateInstrument 在 bars<20 时用 generateHistoricalBars 合成 251 根——
 * 于是浏览器侧算 EWMAC 的分母/分子可能整条都是假的。
 */
import { loadRealUniverse } from '../src/services/realData';
import { hydrateInstrument } from '../src/services/apiClient';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

function stripBars(inst: any) {
  const { bars, ...rest } = inst;
  return { ...rest, barsCount: Array.isArray(bars) ? bars.length : 0 };
}

const REAL: any[] = (await loadRealUniverse()) as any[];
const CODES = ['510300.SH', '513180.SH', '513520.SH', '601919.SH', '600886.SH', '562500.SH'];

const pad = (s: any, n: number) => String(s).padStart(n);
console.log(
  'code'.padEnd(11),
  pad('realBars', 9),
  pad('realLast', 11),
  pad('cliBars', 8),
  pad('cliLast', 11),
  pad('cliSynth', 9),
  pad('atr20?', 7),
  pad('scalarReal', 11),
  pad('scalarCli', 10),
  pad('Δ', 7),
);

let maxDelta = 0;
for (const c of CODES) {
  const real = REAL.find((i) => i.code === c);
  if (!real) {
    console.log(c, 'NOT FOUND');
    continue;
  }
  const realBars = real.bars || [];
  const client = hydrateInstrument(stripBars(real));
  const cliBars = client.bars || [];
  const sReal = evaluateAShareStrategies(real, REAL).finalForecastScalar;
  const sCli = evaluateAShareStrategies(client, REAL).finalForecastScalar;
  const d = sCli - sReal;
  maxDelta = Math.max(maxDelta, Math.abs(d));
  console.log(
    c.padEnd(11),
    pad(realBars.length, 9),
    pad(realBars.at(-1)?.tradeDate ?? '-', 11),
    pad(cliBars.length, 8),
    pad(cliBars.at(-1)?.tradeDate ?? '-', 11),
    pad(String(client.syntheticBars), 9),
    pad(realBars.at(-1)?.atr20 ?? 'none', 7),
    pad(sReal.toFixed(1), 11),
    pad(sCli.toFixed(1), 10),
    pad(d.toFixed(1), 7),
  );
}

console.log('\n结论判据：cliSynth=true 且 realLast≠cliLast → 前端 bars 为合成数据；|Δ| 即界面标量与真实 K 线的偏差。');
console.log(`最大 |Δ| = ${maxDelta.toFixed(1)}（满量程 ±20）`);
