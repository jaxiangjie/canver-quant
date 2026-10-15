/**
 * parquet 探针：读回校验（写入必自校验）。
 * 只取「行数 + 末根交易日」两个标量，用于确认落盘结果与预期一致。
 */
import { existsSync } from 'node:fs';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

export interface ParquetProbe {
  barCount: number;
  lastDate: string;
  firstDate: string;
}

/** 读 parquet 的 bar 数与首末交易日（UTC 日期口径，与写入脚本一致）。失败返回 null。 */
export async function readParquetBarCountAndLastDate(file: string): Promise<ParquetProbe | null> {
  if (!existsSync(file)) return null;
  try {
    const af = await asyncBufferFromFile(file);
    const rows = (await parquetReadObjects({ file: af })) as any[];
    if (!rows?.length) return null;
    const toDay = (v: any): string => {
      if (v instanceof Date) {
        return new Date(v.getTime() - v.getTimezoneOffset() * 0).toISOString().slice(0, 10);
      }
      const t = Date.parse(String(v));
      return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : String(v).slice(0, 10);
    };
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
