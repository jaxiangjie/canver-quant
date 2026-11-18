/**
 * parquet 探针：读回校验（写入必自校验）。
 * 只取「行数 + 末根交易日」两个标量，用于确认落盘结果与预期一致；
 * 另提供整读 readParquetBars 供增量同步以盘上数据为唯一事实源。
 */
import { existsSync } from 'node:fs';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

export interface ParquetProbe {
  barCount: number;
  lastDate: string;
  firstDate: string;
}

/** parquet 行 → bar（schema 对照 510300_hfq.parquet：date/open/high/low/close/volume/amount） */
export interface ParquetBarRow {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
}

/** date 列（UTC 午夜 epoch-ms）→ YYYY-MM-DD（与写入脚本一致） */
function toDay(v: any): string {
  if (v instanceof Date) {
    return new Date(v.getTime() - v.getTimezoneOffset() * 0).toISOString().slice(0, 10);
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** 读 parquet 的 bar 数与首末交易日（UTC 日期口径，与写入脚本一致）。失败返回 null。 */
export async function readParquetBarCountAndLastDate(file: string): Promise<ParquetProbe | null> {
  if (!existsSync(file)) return null;
  try {
    const af = await asyncBufferFromFile(file);
    const rows = (await parquetReadObjects({ file: af })) as any[];
    if (!rows?.length) return null;
    const sorted = rows
      .map((r) => toDay(r.date))
      .filter(Boolean)
      .sort();
    return {
      barCount: rows.length,
      firstDate: sorted[0],
      lastDate: sorted[sorted.length - 1],
    };
  } catch {
    return null;
  }
}

/**
 * 整读 parquet bars（按交易日升序）。失败 / 无行返回 null。
 * 2026-11-18 tribunal：增量同步落盘前必须以盘上数据为唯一事实源 —— 内存快照可能被
 * scanAndRescaleBreaks 就地改写过（仅内存），或落后于外部修复脚本写盘后的真实状态，
 * 用内存历史整文件覆写会写穿/回滚盘上数据。
 */
export async function readParquetBars(file: string): Promise<ParquetBarRow[] | null> {
  if (!existsSync(file)) return null;
  try {
    const af = await asyncBufferFromFile(file);
    const rows = (await parquetReadObjects({ file: af })) as any[];
    if (!rows?.length) return null;
    const bars: ParquetBarRow[] = rows
      .map((r) => ({
        tradeDate: toDay(r.date),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
        amount: Number(r.amount),
      }))
      .filter((b) => b.tradeDate && b.close > 0);
    bars.sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
    return bars;
  } catch {
    return null;
  }
}
