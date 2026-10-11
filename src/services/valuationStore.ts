import fs from 'fs';
import path from 'path';
import { AShareInstrument } from '../types/ashare';

/**
 * 估值快照库：为「真实 PE/PB → 历史分位 → 估值区间 → ERP tilt」链路提供本地数据底座。
 *
 * 数据来源（双通道互验规则见 docs/DATA_SOURCE_VALIDATION_2026-10-11.md）：
 * - 个股：腾讯快照 parts[39]=PE-TTM / parts[46]=PB，东财 f115/f23 互验（差>5% 拒写）
 * - 宽基 ETF：映射对应指数的腾讯指数 PE（东财指数 PE 为假值不可用 → 单通道 tencent-index）
 * - 指数历史：scripts/backfill_index_pe.py（AKShare/乐咕乐股）一次性回补 + 每日同步追加
 *
 * 分位口径：trailing 750 个观测（约3年）内 ≤ 当前值 的比例；
 * 观测 < 250 条（约1年）时不产出分位（冷启动诚实空态，宁缺勿假）。
 */

// 宽基 ETF → 对应指数（6位代码）。只映射有把握的；512890 跟踪中证红利低波（腾讯无对应指数 PE），保持无估值。
export const ETF_INDEX_MAP: Record<string, string> = {
  '510300': '000300', // 沪深300ETF → 沪深300
  '510500': '000905', // 中证500ETF → 中证500
  '588000': '000688', // 科创50ETF → 科创50
};

const VALUATION_DIR = path.resolve(process.cwd(), 'data', 'valuation');
const SNAPSHOTS_PATH = path.join(VALUATION_DIR, 'valuation_snapshots.jsonl');
const INDEX_HISTORY_PATH = path.join(VALUATION_DIR, 'index_pe_history.jsonl');
const STOCK_HISTORY_PATH = path.join(VALUATION_DIR, 'stock_valuation_history.jsonl');

export interface ValuationSnapshot {
  date: string; // YYYY-MM-DD
  key: string; // 6位代码（标的或指数）
  pe?: number;
  pb?: number;
  source: string; // tencent | tencent-index | legulegu
}

export interface ValuationPoint {
  date: string;
  pe?: number;
  pb?: number;
}

const PERCENTILE_WINDOW = 750;
// 观测数与时间跨度双门槛：兼容月频回补（~250点=20年）与日频快照自建（120点≈半年）两种粒度
const MIN_OBSERVATIONS = 120;
const MIN_SPAN_DAYS = 365;

let keyDateCache: Set<string> | null = null;

function ensureDir(): void {
  fs.mkdirSync(VALUATION_DIR, { recursive: true });
}

/**
 * 追加估值快照（同 key+date 去重；jsonl 逐行追加）。
 */
export function appendValuationSnapshots(entries: ValuationSnapshot[]): number {
  if (!entries.length) return 0;
  ensureDir();
  if (!keyDateCache) {
    keyDateCache = new Set<string>();
    for (const f of [SNAPSHOTS_PATH, INDEX_HISTORY_PATH, STOCK_HISTORY_PATH]) {
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o?.key && o?.date) keyDateCache.add(`${o.key}|${o.date}`);
        } catch {
          /* 跳过坏行 */
        }
      }
    }
  }
  const lines: string[] = [];
  for (const e of entries) {
    if (!e.key || !e.date) continue;
    const id = `${e.key}|${e.date}`;
    if (keyDateCache.has(id)) continue;
    keyDateCache.add(id);
    lines.push(JSON.stringify(e));
  }
  if (lines.length) {
    fs.appendFileSync(SNAPSHOTS_PATH, lines.join('\n') + '\n', 'utf-8');
  }
  return lines.length;
}

/** 读取全部历史（指数回补 + 每日快照），按 key 分组、按日期排序，同日快照覆盖回补值。 */
export function loadValuationSeries(): Map<string, ValuationPoint[]> {
  ensureDir();
  // 顺序：先回补历史（指数→个股）、后每日快照 → 同日重复时后者覆盖前者
  const files = [INDEX_HISTORY_PATH, STOCK_HISTORY_PATH, SNAPSHOTS_PATH];
  const map = new Map<string, Map<string, ValuationPoint>>();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (!o?.key || !o?.date) continue;
      if (!map.has(o.key)) map.set(o.key, new Map());
      map.get(o.key)!.set(o.date, { date: o.date, pe: o.pe, pb: o.pb });
    }
  }
  const out = new Map<string, ValuationPoint[]>();
  for (const [key, byDate] of map) {
    const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    out.set(key, series);
  }
  return out;
}

/** 尾窗分位：当前值（序列最后一个有效值）在其 trailing 窗口内的百分位。 */
export function percentileFromSeries(
  series: ValuationPoint[],
  field: 'pe' | 'pb',
): number | undefined {
  const dated: Array<[string, number]> = [];
  for (const p of series) {
    const v = p[field];
    if (typeof v === 'number' && v > 0) dated.push([p.date, v]);
  }
  if (dated.length < MIN_OBSERVATIONS) return undefined;
  const spanDays =
    (new Date(dated[dated.length - 1][0]).getTime() - new Date(dated[0][0]).getTime()) / 86400000;
  if (spanDays < MIN_SPAN_DAYS) return undefined;
  const window = dated.slice(-PERCENTILE_WINDOW).map((d) => d[1]);
  const current = window[window.length - 1];
  const below = window.filter((v) => v <= current).length;
  return Math.round((below / window.length) * 100);
}

export interface ValuationEnrichReport {
  enriched: number;
  skipped: number;
}

export interface AsOfValuation {
  pePercentile?: number;
  pbPercentile?: number;
  pe?: number;
  pb?: number;
}

/**
 * 取某日期时点的估值分位（point-in-time，无未来函数）：
 * 仅使用 date 之前的序列截断计算，供回测在每次再平衡时按当时可得数据取值。
 */
export function getAsOfValuation(
  seriesMap: Map<string, ValuationPoint[]>,
  key: string,
  date: string,
): AsOfValuation {
  const series = seriesMap.get(key);
  if (!series || series.length === 0) return {};
  const truncated = series.filter((p) => p.date <= date);
  if (truncated.length === 0) return {};
  const last = truncated[truncated.length - 1];
  return {
    pePercentile: percentileFromSeries(truncated, 'pe'),
    pbPercentile: percentileFromSeries(truncated, 'pb'),
    pe: last.pe,
    pb: last.pb,
  };
}

/**
 * 用快照库历史为标的池富化 pePercentile / pbPercentile。
 * - 债/金/QDII：跳过（无意义估值）
 * - 个股：key=自身代码；分位由自身 PE/PB 历史计算（冷启动期历史不足 → 不富化）
 * - 宽基 ETF：key=映射指数；peTTM 为空时以指数当前 PE 充当（标 valuationSource='index_mapped'），
 *   使 hasValuation 依据真实指数估值激活。
 */
export function enrichUniverseValuation(
  instruments: AShareInstrument[],
): { instruments: AShareInstrument[]; report: ValuationEnrichReport } {
  const seriesMap = loadValuationSeries();
  let enriched = 0;
  let skipped = 0;
  const out = instruments.map((inst) => {
    const cat = (inst as any)?.category;
    if (cat === 'bond_etf' || cat === 'commodity_etf' || cat === 'qdii_etf') {
      // 债/金/QDII 无意义估值：清掉 mock 残留分位，避免 UI 把 50% 当真实值展示
      const cleaned: any = { ...inst };
      delete cleaned.pePercentile;
      delete cleaned.pbPercentile;
      delete cleaned.valuationSource;
      skipped++;
      return cleaned as AShareInstrument;
    }
    const six = String((inst as any)?.code || '').split('.')[0];
    const isETF = (inst as any)?.isETF !== false;
    const key = isETF ? ETF_INDEX_MAP[six] : six;
    const series = key ? seriesMap.get(key) : undefined;
    if (!key || !series || series.length === 0) {
      skipped++;
      return inst;
    }
    const pePct = percentileFromSeries(series, 'pe');
    const pbPct = percentileFromSeries(series, 'pb');
    const last = series[series.length - 1];
    const next: any = { ...inst };
    // 防假数据泄漏：分位算不出来时显式清空 —— mock 模板残留的假分位绝不能流入估值引擎
    if (pePct !== undefined) {
      next.pePercentile = pePct;
    } else {
      delete next.pePercentile;
    }
    if (pbPct !== undefined) {
      next.pbPercentile = pbPct;
    } else {
      delete next.pbPercentile;
    }
    if (isETF) {
      // ETF 自身无 PE/PB：仅当映射指数分位可计算时，才以指数当前值充当；否则清 0（hasValuation 保持 false）
      next.peTTM = pePct !== undefined && typeof last.pe === 'number' && last.pe > 0 ? Number(last.pe.toFixed(2)) : 0;
      next.pb = pbPct !== undefined && typeof last.pb === 'number' && last.pb > 0 ? Number(last.pb.toFixed(2)) : 0;
      if (pePct !== undefined || pbPct !== undefined) {
        next.valuationSource = 'index_mapped';
        enriched++;
      } else {
        delete next.valuationSource;
        skipped++;
      }
      return next as AShareInstrument;
    }
    // 个股：peTTM/pb 是同步来的真实值，保留；分位仅在历史足够时给出
    if (pePct !== undefined || pbPct !== undefined) {
      next.valuationSource = 'direct';
      enriched++;
    } else {
      delete next.valuationSource;
      skipped++;
    }
    return next as AShareInstrument;
  });
  return { instruments: out, report: { enriched, skipped } };
}
