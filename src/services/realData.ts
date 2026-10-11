import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AShareInstrument, AShareBar } from '../types/ashare';
import { INITIAL_INSTRUMENTS } from './mockData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 真实数据适配器：对接上一级 llmquant 的本地 parquet 数据契约。
 *
 * 默认从项目内嵌数据读取（data/parquet/daily，已随仓库提交，clone 即自包含）：
 *   {项目根}/data/parquet/daily/{6位代码}_hfq.parquet
 * 与 llmquant 的数据契约一致（后复权日线，字段: date/open/high/low/close/volume/amount/code）。
 * 可用环境变量 REAL_DATA_DIR 覆盖为外部大湖（如 E:\quant-platform\data\parquet\daily）。
 * 这里复用同一份数据契约，把后复权日线转成 canver-quant 的 AShareInstrument。
 *
 * 设计：以 src/services/mockData.ts 的 INITIAL_INSTRUMENTS 作为"元数据模板"
 * （保留 category / isETF / isT0 / stampDutyExempt / riskBudgetWeight /
 * currentShares / 估值默认值），用 parquet 真实日线填充
 * currentPrice / preClose / changePct / dailyATR / annualizedVol / bars。
 * 前端 apiClient 已能 hydrate 真实 bars，因此前端零改动即可呈现真实数据。
 */

// 默认从项目内 data/parquet/daily 加载（数据自包含）；可用 REAL_DATA_DIR 覆盖为外部大湖
export const PARQUET_DIR = process.env.REAL_DATA_DIR || path.resolve(__dirname, '..', '..', 'data', 'parquet', 'daily');

// hyparquet 为纯 JS parquet 读取器（自带 TS 类型），在 Node 端直接读 llmquant 的本地 parquet
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

function stripSuffix(code: string): string {
  return code.replace(/\.(SH|SZ)$/i, '');
}

function mean(a: number[]): number {
  if (!a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function stdSample(a: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

function normDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'number') {
    const ms = d < 1e11 ? d * 1000 : d;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

interface RawRow {
  date: unknown;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

async function readRows(code: string): Promise<RawRow[]> {
  const file = `${PARQUET_DIR}/${code}_hfq.parquet`;
  if (!existsSync(file)) return [];
  const af = await asyncBufferFromFile(file);
  const rows = await parquetReadObjects({ file: af });
  return (rows || []) as RawRow[];
}

export async function loadRealUniverse(): Promise<AShareInstrument[]> {
  const out: AShareInstrument[] = [];
  let fallbackCount = 0; // 无 parquet、回退合成模板的标的数（用于暴露真实数据覆盖率，避免谎报成功）
  for (const tpl of INITIAL_INSTRUMENTS) {
    const code = stripSuffix(tpl.code);
    let rows: RawRow[] = [];
    try {
      rows = await readRows(code);
    } catch (e) {
      console.warn(`[real-data] read ${code} failed:`, (e as Error).message);
    }
    if (!rows.length) {
      // 该标的无 parquet 时回退 mock 模板，保证工作台不崩；
      // 必须打上 fallback 标记，否则会被误当作真实行情参与回测与相关性计算。
      out.push({ ...tpl, dataSource: 'fallback' });
      fallbackCount++;
      continue;
    }
    // parquetReadObjects 返回的 date 是 Date 对象（非字符串），必须按时间戳排序，
    // 否则 String(Date) 会退化为 "Thu Jan 03 2013..." 导致按星期几乱序
    rows.sort(
      (a, b) =>
        new Date(a.date as string | number | Date).getTime() -
        new Date(b.date as string | number | Date).getTime(),
    );
    const n = rows.length;
    const closes = rows.map((r) => Number(r.close));

    // 年化波动率 = 日收益率样本标准差 × √250
    // 仅取最近 120 个交易日收益（与回测 buildSnapshot 的 120 日窗口口径一致）；
    // 若用全样本（可能十年），定仓会严重偏离近期波动状态。
    const retStart = Math.max(1, n - 121);
    const rets: number[] = [];
    for (let i = retStart; i < n; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const annualizedVol =
      Number((stdSample(rets) * Math.sqrt(250)).toFixed(4)) || tpl.annualizedVol;

    // ATR(20)：真实波幅 = max(H-L, |H-昨收|, |L-昨收|)，20 日均值
    const tr: number[] = [0];
    for (let i = 1; i < n; i++) {
      const pc = closes[i - 1];
      tr.push(
        Math.max(
          Number(rows[i].high) - Number(rows[i].low),
          Math.abs(Number(rows[i].high) - pc),
          Math.abs(Number(rows[i].low) - pc),
        ),
      );
    }
    const atr20: number[] = [];
    for (let i = 0; i < n; i++) {
      atr20.push(i >= 20 ? mean(tr.slice(i - 19, i + 1)) : 0);
    }

    const last = n - 1;
    const currentPrice = Number(rows[last].close);
    const preClose = last > 0 ? Number(rows[last - 1].close) : currentPrice;
    const changePct = preClose
      ? Number((((currentPrice - preClose) / preClose) * 100).toFixed(2))
      : 0;
    const dailyATR = Number(
      (atr20[last] || (currentPrice * annualizedVol) / 15.8).toFixed(4),
    );

    // 前缀和加速：O(1) 滚动均线，避免 3000根×3均线 产生千万级 slice().map()
    const prefixCloseSum: number[] = [0];
    for (let i = 0; i < n; i++) {
      prefixCloseSum.push(prefixCloseSum[i] + closes[i]);
    }
    const rollingMA = (idx: number, window: number): number | undefined => {
      if (idx < window - 1) return undefined;
      const sum = prefixCloseSum[idx + 1] - prefixCloseSum[idx + 1 - window];
      return Number((sum / window).toFixed(3));
    };

    const bars: AShareBar[] = rows.map((r, i) => {
      const close = Number(r.close);
      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const vol = Number(r.volume);
      const pc = i > 0 ? Number(rows[i - 1].close) : close;
      const amt = Number(r.amount) > 0 ? Number(r.amount) : vol * close; // 真实成交额 (元)
      return {
        tradeDate: normDate(r.date),
        open,
        high,
        low,
        close,
        preClose: pc,
        volume: vol,
        amount: amt,
        // turnover 仅作展示 (万元)，由真实成交额换算
        // （旧实现用合成的 成交量×价/100 并四舍五入，早期小成交额样本会被取整为 0）
        turnover: Number((amt / 10000).toFixed(0)),
        changePct: Number((((close - pc) / pc) * 100).toFixed(2)),
        ma20: rollingMA(i, 20),
        ma60: rollingMA(i, 60),
        ma250: rollingMA(i, 250),
        atr20: i >= 20 ? Number(atr20[i].toFixed(3)) : undefined,
      };
    });

    out.push({
      ...tpl,
      currentPrice,
      preClose,
      changePct,
      dailyATR,
      annualizedVol,
      bars,
      dataSource: 'parquet',
    });
  }
  if (fallbackCount > 0) {
    console.warn(
      `[real-data] ${fallbackCount}/${out.length} 标的无 parquet 数据，已回退合成模板（非真实行情）`,
    );
  }
  return out;
}
