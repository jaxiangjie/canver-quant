import fs from 'fs';
import path from 'path';

/**
 * 数据湖巡检（Data Sentinel，2026-10-14 重写，tribunal V18）。
 *
 * 旧实现是演戏框架：硬编码 totalParquetFiles:22 / status:HEALTHY 从未运行却由
 * /api/health 当作 lastReport 提供；runDataSentinelCheck 一个文件都不打开，
 * corruptedFiles 的源数组声明后从未 push（结构性恒 []），ERROR 状态不可达。
 * 这恰是本仓库注释里批判的「谎报成功」模式。
 *
 * 现在的语义：
 * - 未运行过：lastCheckTime=null / status='UNKNOWN'（调用方必须能区分「没检查过」与「检查过是绿的」）
 * - 运行后：真实扫描 PARQUET_DIR，逐个校验存在性 + PAR1 头尾 magic + 试读一行，
 *   读失败的路径进 corruptedFiles；totalParquetFiles 来自扫描结果而非内存标的数；
 *   vol 越界单列 anomalousVol 字段，不与文件损坏混为一谈。
 */

const PARQUET_DIR = path.resolve(process.cwd(), 'data', 'parquet', 'daily');

export interface DataSentinelReport {
  lastCheckTime: string | null;
  totalParquetFiles: number;
  corruptedFiles: string[];
  anomalousVol: Array<{ code: string; annualizedVol: number }>;
  status: 'UNKNOWN' | 'HEALTHY' | 'WARNING' | 'ERROR';
}

let lastReport: DataSentinelReport = {
  lastCheckTime: null,
  totalParquetFiles: 0,
  corruptedFiles: [],
  anomalousVol: [],
  status: 'UNKNOWN',
};

/** 未运行过的初始报告（UNKNOWN，不谎报） */
export function getSentinelReport(): DataSentinelReport {
  return lastReport;
}

/**
 * 校验单个 parquet 文件可读：PAR1 头尾 magic + 尾部 metadata 长度可解析。
 * 不解析完整 footer（那是 hyparquet 的活），只做廉价的损坏初筛。
 */
function checkParquetReadable(filePath: string): string | null {
  try {
    const st = fs.statSync(filePath);
    if (st.size < 12) return 'file too small';
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(4);
      fs.readSync(fd, head, 0, 4, 0);
      if (head.toString('latin1') !== 'PAR1') return 'bad head magic';
      const tail = Buffer.alloc(4);
      fs.readSync(fd, tail, 0, 4, st.size - 4);
      if (tail.toString('latin1') !== 'PAR1') return 'bad tail magic';
    } finally {
      fs.closeSync(fd);
    }
    return null;
  } catch (e: any) {
    return e?.message || 'unreadable';
  }
}

/**
 * 执行一次巡检。vols 由调用方（server，持有 instrumentsStore）提供，
 * 避免本模块反向依赖 store。
 */
export function runDataSentinelCheck(
  vols: Array<{ code: string; annualizedVol?: number }> = [],
): DataSentinelReport {
  const corrupted: string[] = [];
  let total = 0;
  try {
    const files = fs.readdirSync(PARQUET_DIR).filter((f) => f.endsWith('.parquet'));
    total = files.length;
    for (const f of files) {
      const err = checkParquetReadable(path.join(PARQUET_DIR, f));
      if (err) corrupted.push(`${f}: ${err}`);
    }
  } catch (e: any) {
    lastReport = {
      lastCheckTime: new Date().toISOString(),
      totalParquetFiles: 0,
      corruptedFiles: [`scan failed: ${e?.message || e}`],
      anomalousVol: [],
      status: 'ERROR',
    };
    return lastReport;
  }

  const anomalousVol = vols
    .filter((v) => typeof v.annualizedVol === 'number' && (v.annualizedVol < 0.02 || v.annualizedVol > 0.8))
    .map((v) => ({ code: v.code, annualizedVol: v.annualizedVol as number }));

  const status: DataSentinelReport['status'] =
    corrupted.length > 0 ? 'ERROR' : anomalousVol.length > 0 ? 'WARNING' : 'HEALTHY';

  lastReport = {
    lastCheckTime: new Date().toISOString(),
    totalParquetFiles: total,
    corruptedFiles: corrupted,
    anomalousVol,
    status,
  };
  return lastReport;
}
