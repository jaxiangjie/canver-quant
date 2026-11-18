/**
 * 日线增量同步（2026-10-15）——把统一池 parquet 推进到最新交易日并落盘。
 *
 * 背景：`liveMarketSync` 的同步只刷「快照字段」（现价/涨跌幅/ATR/PE/PB），**不碰 bars**，
 * 结果价格是最新的、但 EWMAC/波动率/目标股数全部基于旧 K 线——用户基于过期信号调仓。
 *
 * 为什么不是「append 腾讯的新 bar」也不是「腾讯全量覆盖」：
 * 实测（logs/diag_return_consistency.py）腾讯 hfq 与底座 parquet 在**重叠段的收益率**就不一致：
 *   - 512890 / 513180 / 513520 / 562500 / 512660：0.000%（同源，可安全对齐）
 *   - 多数个股：0.5%~2.3%（复权算法差异）
 *   - 510300：19.9% / 513100：80.8% / 510500：226.5%（本项目做过的「复权断裂重标定」修复，
 *     腾讯原始序列仍带假跳变）
 * 直接 append 腾讯绝对值 → 在衔接处制造假暴跌（如 601288: 15.91 → 10.17 = -36%）；
 * 直接全量覆盖 → 抹掉已修复的断裂、并把复权算法差异写进历史（波动率/回测口径漂移）。
 *
 * 本模块采用**收益率延续**：不动任何历史 bar，只把腾讯在缺口期的「真实日收益率」
 * 作用到 parquet 末根 close 上，依次递推生成新 bar。历史零改动、衔接零跳变、
 * 收益率取自真实行情。amount 按重叠段的「真实成交额 /（股数×hfq close）」中位数比例还原，
 * 避免用伪成交额污染 ADV。
 *
 * 历史段唯一事实源是**盘上 parquet**（2026-11-18 tribunal）：syncOne 先整读盘上数据再衔接，
 * 不消费内存 inst.bars —— 内存快照可能被 scanAndRescaleBreaks（>12% 跳变 rescale 分支）
 * 就地改写过（仅内存），或落后于外部修复脚本写盘后的真实状态；「历史零改动」由此由
 * 数据流本身保证，而非靠注释自觉。
 *
 * 安全护栏（写入即自校验，fail-closed）：
 *   1. 盘上 parquet 缺失/不可读 → fail-fast（2026-11-18 前置，无盘标的不再白打腾讯）
 *   2. 腾讯序列必须与现有 bars 有重叠日，否则拒绝（无法对齐口径）
 *   3. 新 bar 日期严格递增、严格晚于现末根，自然日间隔 ≤ MAX_GAP_DAYS
 *   4. 新 bar 单日收益率 |ret| ≤ MAX_DAILY_MOVE（A股 20cm 上限 + 余量）
 *   5. 写盘前备份原 parquet；写盘后读回校验行数与末根日期
 *   6. 任一只失败只影响该只，报告里显式列出原因，绝不静默
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import type { AShareBar, AShareInstrument } from '../types/ashare';
import {
  fetchTencentHfqDaily,
  writeBarsJsonToParquet,
  type StagingBar,
} from './stagingData';
import { readParquetBarCountAndLastDate, readParquetBars } from './parquetProbe';

export interface BarSyncItem {
  code: string;
  name: string;
  beforeLast: string;
  afterLast: string;
  appended: number;
  status: 'updated' | 'up-to-date' | 'failed';
  reason?: string;
  newBars?: { tradeDate: string; close: number; changePct: number }[];
}

export interface BarSyncReport {
  total: number;
  updated: number;
  upToDate: number;
  failed: number;
  results: BarSyncItem[];
  /** 整轮被闸门跳过（本地已是最新 / 刚查过无新增），未发起任何网络请求 */
  skipped?: boolean;
  reason?: string;
  /** 闸门基准：最近一个「已收盘」的工作日 */
  gateDate?: string;
}

const MAX_GAP_DAYS = 20; // 现末根 → 新首根 的自然日间隔上限（覆盖春节/国庆长假）
const MAX_DAILY_MOVE = 0.25; // 新 bar 单日收益率绝对值上限
/** 北京 15:00 收盘后，当日才可能产出完整日线（用 UTC+8 换算，避免服务器时区干扰） */
const CN_SETTLE_MINUTE_OF_DAY = 15 * 60;
/** 「刚查过且无新增」的短冷却：收盘瞬间连点仍会反复探测腾讯，保留一小段退避防 501 */
const NO_NEW_DATA_COOLDOWN_MS = 30_000;
let lastNoNewDataAt = 0;
// 目录可用环境变量覆盖（2026-11-18 tribunal）：PARQUET_DIR 与 realData 的 REAL_DATA_DIR
// 同源 —— 同步写入的目录必须就是统一池读取的目录。测试用独立目录隔离，绝不与生产数据
// 共享写入路径（test_bar_sync_gate 曾用真实在池标的 + 无隔离目录，fixture 日期一改就会
// 真实覆写生产底座）。
const PARQUET_DIR = process.env.REAL_DATA_DIR || path.resolve(process.cwd(), 'data', 'parquet', 'daily');
const BACKUP_DIR = process.env.DAILY_SYNC_BACKUP_DIR || path.resolve(process.cwd(), 'data', 'backup', 'parquet');
const TMP_DIR = process.env.DAILY_SYNC_TMP_DIR || path.resolve(process.cwd(), 'data', 'cache', 'analysis');

function bareOf(code: string): string {
  return String(code).replace(/\.(SH|SZ|BJ)$/i, '').slice(0, 6);
}

function dayGap(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.abs(tb - ta) / 86_400_000;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  if (!s.length) return 1;
  return s[Math.floor(s.length / 2)];
}

/**
 * 最近一个「已收盘」的工作日（YYYY-MM-DD，北京时区）。
 *
 * 用于「本地是否已经是最新」的判据：A 股只可能在工作日收盘后产出新日线，
 * 所以只要本地末根 ≥ 最近已收盘工作日，就没有新数据可补 —— 这正是用户要的
 * 「检查本地已经更新就跳过重复点击」。节假日会被误判成交易日（结果只会多拉一次、
 * 拿到 up-to-date 不写盘），方向上是「宁可多查一次，绝不谎报最新」。
 */
export function latestClosedTradingDay(now: Date = new Date()): string {
  const bj = new Date(now.getTime() + 8 * 3_600_000);
  const today = new Date(Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()));
  const minuteOfDay = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  const dow = today.getUTCDay();
  const isWeekday = dow !== 0 && dow !== 6;
  const d = isWeekday && minuteOfDay >= CN_SETTLE_MINUTE_OF_DAY ? today : prevWeekday(today);
  return d.toISOString().slice(0, 10);
}

/** 从 from 的前一天起，向前找到最近的工作日 */
function prevWeekday(from: Date): Date {
  let x = new Date(from.getTime());
  do {
    x = new Date(x.getTime() - 86_400_000);
  } while (x.getUTCDay() === 0 || x.getUTCDay() === 6);
  return x;
}

/** 单只标的的本地末根交易日（空串 = 无 bars） */
function lastBarDateOf(inst: AShareInstrument): string {
  const bars = inst.bars;
  return bars && bars.length ? bars[bars.length - 1].tradeDate : '';
}

/**
 * 收益率延续：把腾讯在 (lastDate, ...] 的真实日收益率作用到 parquet 末根 close 之上。
 * 返回合并后的完整 bars（仅 8 个 parquet 字段）与新增 bar 摘要。
 */
export function stitchByReturns(
  existing: AShareBar[],
  tencent: StagingBar[],
): { ok: true; merged: StagingBar[]; appended: StagingBar[] } | { ok: false; reason: string } {
  if (!existing.length) return { ok: false, reason: '现有 bars 为空' };
  const last = existing[existing.length - 1];
  const lastDate = last.tradeDate;

  // 重叠锚点：腾讯序列中 ≤ 现末根的最后一根（用于取真实收益率、还原 amount 比例）
  const overlap = tencent.filter((b) => b.tradeDate <= lastDate).slice(-60);
  const anchor = overlap[overlap.length - 1];
  if (!anchor) {
    return { ok: false, reason: `腾讯序列与现有 bars 无重叠日（腾讯最早=${tencent[0]?.tradeDate}，现末根=${lastDate}）` };
  }

  const fresh = tencent.filter((b) => b.tradeDate > lastDate);
  if (!fresh.length) return { ok: true, merged: [], appended: [] };

  // 连续性校验：新首根与现末根、以及新 bar 之间的自然日间隔
  if (dayGap(lastDate, fresh[0].tradeDate) > MAX_GAP_DAYS) {
    return { ok: false, reason: `缺口过大：${lastDate} → ${fresh[0].tradeDate}（超 ${MAX_GAP_DAYS} 自然日）` };
  }
  for (let i = 1; i < fresh.length; i++) {
    if (fresh[i].tradeDate <= fresh[i - 1].tradeDate) {
      return { ok: false, reason: `新 bar 日期非严格递增：${fresh[i - 1].tradeDate} → ${fresh[i].tradeDate}` };
    }
    if (dayGap(fresh[i - 1].tradeDate, fresh[i].tradeDate) > MAX_GAP_DAYS) {
      return { ok: false, reason: `新 bar 间隔异常：${fresh[i - 1].tradeDate} → ${fresh[i].tradeDate}` };
    }
  }

  // amount 还原比例：必须用**现有 parquet 自身**的 amount/(volume×hfq close) 中位数。
  // ⚠️ 不能用腾讯序列算（2026-10-15 实测踩坑）：腾讯 hfq 的 amount 是构造值（≡ volume×close，
  // 该比值中位数恒为 1 —— realData 的 detectSyntheticAmount 正是靠这个指纹识别 staging 源），
  // 拿它当比例会让新增 bar 的 amount = volume×hfqClose：对复权因子 f≈97 的福耀直接放大 95 倍，
  // 把 ADV / 冲击成本 / 换手率一并污染。parquet 自身的比值即「市价口径 ÷ 后复权口径」的换算系数
  // （510300 实测 0.80 ≈ 该标的 hfqToMarketFactor），用它还原才与历史同量纲。
  const selfRatios = existing
    .slice(-60)
    .filter((b) => (b as any).amount > 0 && b.volume > 0 && b.close > 0)
    .map((b) => (b as any).amount / (b.volume * b.close))
    .filter((r) => Number.isFinite(r) && r > 0);
  const amountRatio = selfRatios.length ? median(selfRatios) : 1;

  let prevHfqClose = last.close;
  let prevTcClose = anchor.close;
  const appended: StagingBar[] = [];
  for (const b of fresh) {
    const ret = b.close / prevTcClose - 1;
    if (!Number.isFinite(ret) || Math.abs(ret) > MAX_DAILY_MOVE) {
      return { ok: false, reason: `${b.tradeDate} 日收益率异常：${(ret * 100).toFixed(2)}%（超 ±${MAX_DAILY_MOVE * 100}% 护栏）` };
    }
    const scale = prevHfqClose / prevTcClose;
    const nOpen = Number((b.open * scale).toFixed(4));
    const nHigh = Number((b.high * scale).toFixed(4));
    const nLow = Number((b.low * scale).toFixed(4));
    const nClose = Number((b.close * scale).toFixed(4));
    if (!(nHigh >= Math.max(nOpen, nClose) && nLow <= Math.min(nOpen, nClose) && nLow > 0)) {
      return { ok: false, reason: `${b.tradeDate} OHLC 关系无效（H=${nHigh} L=${nLow} O=${nOpen} C=${nClose}）` };
    }
    appended.push({
      tradeDate: b.tradeDate,
      open: nOpen,
      high: nHigh,
      low: nLow,
      close: nClose,
      volume: b.volume,
      amount: Number((b.volume * nClose * amountRatio).toFixed(2)),
    });
    prevHfqClose = nClose;
    prevTcClose = b.close;
  }

  const merged: StagingBar[] = [
    ...existing.map((b) => ({
      tradeDate: b.tradeDate,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
      amount: (b as any).amount ?? b.volume * b.close,
    })),
    ...appended,
  ];
  return { ok: true, merged, appended };
}

/** 单只标的的日线增量同步（读盘 → 拉取 → 校验 → 备份 → 落盘 → 读回校验） */
async function syncOne(inst: AShareInstrument): Promise<BarSyncItem> {
  const bare = bareOf(inst.code);
  const fail = (reason: string): BarSyncItem => ({
    code: bare,
    name: inst.name || bare,
    beforeLast: '',
    afterLast: '',
    appended: 0,
    status: 'failed',
    reason,
  });

  // 2026-11-18 tribunal：以**盘上 parquet**为唯一事实源，不再拿内存 inst.bars 当历史段。
  // 内存快照可能被 realData 加载时的 scanAndRescaleBreaks（>12% 跳变 rescale 分支）就地改写
  // 而只存在于内存——直接整文件覆写会把启发式改写永久写穿盘上数据；外部修复脚本
  //（repair_hfq_breaks 等）直接改盘后，内存还是修复前快照，下一次同步会把修复整个冲掉。
  // 读盘为锚后：写盘内容恒等于「盘上历史 + 收益率延续的新增」，历史零改动由数据流本身保证。
  // parquet 探测前置也让无盘标的 fail-fast（不再白打腾讯）。
  const parquetPath = path.join(PARQUET_DIR, `${bare}_hfq.parquet`);
  const diskBars = await readParquetBars(parquetPath);
  if (!diskBars || !diskBars.length) {
    return fail(`盘上 parquet 缺失/无数据：${parquetPath}（需先入池）`);
  }
  const diskLast = diskBars[diskBars.length - 1].tradeDate;
  const memBars = (inst.bars || []) as AShareBar[];
  const memLast = memBars.length ? memBars[memBars.length - 1].tradeDate : '';
  const base: Omit<BarSyncItem, 'status' | 'appended'> = {
    code: bare,
    name: inst.name || bare,
    beforeLast: diskLast,
    afterLast: diskLast,
  };

  let fresh: StagingBar[];
  // 闸门日期同时用作：① 腾讯请求的 end 槽（防「实时模式」当天 hfq 未定稿）
  // ② fresh 裁剪上限（双保险：即便接口返回了未收盘的当天 bar，也不写盘）
  const gateDate = latestClosedTradingDay();
  try {
    fresh = (await fetchTencentHfqDaily(bare, 1280, diskLast, gateDate)).filter(
      (b) => b.tradeDate <= gateDate,
    );
  } catch (e: any) {
    return { ...base, appended: 0, status: 'failed', reason: `腾讯拉取失败：${e?.message || e}` };
  }

  const stitched = stitchByReturns(diskBars as unknown as AShareBar[], fresh);
  if (!stitched.ok) return { ...base, appended: 0, status: 'failed', reason: stitched.reason };
  if (!stitched.appended.length) {
    // 内存与盘上末根不一致时如实提示（内存快照过期或被改写，盘上为准，服务端同步后会重载目录）
    const note =
      memLast && memLast !== diskLast
        ? `内存快照末根 ${memLast} ≠ 盘上末根 ${diskLast}，已按盘上数据为准`
        : undefined;
    return { ...base, appended: 0, status: 'up-to-date', reason: note };
  }

  const afterLast = stitched.appended[stitched.appended.length - 1].tradeDate;

  // 备份原文件（同日同 code 只备份一次，保留首个快照）
  try {
    const day = new Date().toISOString().slice(0, 10);
    mkdirSync(path.join(BACKUP_DIR, day), { recursive: true });
    const backupPath = path.join(BACKUP_DIR, day, `${bare}_hfq.parquet`);
    if (!existsSync(backupPath)) copyFileSync(parquetPath, backupPath);
  } catch (e: any) {
    return { ...base, appended: 0, status: 'failed', reason: `备份失败（已中止写入）：${e?.message || e}` };
  }

  // 写 JSON → pyarrow 原子写 + 读回逐根自校验
  mkdirSync(TMP_DIR, { recursive: true });
  const tmpJson = path.join(TMP_DIR, `${bare}_append_${Date.now()}.json`);
  try {
    writeFileSync(tmpJson, JSON.stringify(stitched.merged), 'utf-8');
    await writeBarsJsonToParquet(tmpJson, parquetPath, bare);
  } catch (e: any) {
    return { ...base, appended: 0, status: 'failed', reason: `落盘失败：${e?.message || e}` };
  } finally {
    try {
      if (existsSync(tmpJson)) unlinkSync(tmpJson);
    } catch {
      /* 临时文件清理失败不影响结果 */
    }
  }

  // 读回校验：行数与末根日期必须符合预期（写入必自校验）
  const probe = await readParquetBarCountAndLastDate(parquetPath);
  if (!probe || probe.barCount !== stitched.merged.length || probe.lastDate !== afterLast) {
    return {
      ...base,
      appended: 0,
      status: 'failed',
      reason: `读回校验不一致（期望 ${stitched.merged.length} 根 / ${afterLast}，实际 ${probe?.barCount ?? 'n/a'} 根 / ${probe?.lastDate ?? 'n/a'}）——已保留备份`,
    };
  }

  let prevClose = diskBars[diskBars.length - 1].close;
  const newBars = stitched.appended.map((b) => {
    const changePct = Number((((b.close - prevClose) / prevClose) * 100).toFixed(2));
    prevClose = b.close;
    return { tradeDate: b.tradeDate, close: b.close, changePct };
  });
  return { ...base, afterLast, appended: stitched.appended.length, status: 'updated', newBars };
}

/** 串行队列：同步是重 IO + 写盘操作，绝不并发交叉（沿用 staging 锁的设计意图） */
let chain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined); // tracked promise 必须挂 catch（Node22 unhandled-rejection=throw）
  return next;
}

/**
 * 全池（或指定 codes）日线增量同步：把 parquet 推进到腾讯可提供的最新交易日。
 * 逐只隔离：单只失败不影响其他标的，失败原因进报告。
 */
export async function syncDailyBars(
  instruments: AShareInstrument[],
  opts: { codes?: string[] } = {},
): Promise<BarSyncReport> {
  const wanted = opts.codes && opts.codes.length
    ? new Set(opts.codes.map((c) => bareOf(c)))
    : null;
  const targets = instruments.filter((i) => {
    if (!i?.code) return false;
    if ((i as any).syntheticBars || (i as any).dataSource === 'fallback') return false;
    return wanted ? wanted.has(bareOf(i.code)) : true;
  });

  return serialize(async () => {
    // ── 数据闸门（2026-10-15 引入；2026-11-18 tribunal 改为逐只判定）：整轮跳过的唯一条件是
    // 「没有任何一只落后于最近已收盘工作日」。旧判据取全池末根**最大值**——一轮里 2 只因
    // 腾讯 501 失败后，max 已 ≥ gate，再点同步整轮 skipped 且 reason 谎称「本地已是最新」，
    // 失败腿当天无法经全局按钮重试（实测 510500/588000 滞后 2 个交易日却谎报最新）。
    // 逐只判定后：stale 非空就只同步 stale（syncOne 对已最新者本来就是 up-to-date no-op）。
    // 位置仍在 serialize 内部：并发的第二次点击排在上一次之后执行，本地已推进的腿自然不再
    // 落后 → 无 stale 时零请求返回（「多点几次没事」的机制不变）。
    const gate = latestClosedTradingDay();
    const staleTargets = targets.filter((i) => {
      const d = lastBarDateOf(i);
      return !d || d < gate;
    });
    if (targets.length > 0 && staleTargets.length === 0) {
      const localMax = targets.reduce((m, i) => {
        const d = lastBarDateOf(i);
        return d > m ? d : m;
      }, '');
      return {
        total: targets.length,
        updated: 0,
        upToDate: targets.length,
        failed: 0,
        skipped: true,
        gateDate: gate,
        reason: `本地全部 ${targets.length} 只均不落后于最近已收盘工作日 ${gate}（末根 ${localMax}），已跳过网络请求`,
        results: [],
      };
    }
    // 刚查过且当时无任何新增：市场尚未发布当日日线，短时间内不必再打腾讯（防 501 限流）。
    // 注意只在「无新增」时退避 —— 有新增时日期闸门已能正确跳过，不需要也不应该压时间窗。
    if (Date.now() - lastNoNewDataAt < NO_NEW_DATA_COOLDOWN_MS) {
      return {
        total: targets.length,
        updated: 0,
        upToDate: targets.length,
        failed: 0,
        skipped: true,
        gateDate: gate,
        reason: `刚刚检查过且无新增日线（${NO_NEW_DATA_COOLDOWN_MS / 1000}s 内），已跳过重复请求`,
        results: [],
      };
    }

    const results: BarSyncItem[] = [];
    let first = true;
    for (const inst of targets) {
      // 标的间礼貌间隔（2026-10-15 实测）：连续高频拉取会触发腾讯 hfq 接口 501 限流，
      // 间隔 400ms 显著降低触发概率；配合 fetchTencentHfqDaily 的多入口 fallback 兜底。
      if (!first) await new Promise((r) => setTimeout(r, 400));
      first = false;
      try {
        results.push(await syncOne(inst));
      } catch (e: any) {
        results.push({
          code: bareOf(inst.code),
          name: inst.name || '',
          beforeLast: '',
          afterLast: '',
          appended: 0,
          status: 'failed',
          reason: `未预期异常：${e?.message || e}`,
        });
      }
    }
    const summary = {
      total: results.length,
      updated: results.filter((r) => r.status === 'updated').length,
      upToDate: results.filter((r) => r.status === 'up-to-date').length,
      failed: results.filter((r) => r.status === 'failed').length,
      results,
    };
    // 「无新增且零失败」才记冷却（2026-11-18 tribunal）：全轮网络失败（updated=0 且 failed>0）
    // 不是「市场尚未发布」，给失败盖上「刚刚检查过且无新增」的冷却章会阻止用户立即重试。
    if (summary.updated === 0 && summary.failed === 0) lastNoNewDataAt = Date.now();
    return summary;
  });
}
