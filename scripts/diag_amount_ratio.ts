/** 诊断：dailyBarSync 追加 bar 的 amount 还原比例为何失真（临时） */
import { fetchTencentHfqDaily } from '../src/services/stagingData';
import { loadRealUniverse } from '../src/services/realData';

const codes = ['600660', '600886', '510300'];
const real: any[] = (await loadRealUniverse()) as any[];

for (const c of codes) {
  const inst = real.find((i) => i.code.startsWith(c));
  const ex = (inst?.bars ?? []).slice(-60);
  const exRatio = ex
    .filter((b: any) => b.amount > 0 && b.volume > 0 && b.close > 0)
    .map((b: any) => b.amount / (b.volume * b.close));
  exRatio.sort((a: number, b: number) => a - b);
  const exMed = exRatio.length ? exRatio[Math.floor(exRatio.length / 2)] : NaN;

  const tc = await fetchTencentHfqDaily(c, 60);
  const last = tc.slice(-2);
  const tcRatio = tc
    .filter((b) => Number((b as any).amount) > 0 && b.volume > 0 && b.close > 0)
    .map((b) => Number((b as any).amount) / (b.volume * b.close));

  console.log(`\n=== ${c} (${inst?.name}) 实际市价=${inst?.currentPrice} ===`);
  console.log('  parquet 末根:', JSON.stringify({ d: inst?.bars?.at(-1)?.tradeDate, close: inst?.bars?.at(-1)?.close, volume: inst?.bars?.at(-1)?.volume, amount: inst?.bars?.at(-1)?.amount }));
  console.log('  parquet 自身 amount/(vol*close) 中位数 =', exMed, ' 样本数=', exRatio.length);
  console.log('  腾讯末两根:', JSON.stringify(last));
  console.log('  腾讯 amount/(vol*close) 中位数 =', tcRatio.length ? tcRatio[Math.floor(tcRatio.length / 2)] : '无(amount 缺失)', ' 样本数=', tcRatio.length);
}
