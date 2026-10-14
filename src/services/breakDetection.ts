/**
 * 复权断裂检测 + VWAP 甄别重标定 —— 单一真相模块（2026-10-14 tribunal G1c6/G2c3）。
 *
 * 旧实现把整套逻辑抄了三份（realData 内联块 / stagingData.detectAndFixBreaks /
 * test_break_detection 复刻），已发生漂移（旧版还留着"假设当日收益 0"兜底）。
 * 现在两边都 import 本模块；测试直接测本模块（经 detectAndFixBreaks 暴露）。
 *
 * 背景：上游 parquet 数据湖 2026-09-01 曾重建复权基准——510500 close 2.42→7.88（+225%）、
 * 513100 11.37→2.23（-80%），而当日 VWAP（amount/volume，不经复权）平稳。假跳变使
 * 年化波动率虚高，目标股数被压错。甄别逻辑：
 * - A股 1996-12-16 起有涨跌停（10%，双创 20%），|收益|>12% 的单日跳变在限价制度下
 *   不可能是真实行情（510300 2026-09-28 的 -21.7% 分红除权断裂即此类）；
 * - 1990s 无涨跌停制度，整体跳过；
 * - 候选再用 VWAP 连续性判定：断裂前后 close/vwap 比值中位数跳变 >15% = 复权基准被
 *   切换（市价没动、是复权体系被换），把断裂日及之后 OHLC 按 factor 缩回断裂前基准；
 * - VWAP 缺失/合成源（noVwapJudge）一律保守不动作——数据缺失必须 fail-loud，
 *   绝不捏造"当日收益 0"（tribunal V5：guard 收紧后该兜底会篡改合法涨跌停）。
 */

/** 单日 |收益| 候选阈值（抓 12%~20% 涨跌停之外的复权跳变；误入者由 VWAP 甄别放行） */
export const BREAK_THRESHOLD = 0.12;
/** 涨跌停制度起点：此日期之前的超界跳变不检测（1990s 无涨跌停，暴涨暴跌是常态） */
export const LIMIT_UP_ERA_START = '1996-12-16';
/** close/vwap 比值在断裂前后的中位数漂移阈值（超过即判复权基准切换） */
export const RATIO_DRIFT = 0.15;
/** 断裂前后各取多少日计算 close/vwap 比值中位数 */
export const RATIO_WINDOW = 10;
/** factor guard：仅排除 |factor-1|<5% 的噪声。不能用 1.5 倍大阈——510300 分红除权
 *  断裂 factor≈1.25 正是要修的对象（tribunal V5 教训）。 */
export const FACTOR_GUARD_MIN = 0.95;
export const FACTOR_GUARD_MAX = 1.05;

export interface BreakScanRow {
  /**
   * 日期（YYYY-MM-DD 字符串或可被 normDate 规范化的值）。
   * 字段名兼容 date / tradeDate（realData 的 RawRow 用 date，staging 的 StagingBar
   * 用 tradeDate——鸭子类型读取，避免包装层做无谓的 O(n) 拷贝）。
   */
  date?: unknown;
  tradeDate?: unknown;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

export interface BreakFinding {
  date: string;
  pct: number;
  action: 'rescaled' | 'warn-only';
  /** warn-only 的原因（调用方据此打诚实日志） */
  reason?: 'synthetic_source' | 'vwap_window_missing' | 'vwap_aligned';
}

export interface BreakScanResult {
  /** 就地修复后的同一数组（引用不变，调用方持有的视图同步生效） */
  rows: BreakScanRow[];
  findings: BreakFinding[];
  rescaledCount: number;
  /** 每个 rescaled 事件的细节（供调用方打带上下文的日志） */
  rescaledEvents: { date: string; pct: number; factor: number }[];
}

export interface BreakScanOptions {
  /** 日期规范化（realData 传 normDate 处理 Date 对象；staging 传字符串切片） */
  normDate: (d: unknown) => string;
  /**
   * 强制视为合成 amount 源（无独立 VWAP 锚）。默认不传——自动按数据驱动检测：
   * amount 与 volume×close 系统性恒等（伪成交额指纹，如 staging 腾讯源的
   * volShares×close）即判合成，VWAP 甄别对其数学上不可用，恒 warn-only。
   * 上游若换源提供真实 amount，甄别自动恢复（无需改代码）。
   */
  noVwapJudge?: boolean;
}

/**
 * 伪成交额指纹检测：抽样全部行，amount 与 volume×close 系统性恒等 → 合成源。
 * 真实成交额不可能逐日恰好等于收盘×量（涨跌停/盘中偏离都会打破恒等）。
 * 导出供 realData 的 vwapPrice 口径判定复用（tribunal G1c4）。
 */
export function detectSyntheticAmount(rows: BreakScanRow[]): boolean {
  if (!rows.length) return false;
  let probed = 0;
  for (const r of rows) {
    const vol = Number(r.volume);
    const amt = Number(r.amount);
    const close = Number(r.close);
    if (!(vol > 0 && amt > 0 && close > 0)) continue;
    if (Math.abs(amt - close * vol) / (close * vol) >= 0.001) return false;
    probed++;
  }
  return probed > 0; // 至少要有可判定的行；全缺失不判合成（走 VWAP 缺失分支）
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * 就地扫描并重标定复权断裂。返回 findings/rescaled 统计；行的 open/high/low/close
 * 已被修复。amount 的处理是数据驱动的：仅当 amount 与旧 close×volume 系统性恒等
 * （伪成交额指纹）时才同步缩放，保持自洽；真实成交额一律不动（复权基准切换不改变
 * 真实世界的成交金额）。
 */
export function scanAndRescaleBreaks<T extends BreakScanRow>(
  rows: T[],
  opts: BreakScanOptions,
): BreakScanResult {
  const { normDate } = opts;
  const noVwapJudge = opts.noVwapJudge ?? detectSyntheticAmount(rows);
  const n = rows.length;
  const closes = rows.map((r) => Number(r.close));
  const dates = rows.map((r) => normDate((r as { date?: unknown; tradeDate?: unknown }).date ?? (r as { tradeDate?: unknown }).tradeDate));

  // VWAP 序列：合成源不喂（喂了就是检测器自证清白）
  const vwapAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const vol = Number(rows[i].volume);
    const amt = Number(rows[i].amount);
    vwapAt.push(vol > 0 && amt > 0 && !noVwapJudge ? amt / vol : 0);
  }

  const findings: BreakFinding[] = [];
  const rescaledEvents: { date: string; pct: number; factor: number }[] = [];
  let rescaledCount = 0;

  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1];
    if (pc <= 0) continue;
    if (dates[i] < LIMIT_UP_ERA_START) continue;
    const r = (closes[i] - pc) / pc;
    if (Math.abs(r) <= BREAK_THRESHOLD) continue;

    const before: number[] = [];
    for (let j = Math.max(0, i - RATIO_WINDOW); j < i; j++) {
      if (vwapAt[j] > 0) before.push(closes[j] / vwapAt[j]);
    }
    const after: number[] = [];
    for (let j = i; j < Math.min(n, i + RATIO_WINDOW); j++) {
      if (vwapAt[j] > 0) after.push(closes[j] / vwapAt[j]);
    }
    const ratioBefore = medianOf(before);
    const ratioAfter = medianOf(after);

    let factor = 0;
    let skipReason: 'synthetic_source' | 'vwap_window_missing' | 'vwap_aligned' | undefined;
    if (noVwapJudge) {
      skipReason = 'synthetic_source';
    } else if (ratioBefore > 0 && ratioAfter > 0 && Math.abs(ratioAfter / ratioBefore - 1) > RATIO_DRIFT) {
      factor = ratioBefore / ratioAfter; // 复权基准被切换：缩回断裂前基准
    } else if (before.length === 0 || after.length === 0) {
      // VWAP 缺失/不可用（tribunal V5）：不再假设"当日收益约 0"捏造 factor。
      // 旧写法 factor=pc/closes[i] 在 guard 收紧到 ±5% 后，对任何 |r|>12% 的候选必然
      // 穿过闸门，把缺 amount 的合法涨跌停/停牌日抹成平盘并级联篡改后续全部历史——
      // 数据缺失必须 fail-loud，不能 fail-open。
      skipReason = 'vwap_window_missing';
    } else {
      skipReason = 'vwap_aligned';
    }
    // 其余情形一律 warn-only，不动作。

    if (factor > 0 && (factor < FACTOR_GUARD_MIN || factor > FACTOR_GUARD_MAX)) {
      for (let j = i; j < n; j++) {
        const row = rows[j] as BreakScanRow;
        const oldClose = Number(row.close);
        const vol = Number(row.volume);
        const amt = Number(row.amount);
        // 伪成交额指纹（amount≡旧close×vol）：同步缩放保持自洽；真实成交额不动
        const syntheticAmount =
          vol > 0 && amt > 0 && oldClose > 0 && Math.abs(amt - oldClose * vol) / (oldClose * vol) < 0.001;
        row.open = Number(row.open) * factor;
        row.high = Number(row.high) * factor;
        row.low = Number(row.low) * factor;
        row.close = Number(row.close) * factor;
        if (syntheticAmount) row.amount = Number(row.close) * vol;
        closes[j] = Number(row.close);
      }
      rescaledCount++;
      rescaledEvents.push({ date: dates[i], pct: Number((r * 100).toFixed(1)), factor });
      findings.push({ date: dates[i], pct: Number((r * 100).toFixed(1)), action: 'rescaled' });
    } else {
      findings.push({
        date: dates[i],
        pct: Number((r * 100).toFixed(1)),
        action: 'warn-only',
        reason: skipReason,
      });
    }
  }

  return { rows, findings, rescaledCount, rescaledEvents };
}
