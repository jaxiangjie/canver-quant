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
 * 污染日第二证据（2026-11-18 tribunal）：污染只能来自「当天真的发生过同步写盘」。
 * data/backup/parquet/<YYYY-MM-DD>/ 是 dailyBarSync 每次写盘前的备份记录 —— 目录不存在的
 * 日期不可能被同步污染，多半是分红除权扎堆日（≥3 只同日除息即满足 MIN_CODES 的形状），
 * 一律不修、只列出供人工核实。
 *
 * 末根对齐闸门（2026-11-18 tribunal）：腾讯没有的本地末根**默认只告警不删除**——
 * 腾讯对单 code（ETF/债类常见）更新滞后、或标的停牌时，无条件 pop 会把底座文件的
 * 真实尾部静默砍掉。--drop-tail 显式开启删除，且必须同时满足：根数 ≤ MAX_TAIL_DROP、
 * 全部落在 [SINCE, GATE] 同步窗口内。
 *
 * 服务运行检测（2026-11-18 tribunal）：--apply 前探测 3000 端口，服务运行时拒绝写盘
 * （可用 --force 覆盖）——避免与运行中服务的 promote/同步并发写同一批 parquet。
 *
 * 修法：该日及之后整段 × k，k = (1+腾讯收益率)/(1+本地收益率)。整段等比缩放不改其他日收益率。
 *
 * 用法：
 *   npx tsx scripts/repair_hfq_breaks.ts                            # dry-run
 *   npx tsx scripts/repair_hfq_breaks.ts --apply                    # 写盘（自动备份 + 读回校验）
 *   npx tsx scripts/repair_hfq_breaks.ts --apply --drop-tail        # 允许删除腾讯缺失的末根
 *   npx tsx scripts/repair_hfq_breaks.ts --apply --force            # 服务运行时仍要写盘（不推荐）
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parquetReadObjects } from 'hyparquet';
import { fetchTencentHfqDaily, writeBarsJsonToParquet } from '../src/services/stagingData';
import { latestClosedTradingDay } from '../src/services/dailyBarSync';

const APPLY = process.argv.includes('--apply');
const DROP_TAIL = process.argv.includes('--drop-tail');
const FORCE = process.argv.includes('--force');
const DIFF_PT = 2;      // 单只当日收益率偏离阈值（百分点）—— 降到 2 是为了抓 511010 的 2.4%/次污染
const MIN_CODES = 3;    // 同日至少几只异常才判为同步污染日
const MAX_TAIL_DROP = 5; // --drop-tail 单只最多删除的末根数（超出 = 腾讯对该 code 严重滞后，交人工）
const SINCE = '2026-10-10'; // 只在这些日期之后找污染（此前为历史遗留，不动）
const PARQUET_DIR = path.resolve(process.cwd(), 'data', 'parquet', 'daily');
const STAMP = new Date().toISOString().slice(0, 10);
const BACKUP_BASE = path.resolve(process.cwd(), 'data', 'backup', 'parquet');
const BACKUP_OUT = path.resolve(BACKUP_BASE, `${STAMP}-hfqrepair`);
const TMP_DIR = path.resolve(process.cwd(), 'data', 'cache', 'staging');
const SERVER_PORT = 3000;
const GATE = latestClosedTradingDay();

/** 3000 端口有 HTTP 响应 = 工作台服务在跑（start-workbench.bat 同款探测） */
async function isServerRunning(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${SERVER_PORT}/`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

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
console.log(`共 ${files.length} 只 | 门禁日 ${GATE} | ${APPLY ? 'APPLY' : 'DRY-RUN'}${DROP_TAIL ? ' +DROP-TAIL' : ''}\n`);

if (APPLY && !FORCE) {
  const running = await isServerRunning();
  if (running) {
    console.error(
      `❌ 检测到工作台服务正在运行（localhost:${SERVER_PORT} 有响应）。` +
        `\n   并发写盘可能与服务端的 promote/同步交错；服务内存目录也还是修复前的快照。` +
        `\n   请先停服再 --apply，或确认风险后加 --force。dry-run 不受影响。`,
    );
    process.exit(1);
  }
}
if (APPLY) { mkdirSync(BACKUP_OUT, { recursive: true }); mkdirSync(TMP_DIR, { recursive: true }); }

// 污染日第二证据：同步写盘日期记录（备份目录名 = 纯日期目录，排除 -hfqrepair 等带后缀目录）
const syncWriteDates = new Set(
  (() => {
    try {
      return readdirSync(BACKUP_BASE)
        .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f))
        .map((f) => f.slice(0, 10));
    } catch {
      return [] as string[];
    }
  })(),
);
console.log(`同步写盘日期记录（backup 目录）: ${[...syncWriteDates].sort().join(', ') || '(无)'}\n`);

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

  // 末根对齐（2026-11-18 tribunal 闸门化）：腾讯没有的本地末根**默认只告警不删除**。
  // 旧实现无条件 pop —— 腾讯对单 code 更新滞后（ETF/债类常见）或标的停牌时，会把底座文件
  // 的真实尾部静默砍掉；「判污染要 ≥MIN_CODES 只一致，删数据却一只说了算」完全不对称。
  // 现在必须 --drop-tail 显式开启，且同时满足：根数 ≤ MAX_TAIL_DROP、全部落在
  // [SINCE, GATE] 同步窗口内；不满足则恢复原状并告警，交人工核实。
  const tcLast = [...tc.keys()].sort().pop()!;
  const extraTailBars: Bar[] = [];
  while (bars.length && bars[bars.length - 1].tradeDate > tcLast) {
    extraTailBars.unshift(bars.pop()!); // unshift 保持时间升序
  }
  if (extraTailBars.length) {
    const dates = extraTailBars.map((b) => b.tradeDate);
    const inWindow = dates.every((d) => d >= SINCE && d <= GATE);
    if (DROP_TAIL && inWindow && extraTailBars.length <= MAX_TAIL_DROP) {
      console.log(`${code}: 腾讯无 ${dates.join(',')} 的定稿数据 → 删除本地同名末根`);
    } else {
      bars.push(...extraTailBars);
      const why = !DROP_TAIL
        ? '未加 --drop-tail'
        : !inWindow
          ? `落在窗口外（[${SINCE}, ${GATE}]）`
          : `根数 ${extraTailBars.length} > MAX_TAIL_DROP=${MAX_TAIL_DROP}`;
      console.log(`${code}: 腾讯无 ${dates.join(',')} 的定稿数据 → 保留并告警（${why}），请人工核实`);
    }
  }

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

// ── 判定污染日：同日异常标的数 + 第二证据（当天必须有同步写盘记录）──
// 2026-11-18 tribunal：DIFF_PT=2 + MIN_CODES=3 的形状在分红除权扎堆日（单日几十只除息）
// 会被误触发，把所有偏离标的整段切到腾讯复权基准（一条序列两种口径）。污染只能来自
// 「当天真的发生过同步写盘」——备份目录的纯日期目录即写盘记录，零成本第二证据；
// 无记录的日期一律不修（多半是除权扎堆），只列出供人工核实。
const byDate = new Map<string, Anom[]>();
for (const { anoms } of store.values()) for (const a of anoms) {
  if (!byDate.has(a.date)) byDate.set(a.date, []);
  byDate.get(a.date)!.push(a);
}
const badDates = [...byDate.entries()]
  .filter(([d, v]) => v.length >= MIN_CODES && syncWriteDates.has(d))
  .map(([d]) => d)
  .sort();
const noSyncEvidenceDates = [...byDate.entries()]
  .filter(([d, v]) => v.length >= MIN_CODES && !syncWriteDates.has(d))
  .map(([d]) => d)
  .sort();
const ignoredDates = [...byDate.keys()].filter((d) => !badDates.includes(d) && !noSyncEvidenceDates.includes(d)).sort();

console.log(`同步污染日（≥${MIN_CODES} 只同时异常 且 当天有同步写盘记录）: ${badDates.join(', ') || '(无)'}`);
if (noSyncEvidenceDates.length) {
  console.log(
    `疑似除权扎堆日（≥${MIN_CODES} 只异常但当天无同步写盘记录，不修）: ${noSyncEvidenceDates.join(', ')}` +
      ` —— 如确属污染，请核对备份目录记录是否完整`,
  );
}
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
