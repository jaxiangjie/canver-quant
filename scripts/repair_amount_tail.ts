/**
 * 修复「日线增量」追加 bar 的成交额口径（2026-10-15）。
 *
 * 背景：dailyBarSync 首版用**腾讯**重叠段的 amount/(volume×close) 当还原比例，
 * 但腾讯 hfq 的 amount 是构造值（≡ volume×close，比值恒为 1）→ 追加 bar 的 amount
 * 变成 volume×hfqClose，对复权因子 f≈97 的福耀放大约 95 倍，污染 ADV/冲击成本/换手率。
 * 代码已改（改用 parquet 自身比值），本脚本把**已写入**的尾部 bar 修正回来。
 *
 * 判据：expected = volume × close × median(自身 amount/(volume×close))；
 *       偏离 |amount/expected - 1| > 1.0（即 2 倍以上）才修，避免误伤正常噪声。
 *
 * 用法:
 *   npx tsx scripts/repair_amount_tail.ts          # 只体检，不写盘
 *   npx tsx scripts/repair_amount_tail.ts --apply  # 备份 + 修正 + 读回校验
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from 'fs';
import path from 'path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { writeBarsJsonToParquet } from '../src/services/stagingData';
import { readParquetBarCountAndLastDate } from '../src/services/parquetProbe';

const APPLY = process.argv.includes('--apply');
const DIR = path.resolve(process.cwd(), 'data', 'parquet', 'daily');
const BACKUP = path.resolve(process.cwd(), 'data', 'backup', 'parquet', `${new Date().toISOString().slice(0, 10)}-amountrepair`);
const TMP = path.resolve(process.cwd(), 'data', 'cache', 'analysis');

const toDay = (v: any): string => {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(v).slice(0, 10);
};
const median = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : 1);

/** 判据：用**前 60 根**的局部中位比值（不是全局）——复权因子随分红/送股随时间漂移，
 *  全局中位数会把整段合法历史误判成异常（实测：福耀 30 年历史被误标 3570 根）。
 *  局部判据只抓「突然与相邻 60 根不同量纲」的 bar —— 正是本次增量追加的那几根。 */
const LOCAL_WIN = 60;
const DEV = 1.0; // |ratio/localMed - 1| > 1.0（即 2 倍以上）
/** 只修「日线增量同步」产出的区间（2026-09-01 起）。更早的异常非本次引入，
 *  属于历史遗留/真实数据特性，一律不碰、只报告，避免用今天的口径改写历史。 */
const REPAIR_FROM = '2026-09-01';

const files = readdirSync(DIR).filter((f) => f.endsWith('_hfq.parquet')).sort();
console.log(`模式: ${APPLY ? 'APPLY(会写盘)' : 'DRY-RUN(只体检)'}  文件数=${files.length}\n`);
console.log('bare    bars  局部异常根数  首次异常日            末次异常日            修正后示例');
let totalFixed = 0;
const hardFail: string[] = [];

for (const f of files) {
  const bare = f.replace('_hfq.parquet', '');
  const parquetPath = path.join(DIR, f);
  const rows = (await parquetReadObjects({ file: await asyncBufferFromFile(parquetPath) })) as any[];
  const bars = rows.map((r) => ({
    tradeDate: toDay(r.date),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume), amount: Number(r.amount),
  }));
  const ratioOf = (b: any) =>
    b.amount > 0 && b.volume > 0 && b.close > 0 ? b.amount / (b.volume * b.close) : NaN;

  const bad: typeof bars = [];
  const outOfScope: typeof bars = [];
  for (let i = 0; i < bars.length; i++) {
    const r = ratioOf(bars[i]);
    if (!Number.isFinite(r)) continue;
    const win = bars.slice(Math.max(0, i - LOCAL_WIN), i).map(ratioOf).filter(Number.isFinite).sort((a, b) => a - b);
    if (win.length < 10) continue; // 头部样本不足，不判
    const localMed = win[Math.floor(win.length / 2)];
    if (!(localMed > 0)) continue;
    if (Math.abs(r / localMed - 1) > DEV) {
      (bars[i].tradeDate >= REPAIR_FROM ? bad : outOfScope).push(bars[i] as any);
    }
  }
  if (outOfScope.length) {
    console.log(`  ↳ ${bare} 另有 ${outOfScope.length} 根早于 ${REPAIR_FROM} 的异常（${outOfScope[0].tradeDate} ~ ${outOfScope[outOfScope.length - 1].tradeDate}）：非本次增量产出，未修，待人工核查`);
  }

  const sample = bad.length
    ? `amount ${bad[bad.length - 1].amount.toExponential(2)} → ${(bad[bad.length - 1].volume * bad[bad.length - 1].close * median(bars.slice(-60).map(ratioOf).filter(Number.isFinite).sort((a, b) => a - b))).toExponential(2)}`
    : '-';
  console.log(
    `${bare.padEnd(7)} ${String(bars.length).padStart(5)}  ${String(bad.length).padStart(11)}  ${(bad[0]?.tradeDate ?? '-').padEnd(20)} ${(bad[bad.length - 1]?.tradeDate ?? '-').padEnd(20)} ${sample}`,
  );
  if (!bad.length) continue;
  totalFixed += bad.length;
  if (!APPLY) continue;

  // 修正用「末 60 根的中位比值」：与最近一个稳定时代同量纲（正是增量追加 bar 应有的口径）
  const recentMed = median(bars.slice(-LOCAL_WIN * 3).map(ratioOf).filter(Number.isFinite).sort((a, b) => a - b));
  // 备份 → 修正 → 原子写 → 读回校验（与日线增量同一套护栏）
  mkdirSync(BACKUP, { recursive: true });
  const bk = path.join(BACKUP, f);
  if (!existsSync(bk)) copyFileSync(parquetPath, bk);
  for (const b of bad) b.amount = Number((b.volume * b.close * recentMed).toFixed(2));
  mkdirSync(TMP, { recursive: true });
  const json = path.join(TMP, `${bare}_amountrepair.json`);
  try {
    writeFileSync(json, JSON.stringify(bars), 'utf-8');
    await writeBarsJsonToParquet(json, parquetPath, bare);
    const probe = await readParquetBarCountAndLastDate(parquetPath);
    const wantLast = bars[bars.length - 1].tradeDate;
    if (!probe || probe.barCount !== bars.length || probe.lastDate !== wantLast) {
      hardFail.push(`${bare}: 读回校验失败（${probe?.barCount}/${probe?.lastDate} vs ${bars.length}/${wantLast}）——已保留备份`);
    }
  } catch (e: any) {
    hardFail.push(`${bare}: 写盘失败 ${e?.message || e}`);
  }
}

console.log(`\n合计异常 bar: ${totalFixed}`);
if (hardFail.length) {
  console.log('❌ 失败项:');
  for (const h of hardFail) console.log('  -', h);
  process.exit(1);
}
if (APPLY) console.log(`✅ 已修正并读回校验通过；备份目录 ${BACKUP}`);
else console.log('（DRY-RUN，未写盘；确认无误后加 --apply）');
