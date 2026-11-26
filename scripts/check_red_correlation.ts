/**
 * 红利低波(512890) 与 11 强组合各标的的相关度 + 组合平均ρ/IDM。
 * 用工作台真实 bars，60日（执行口径）与 250日 对照。
 * 用法：node_modules/.bin/tsx scripts/check_red_correlation.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { computeUniverseCorrelationMatrix, calculatePearsonCorrelation, computeCarverIDM } from '../src/services/correlationEngine';
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import type { AShareInstrument } from '../src/types/ashare';

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const CODES = ['512890', '511260', '601288', '601919', '000333', '601088', '600886', '601857', '513100', '518880', '002714'];

// 按共同交易日对齐后算相关
function corr(a: AShareInstrument, b: AShareInstrument, days: number): number {
  const ma = new Map<string, number>(), mb = new Map<string, number>();
  const barsA = (a as any).bars || [], barsB = (b as any).bars || [];
  for (let i = 1; i < barsA.length; i++) ma.set(barsA[i].tradeDate, Math.log(barsA[i].close / barsA[i - 1].close));
  for (let i = 1; i < barsB.length; i++) mb.set(barsB[i].tradeDate, Math.log(barsB[i].close / barsB[i - 1].close));
  const common = [...ma.keys()].filter(d => mb.has(d)).sort().slice(-days);
  if (common.length < 20) return NaN;
  return calculatePearsonCorrelation(common.map(d => ma.get(d)!), common.map(d => mb.get(d)!));
}

async function main() {
  const pool = await loadRealUniverse();
  const red = pool.find(i => i.code.startsWith('512890'))!;
  const uni = CODES.map(c => pool.find(i => i.code.startsWith(c))).filter(Boolean) as AShareInstrument[];

  // 补 511260
  let rows: any[] = [];
  for (let k = 0; k < 2; k++) { try { rows = await fetchTencentHfqDaily('511260', 2800); if (rows.length) break; } catch { /* */ } await new Promise(r => setTimeout(r, 1200)); }
  if (rows?.length > 300) {
    const tr: number[] = [];
    for (let i = 0; i < rows.length; i++) { const pc = i > 0 ? rows[i-1].close : rows[i].close; tr.push(Math.max(rows[i].high-rows[i].low, Math.abs(rows[i].high-pc), Math.abs(rows[i].low-pc))); }
    const bars = rows.map((r, i) => { const pc = i > 0 ? rows[i-1].close : r.close; const ma250 = i >= 249 ? mean(rows.slice(i-249,i+1).map(x=>x.close)) : undefined; const atr20 = i >= 20 ? mean(tr.slice(i-19,i+1)) : undefined; return { tradeDate:r.tradeDate, open:r.open, high:r.high, low:r.low, close:r.close, preClose:pc, volume:r.volume, amount:r.amount, turnover:0, changePct:((r.close/pc)-1)*100, ma250, atr20 } as any; });
    const last = bars[bars.length-1];
    uni.push({ id:'511260.SH', code:'511260.SH', name:'十年国债ETF', category:'bond_etf', isETF:true, isT0:true, stampDutyExempt:true, currentPrice:last.close, preClose:last.preClose, changePct:last.changePct, dailyATR:last.atr20, annualizedVol:0.021, dataSource:'parquet', bars, riskBudgetWeight:1/11 } as AShareInstrument);
  }

  console.log('=== 红利低波 512890 与各标的相关度 ===');
  console.log('标的\t代码\t60日ρ\t250日ρ');
  const rowsOut: { name: string; code: string; c60: number; c250: number }[] = [];
  for (const i of uni) {
    if (i.code.startsWith('512890')) continue;
    const c60 = corr(red, i, 60), c250 = corr(red, i, 250);
    rowsOut.push({ name: i.name, code: i.code, c60, c250 });
  }
  rowsOut.sort((a, b) => b.c60 - a.c60);
  for (const r of rowsOut) console.log(`${r.name}\t${r.code}\t${r.c60.toFixed(3)}\t${r.c250.toFixed(3)}`);

  // 组合整体 ρ / IDM（60日执行口径）
  for (const w of [60, 250]) {
    const res = computeUniverseCorrelationMatrix(uni, w);
    console.log(`\n=== 11强组合 ${w}日：平均ρ=${res.averageUniverseCorrelation.toFixed(3)} IDM=${res.carverIDM.toFixed(3)}（参与${res.instruments.length}只）===`);
    const withRed = (res.pairsRanked || []).filter((p: any) => String(p.a?.code || p.a || '').includes('512890') || String(p.b?.code || p.b || '').includes('512890'));
    if (withRed.length) {
      console.log('含红利的相关对（前8高）：');
      for (const p of withRed.slice(0, 8)) console.log(`  ${p.a?.name ?? p.a} ↔ ${p.b?.name ?? p.b}: ${Number(p.correlation ?? p.rho).toFixed(3)}`);
    }
  }
  // 剔除实验：保留红利，逐步剔除高相关个股，看组合平均ρ/IDM
  console.log('\n=== 剔除实验（保留红利，看平均ρ/IDM 变化）===');
  const removeSets: { label: string; drop: string[] }[] = [
    { label: '原始11只', drop: [] },
    { label: '去掉农行', drop: ['601288'] },
    { label: '去掉农行+中石油', drop: ['601288','601857'] },
    { label: '去掉农行+中石油+神华', drop: ['601288','601857','601088'] },
    { label: '去掉4只高相关(农行/石油/神华/国投)', drop: ['601288','601857','601088','600886'] },
  ];
  for (const set of removeSets) {
    const sub = uni.filter(i => !set.drop.some(c => i.code.startsWith(c)));
    const r60 = computeUniverseCorrelationMatrix(sub, 60);
    const r250 = computeUniverseCorrelationMatrix(sub, 250);
    console.log(`${set.label.padEnd(28)} 剩${sub.length}只 | 60日ρ=${r60.averageUniverseCorrelation.toFixed(3)} rawIDM=${r60.carverIDM.toFixed(2)} | 250日ρ=${r250.averageUniverseCorrelation.toFixed(3)} rawIDM=${r250.carverIDM.toFixed(2)}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
