import { AShareInstrument, AShareBar } from '../types/ashare';

/**
 * 实时/增量 A 股与 ETF 行情同步模块
 * 具备将现有离线数据/滞后数据无缝增量补齐至全市场最新交易日（如 2026-10-09）的能力。
 */

export interface SyncDetail {
  id: string;
  code: string;
  name: string;
  prevPrice: number;
  newPrice: number;
  prevDate: string;
  newDate: string;
  addedBars: number;
  isUpdated: boolean;
  dailyATR: number;
  annualizedVol: number;
  peTTM?: number;
  pb?: number;
  error?: string;
}

export interface SyncReport {
  success: boolean;
  timestamp: string;
  latestTradingDate: string;
  totalInstruments: number;
  updatedCount: number;
  alreadyLatestCount: number;
  failedCount: number;
  details: SyncDetail[];
}

/**
 * 将代码标准化为腾讯行情所用的 secid (例如 601857.SH -> sh601857, 000333.SZ -> sz000333)
 */
export function codeToTencentSymbol(code: string): string {
  const clean = code.trim().toUpperCase();
  if (clean.startsWith('SH') || clean.startsWith('SZ')) {
    return clean.toLowerCase();
  }
  const parts = clean.split('.');
  const num = parts[0];
  const market = parts[1];
  if (market) {
    return `${market.toLowerCase()}${num}`;
  }
  if (num.startsWith('6') || num.startsWith('5')) {
    return `sh${num}`;
  }
  return `sz${num}`;
}

export interface RawTencentQuote {
  symbol: string;
  name: string;
  code: string;
  currentPrice: number;
  preClose: number;
  open: number;
  high: number;
  low: number;
  tradeDate: string; // YYYY-MM-DD
  volume: number;    // 手
  amountYuan: number; // 元
  turnoverWan: number;// 万元
  peTTM?: number;
  pb?: number;
}

/**
 * 批量拉取实时快照行情
 */
export async function fetchBatchTencentQuotes(symbols: string[]): Promise<Map<string, RawTencentQuote>> {
  const result = new Map<string, RawTencentQuote>();
  if (!symbols.length) return result;

  try {
    const query = symbols.join(',');
    const res = await fetch(`https://qt.gtimg.cn/q=${query}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.includes('="')) continue;
      const m = line.match(/v_([a-zA-Z0-9]+)="([^"]+)"/);
      if (!m) continue;
      const secid = m[1].toLowerCase();
      const parts = m[2].split('~');
      if (parts.length < 35) continue;

      const name = parts[1];
      const code = parts[2];
      const currentPrice = parseFloat(parts[3]) || 0;
      const preClose = parseFloat(parts[4]) || 0;
      const open = parseFloat(parts[5]) || 0;
      const volume = parseFloat(parts[6]) || 0; // 手
      const timeStr = parts[30] || ''; // '20261009150000'
      const tradeDate = timeStr.length >= 8
        ? `${timeStr.slice(0, 4)}-${timeStr.slice(4, 6)}-${timeStr.slice(6, 8)}`
        : new Date().toISOString().slice(0, 10);
      const high = parseFloat(parts[33]) || currentPrice;
      const low = parseFloat(parts[34]) || currentPrice;
      const turnoverWan = parseFloat(parts[37]) || 0;
      const amtPart = parts[35]?.split('/')?.[2];
      const amountYuan = amtPart ? parseFloat(amtPart) : turnoverWan * 10000;
      const peTTM = parseFloat(parts[39]) > 0 ? parseFloat(parts[39]) : undefined;
      const pb = parseFloat(parts[46]) > 0 ? parseFloat(parts[46]) : undefined;

      result.set(secid, {
        symbol: secid,
        name,
        code,
        currentPrice,
        preClose,
        open,
        high,
        low,
        tradeDate,
        volume,
        amountYuan,
        turnoverWan,
        peTTM,
        pb,
      });
    }
  } catch (err) {
    console.warn('[liveMarketSync] fetchBatchTencentQuotes failed:', err);
  }

  return result;
}

export interface RawDailyBar {
  tradeDate: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/**
 * 拉取标的近期真实前复权日线 (默认250日)
 */
export async function fetchTencentDailyBars(symbol: string, count: number = 250): Promise<RawDailyBar[]> {
  try {
    const res = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${count},qfq`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const json = await res.json();
    const sub = json?.data?.[symbol];
    if (!sub) return [];
    const rawList = sub.qfqday || sub.day;
    if (!Array.isArray(rawList)) return [];

    return rawList.map((item: any) => ({
      tradeDate: String(item[0]),
      open: parseFloat(item[1]),
      close: parseFloat(item[2]),
      high: parseFloat(item[3]),
      low: parseFloat(item[4]),
      volume: parseFloat(item[5]),
    })).filter((b: RawDailyBar) => !isNaN(b.close) && b.tradeDate);
  } catch (err) {
    console.warn(`[liveMarketSync] fetchTencentDailyBars failed for ${symbol}:`, err);
    return [];
  }
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

/**
 * 对日 K 线重新完整计算 O(1) 滚动均线、ATR 与波动率
 */
export function recomputeIndicators(bars: AShareBar[]): {
  bars: AShareBar[];
  dailyATR: number;
  annualizedVol: number;
} {
  const n = bars.length;
  if (n === 0) return { bars, dailyATR: 0.05, annualizedVol: 0.18 };

  const closes = bars.map(b => b.close);

  // 1. 年化波动率: 最近 120 交易日样本收益率标准差 × √250
  const retStart = Math.max(1, n - 121);
  const rets: number[] = [];
  for (let i = retStart; i < n; i++) {
    if (closes[i - 1] > 0) {
      rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  const annualizedVol = Number((stdSample(rets) * Math.sqrt(250)).toFixed(4)) || 0.18;

  // 2. ATR(20): True Range = max(H-L, |H-昨收|, |L-昨收|)
  const tr: number[] = [0];
  for (let i = 1; i < n; i++) {
    const pc = closes[i - 1];
    tr.push(
      Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - pc),
        Math.abs(bars[i].low - pc),
      ),
    );
  }

  const atr20: number[] = [];
  for (let i = 0; i < n; i++) {
    atr20.push(i >= 20 ? mean(tr.slice(i - 19, i + 1)) : 0);
  }

  // 3. 滚动均线 (前缀和 O(1))
  const prefixCloseSum: number[] = [0];
  for (let i = 0; i < n; i++) {
    prefixCloseSum.push(prefixCloseSum[i] + closes[i]);
  }
  const rollingMA = (idx: number, window: number): number | undefined => {
    if (idx < window - 1) return undefined;
    const sum = prefixCloseSum[idx + 1] - prefixCloseSum[idx + 1 - window];
    return Number((sum / window).toFixed(3));
  };

  const updatedBars: AShareBar[] = bars.map((b, i) => {
    const pc = i > 0 ? bars[i - 1].close : b.open;
    const chg = pc > 0 ? Number((((b.close - pc) / pc) * 100).toFixed(2)) : 0;
    return {
      ...b,
      preClose: pc,
      changePct: chg,
      ma20: rollingMA(i, 20),
      ma60: rollingMA(i, 60),
      ma250: rollingMA(i, 250),
      atr20: i >= 20 ? Number(atr20[i].toFixed(3)) : undefined,
    };
  });

  const last = n - 1;
  const currentPrice = closes[last];
  const dailyATR = Number((atr20[last] || (currentPrice * annualizedVol) / 15.8).toFixed(4));

  return { bars: updatedBars, dailyATR, annualizedVol };
}

/**
 * 同步单只标的：获取最新真实日线并与本地合并
 */
export async function syncSingleInstrument(
  inst: AShareInstrument,
  quoteSnapshot?: RawTencentQuote,
): Promise<{ instrument: AShareInstrument; detail: SyncDetail }> {
  const symbol = codeToTencentSymbol(inst.code);
  const rawBars = await fetchTencentDailyBars(symbol, 250);

  const prevPrice = inst.currentPrice;
  const prevBars = inst.bars || [];
  const prevDate = prevBars.length > 0 ? prevBars[prevBars.length - 1].tradeDate : '';

  if (!rawBars.length) {
    // 接口临时失败，保留原值
    return {
      instrument: inst,
      detail: {
        id: inst.id,
        code: inst.code,
        name: inst.name,
        prevPrice,
        newPrice: prevPrice,
        prevDate,
        newDate: prevDate,
        addedBars: 0,
        isUpdated: false,
        dailyATR: inst.dailyATR,
        annualizedVol: inst.annualizedVol,
        peTTM: inst.peTTM,
        pb: inst.pb,
        error: '拉取行情日线失败',
      },
    };
  }

  // 转换为 AShareBar 结构
  const fetchedBarsMap = new Map<string, RawDailyBar>();
  for (const b of rawBars) {
    fetchedBarsMap.set(b.tradeDate, b);
  }

  const isSynthetic = !!inst.syntheticBars || inst.dataSource === 'fallback';
  let mergedBars: AShareBar[] = [];

  if (isSynthetic || prevBars.length === 0) {
    // 原数据为合成数据：直接以真实 250 日行情完全替代
    mergedBars = rawBars.map((b, idx) => {
      const pc = idx > 0 ? rawBars[idx - 1].close : b.open;
      const amt = b.volume * b.close;
      return {
        tradeDate: b.tradeDate,
        open: b.open,
        close: b.close,
        high: b.high,
        low: b.low,
        preClose: pc,
        volume: b.volume,
        amount: amt,
        turnover: Number((amt / 10000).toFixed(0)),
        changePct: pc > 0 ? Number((((b.close - pc) / pc) * 100).toFixed(2)) : 0,
      };
    });
  } else {
    // 原数据为真实 parquet 历史：保留历史底座，增量追加缺失的最新日期，并刷新重叠日期
    const existingDateSet = new Set(prevBars.map(b => b.tradeDate));
    mergedBars = [...prevBars];

    // 更新已有但最新日的 bar
    for (let i = 0; i < mergedBars.length; i++) {
      const d = mergedBars[i].tradeDate;
      if (fetchedBarsMap.has(d)) {
        const live = fetchedBarsMap.get(d)!;
        mergedBars[i] = {
          ...mergedBars[i],
          open: live.open,
          close: live.close,
          high: live.high,
          low: live.low,
          volume: live.volume,
          amount: live.volume * live.close,
          turnover: Number(((live.volume * live.close) / 10000).toFixed(0)),
        };
      }
    }

    // 追加大于已有最大日期的 bar
    const sortedRaw = [...rawBars].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
    for (const b of sortedRaw) {
      if (!existingDateSet.has(b.tradeDate) && b.tradeDate > prevDate) {
        const lastBar = mergedBars[mergedBars.length - 1];
        const pc = lastBar ? lastBar.close : b.open;
        const amt = b.volume * b.close;
        mergedBars.push({
          tradeDate: b.tradeDate,
          open: b.open,
          close: b.close,
          high: b.high,
          low: b.low,
          preClose: pc,
          volume: b.volume,
          amount: amt,
          turnover: Number((amt / 10000).toFixed(0)),
          changePct: pc > 0 ? Number((((b.close - pc) / pc) * 100).toFixed(2)) : 0,
        });
      }
    }
  }

  // 排序
  mergedBars.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

  // 重算全套技术指标与统计量
  const { bars: finalBars, dailyATR, annualizedVol } = recomputeIndicators(mergedBars);

  const lastBar = finalBars[finalBars.length - 1];
  const newDate = lastBar ? lastBar.tradeDate : prevDate;
  const newPrice = lastBar ? lastBar.close : prevPrice;
  const preClose = finalBars.length > 1 ? finalBars[finalBars.length - 2].close : newPrice;
  const changePct = preClose > 0 ? Number((((newPrice - preClose) / preClose) * 100).toFixed(2)) : 0;
  const addedBars = Math.max(0, finalBars.length - prevBars.length);

  // 估值刷新
  const peTTM = quoteSnapshot?.peTTM ?? inst.peTTM;
  const pb = quoteSnapshot?.pb ?? inst.pb;

  const updatedInstrument: AShareInstrument = {
    ...inst,
    currentPrice: newPrice,
    preClose,
    changePct,
    dailyATR,
    annualizedVol,
    peTTM,
    pb,
    bars: finalBars,
    syntheticBars: false,
    dataSource: 'realtime_synced',
  };

  return {
    instrument: updatedInstrument,
    detail: {
      id: inst.id,
      code: inst.code,
      name: inst.name,
      prevPrice,
      newPrice,
      prevDate,
      newDate,
      addedBars,
      isUpdated: newDate !== prevDate || newPrice !== prevPrice || isSynthetic,
      dailyATR,
      annualizedVol,
      peTTM,
      pb,
    },
  };
}

/**
 * 并发拉取并同步全市场标的
 */
export async function syncAllInstruments(instruments: AShareInstrument[]): Promise<{
  updatedInstruments: AShareInstrument[];
  report: SyncReport;
}> {
  if (!instruments.length) {
    return {
      updatedInstruments: [],
      report: {
        success: true,
        timestamp: new Date().toISOString(),
        latestTradingDate: '',
        totalInstruments: 0,
        updatedCount: 0,
        alreadyLatestCount: 0,
        failedCount: 0,
        details: [],
      },
    };
  }

  // 1. 批量获取实时快照
  const symbols = instruments.map(i => codeToTencentSymbol(i.code));
  const quotesMap = await fetchBatchTencentQuotes(symbols);

  // 2. 并发同步日线
  const details: SyncDetail[] = [];
  const updatedInstruments: AShareInstrument[] = [];

  // 控制并发度（每批 6 只）
  const batchSize = 6;
  for (let i = 0; i < instruments.length; i += batchSize) {
    const batch = instruments.slice(i, i + batchSize);
    const promises = batch.map(inst => {
      const sym = codeToTencentSymbol(inst.code);
      const quote = quotesMap.get(sym);
      return syncSingleInstrument(inst, quote);
    });
    const results = await Promise.all(promises);
    for (const r of results) {
      updatedInstruments.push(r.instrument);
      details.push(r.detail);
    }
  }

  // 提取最新交易日
  const allDates = details.map(d => d.newDate).filter(Boolean);
  allDates.sort();
  const latestTradingDate = allDates.length ? allDates[allDates.length - 1] : '';

  const updatedCount = details.filter(d => d.isUpdated).length;
  const alreadyLatestCount = details.filter(d => !d.isUpdated && !d.error).length;
  const failedCount = details.filter(d => !!d.error).length;

  const report: SyncReport = {
    success: failedCount === 0 || updatedCount > 0,
    timestamp: new Date().toISOString(),
    latestTradingDate,
    totalInstruments: instruments.length,
    updatedCount,
    alreadyLatestCount,
    failedCount,
    details,
  };

  return { updatedInstruments, report };
}
