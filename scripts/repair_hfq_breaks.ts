/**
 * 修复 hfq 序列的「同步污染」假跳变。
 *
 * 判据（2026-11-17 定稿）：不做全历史逐日修正 —— 本地与腾讯的 hfq 复权处理在历史除权日
 * 本就存在 2~8% 差异（福耀 2015 涨跌停、神华 53 处除息），按单标的阈值修会误伤历史。
 *
 * 真正要修的是「同步日污染」：`fetchTencentHfqDaily` 实时模式返回当天未定稿 hfq，
 * 每次同步把当天的假跳变固化一根。其指纹是**跨标的共性**——同一天多只标的同时出现
 * 10~25% 的收益率偏离。因此只修「≥MIN_CODES 只标的同时异常」的日期。
 *
 * 修法：该日及之后整段 × k，k = (1+腾讯收益率)/(1+本地收益率)。整段等比缩放不改其他日收益率。
 *
 * 用法：
 *   npx tsx scripts/repair_hfq_breaks.ts            # dry-run
 *   npx tsx scripts/repair_hfq_breaks.ts --apply    # 写盘（自动备份 + 读回校验）
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import { fetchTencentHfqDaily, writeBarsJsonToParquet } from '../src/services/stagingData';
import { latestClosedTradingDay } from '../src/services/dailyBarSync';

const APPLY = process.argv.includes('--apply');
const DIFF_PT = 2;      // 单只当日收益率偏离阈值（百分点）—— 降到 2 是为了抓 511010 的 2.4%/次污染
const MIN_CODES = 3;    // 同日至少几只异常才判为同步污染日
const SINCE = '2026-10-10'; // 只在这些日期之后找污染（此前为历史遗留，不动）
const PARQUET_DIR = path.resolve(process.cwd(), 'data', 'parquet', 'daily');
const STAMP = new Date().toISOString().slice(0, 10);
const BACKUP_OUT = path.resolve(process.cwd(), 'data', 'backup', 'parquet', `${STAMP}-hfqrepair`);
const TMP_DIR = path.resolve(process.cwd(), 'data', 'cache', 'staging');
const GATE = latestClosedTradingDay();

interface Bar { tradeDate: string; open: number; high: number; low: number; close: number; volume: number; amount: number }
interface Anom { code: string; idx: number; date: string; localRet: number; realRet: number; k: number }

async function readBars(p: string): Promise<Bar[]> {
  const buf = readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const rows: any[] = await parquetReadObjects({ file: ab });
  rows.sort((a, b) => Number(a.date) - Number(b.date));
  return rows.map((r) => ({
    tradeDate: new Date(Number(r.date)).toISOString().slice(0, 10),
    open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
    volume: Number(r.volume), amount: Number(r.amount),
  }));
}

const files = readdirSync(PARQUET_DIR).filter((f) => f.endsWith('_hfq.parquet')).sort();
console.log(`共 ${files.length} 只 | 门禁日 ${GATE} | ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
if (APPLY) { mkdirSync(BACKUP_OUT, { recursive: true }); mkdirSync(TMP_DIR, { recursive: true }); }

// ── 第一遍：采集所有异常 ──
const store = new Map<string, { bars: Bar[]; anoms: Anom[]; tc: Map<string, number> }>();
for (const f of files) {
  const code = f.replace('_hfq.parquet', '');
  const bars = await readBars(path.join(PARQUET_DIR, f));
  if (bars.length < 30) continue;
  let tcArr;
  try { tcArr = await fetchTencentHfqDaily(code, 6000, bars[0].tradeDate, GATE); }
  catch (e: any) { console.log(`${code}: 腾讯失败 ${e?.message || e}`); continue; }
  const tc = new Map(tcArr.map((b) => [b.tradeDate, b.close]));
  if (!tc.size) { console.log(`${code}: 腾讯序列为空，跳过`); continue; }

  // 末根对齐：腾讯没有的日期 = 本地那根没有定稿依据（多为当天未生成/停牌），直接删除。
  // 不删的话它会保留自身假跌幅、又被前面几次修正的 k 累积放大（601318 实测剩 143.65 vs 应有 178）。
  const tcLast = [...tc.keys()].sort().pop()!;
  const dropped: string[] = [];
  while (bars.length && bars[bars.length - 1].tradeDate > tcLast) {
    dropped.push(bars.pop()!.tradeDate);
  }
  if (dropped.length) console.log(`${code}: 腾讯无 ${dropped.join(',')} 的定稿数据 → 删除本地同名末根`);

  const anoms: Anom[] = [];
  let prev: { c: number; t: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const t = tc.get(bars[i].tradeDate);
    if (!t || !(t > 0)) continue;
    if (prev) {
      const lr = bars[i].close / prev.c - 1;
      const rr = t / prev.t - 1;
      if (Math.abs((lr - rr) * 100) > DIFF_PT && bars[i].tradeDate >= SINCE) {
        anoms.push({ code, idx: i, date: bars[i].tradeDate, localRet: lr * 100, realRet: rr * 100, k: (1 + rr) / (1 + lr) });
      }
    }
    prev = { c: bars[i].close, t };
  }
  store.set(code, { bars, anoms, tc });
  process.stdout.write(`.`);
}
console.log('\n');

// ── 判定污染日：同日异常标的数 ──
const byDate = new Map<string, Anom[]>();
for (const { anoms } of store.values()) for (const a of anoms) {
  if (!byDate.has(a.date)) byDate.set(a.date, []);
  byDate.get(a.date)!.push(a);
}
const badDates = [...byDate.entries()].filter(([, v]) => v.length >= MIN_CODES).map(([d]) => d).sort();
const ignoredDates = [...byDate.keys()].filter((d) => !badDates.includes(d)).sort();

console.log(`同步污染日（≥${MIN_CODES} 只同时异常）: ${badDates.join(', ') || '(无)'}`);
if (ignoredDates.length) console.log(`忽略的单只异常日（历史除权/涨跌停，不动）: ${ignoredDates.join(', ')}\n`);

// ── 第二遍：应用修正 ──
let fixed = 0, clean = 0;
for (const [code, { bars, anoms, tc }] of store) {
  const mine = anoms.filter((a) => badDates.includes(a.date));
  if (!mine.length) { clean++; continue; }
  const out = bars.map((b) => ({ ...b }));
  for (const a of mine) {
    for (let i = a.idx; i < out.length; i++) {
      out[i].open = Number((out[i].open * a.k).toFixed(4));
      out[i].high = Number((out[i].high * a.k).toFixed(4));
      out[i].low = Number((out[i].low * a.k).toFixed(4));
      out[i].close = Number((out[i].close * a.k).toFixed(4));
      out[i].amount = Number((out[i].amount * a.k).toFixed(2));
    }
  }
  // 复验：修复后同一判据不应再有残留
  const residual: string[] = [];
  let pv: { c: number; t: number } | null = null;
  for (const b of out) {
    const t = tc.get(b.tradeDate);
    if (!t || !(t > 0)) continue;
    if (pv) {
      const lr = b.close / pv.c - 1;
      const rr = t / pv.t - 1;
      if (Math.abs((lr - rr) * 100) > DIFF_PT && b.tradeDate >= SINCE && badDates.includes(b.tradeDate)) {
        residual.push(b.tradeDate);
      }
    }
    pv = { c: b.close, t };
  }
  const tail = out[out.length - 1];
  console.log(
    `${code.padEnd(7)} 修 ${String(mine.length).padStart(2)} 处 | ` +
      mine.map((a) => `${a.date}(本${a.localRet.toFixed(1)}%/真${a.realRet.toFixed(1)}%)`).join(' ') +
      ` | 末根 ${tail.tradeDate} close ${tail.close.toFixed(2)} (原 ${bars[bars.length - 1].close.toFixed(2)})` +
      ` | 复验 ${residual.length ? '❌ ' + residual.join(',') : '✅'}`,
  );

  if (APPLY) {
    const p = path.join(PARQUET_DIR, `${code}_hfq.parquet`);
    copyFileSync(p, path.join(BACKUP_OUT, `${code}_hfq.parquet`));
    const tmpJson = path.join(TMP_DIR, `${code}_repair_${Date.now()}.json`);
    writeFileSync(tmpJson, JSON.stringify(out), 'utf-8');
    await writeBarsJsonToParquet(tmpJson, p, code);
    const verify = await readBars(p);
    const ok = verify.length === out.length
      && verify[verify.length - 1].tradeDate === tail.tradeDate
      && Math.abs(verify[verify.length - 1].close - tail.close) < 0.01;
    console.log(ok ? `        ✅ 读回校验通过（${verify.length} 根）` : `        ❌ 读回校验失败`);
    if (ok) fixed++;
  } else fixed++;
}

console.log(`\n=== 汇总 ===`);
console.log(`无污染 ${clean} 只 | ${APPLY ? '已修复' : '待修复'} ${fixed} 只 | 污染日 ${badDates.length} 个`);
if (!APPLY) console.log('（dry-run，未写盘。备份将写入 ' + BACKUP_OUT + '）');
