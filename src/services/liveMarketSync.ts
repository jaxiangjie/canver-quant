import { AShareInstrument, AShareBar } from '../types/ashare';
import { appendValuationSnapshots, enrichUniverseValuation, ETF_INDEX_MAP, ValuationSnapshot } from './valuationStore';

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
  valuationSource?: 'direct' | 'index_mapped';
  warning?: string;
  snapshotKey?: string;
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
  valuationSnapshotsAppended?: number;
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

export interface EastmoneyQuote {
  code: string;
  price: number;
  peTTM: number;
  pb: number;
}

/**
 * 东方财富批量快照（第二通道，用于互验；fltt=2 浮点直出）。
 * 仅个股 PE/PB 字段有效；东财对指数 PE 返回假值（见数据源验证报告），不用于指数。
 */
export async function fetchEastmoneyQuotes(codes: string[]): Promise<Map<string, EastmoneyQuote>> {
  const result = new Map<string, EastmoneyQuote>();
  if (!codes.length) return result;
  try {
    const secids = codes.map((c) => (/^[569]/.test(c) ? `1.${c}` : `0.${c}`)).join(',');
    const url =
      'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2' +
      `&secids=${secids}&fields=f2,f12,f14,f18,f9,f23,f115`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    const json = await res.json();
    for (const d of json?.data?.diff || []) {
      result.set(String(d.f12), {
        code: String(d.f12),
        price: Number(d.f2) || 0,
        peTTM: Number(d.f115) || 0,
        pb: Number(d.f23) || 0,
      });
    }
  } catch (err) {
    console.warn('[liveMarketSync] fetchEastmoneyQuotes failed:', err);
  }
  return result;
}







/**
 * 同步单只标的：获取最新真实日线并与本地合并
 */
export async function syncSingleInstrument(
  inst: AShareInstrument,
  quoteSnapshot?: RawTencentQuote,
  ctx?: { emQuote?: EastmoneyQuote; indexQuote?: RawTencentQuote },
): Promise<{ instrument: AShareInstrument; detail: SyncDetail }> {
  // 架构决定（2026-10-12）：bars 以 parquet 后复权(hfq) 为权威，实时同步不碰 K 线。
  // 腾讯日线为前复权(qfq) 体系，混入 hfq 底座会产生复权断裂假跳变——601857 后复权 21.94
  // 被前复权 11.8 覆盖即产生 -46% 假收益，实测可把年化波动率撑大 2.4 倍、目标股数缩到四成。
  // 故日线段整体移除；每日行情增量走 parquet 重建（AKShare hfq），不走实时覆盖。
  const prevPrice = inst.currentPrice;
  const prevBars = inst.bars || [];
  const prevDate = prevBars.length > 0 ? prevBars[prevBars.length - 1].tradeDate : '';
  // 行情日期以快照为准（腾讯 parts[30]）；快照缺失时回退本地最后 bar 日期
  const quoteDate = quoteSnapshot?.tradeDate || '';

  // 估值刷新（双通道互验 + 宽基ETF指数映射，规则见 docs/DATA_SOURCE_VALIDATION_2026-10-11.md）
  let peTTM = quoteSnapshot?.peTTM ?? inst.peTTM ?? 0;
  let pb = quoteSnapshot?.pb ?? inst.pb ?? 0;
  let valuationSource: 'direct' | 'index_mapped' | undefined;
  let warning = '';

  const sixCode = inst.code.split('.')[0];
  const mappedIndex = ETF_INDEX_MAP[sixCode];
  const isEtfInst = inst.isETF !== false;
  const snapshotKey = mappedIndex ?? (isEtfInst ? undefined : sixCode);

  if (ctx?.emQuote) {
    const txPrice = quoteSnapshot?.currentPrice || 0;
    const emPrice = ctx.emQuote.price || 0;
    const priceDiff = txPrice > 0 && emPrice > 0 ? Math.abs(txPrice - emPrice) / txPrice : 0;
    if (priceDiff > 0.001) {
      warning += `TX/EM价差${(priceDiff * 100).toFixed(2)}%>0.1%，本轮估值拒写; `;
      peTTM = inst.peTTM ?? 0;
      pb = inst.pb ?? 0;
    } else {
      if (peTTM > 0 && ctx.emQuote.peTTM > 0) {
        const d = Math.abs(peTTM - ctx.emQuote.peTTM) / ctx.emQuote.peTTM;
        if (d > 0.05) {
          warning += `PE互验差${(d * 100).toFixed(1)}%>5%，拒写; `;
          peTTM = inst.peTTM ?? 0;
        } else if (d > 0.01) {
          warning += `PE互验差${(d * 100).toFixed(1)}%; `;
        }
      }
      if (pb > 0 && ctx.emQuote.pb > 0) {
        const d = Math.abs(pb - ctx.emQuote.pb) / ctx.emQuote.pb;
        if (d > 0.05) {
          warning += `PB互验差${(d * 100).toFixed(1)}%>5%，拒写; `;
          pb = inst.pb ?? 0;
        } else if (d > 0.01) {
          warning += `PB互验差${(d * 100).toFixed(1)}%; `;
        }
      }
      if (peTTM > 0 || pb > 0) valuationSource = 'direct';
    }
  } else if (peTTM > 0 || pb > 0) {
    // 东财通道不可用：单源直写（快照 source=tencent）
    valuationSource = 'direct';
  }

  // 宽基 ETF：映射指数 PE（东财指数 PE 为假值，仅腾讯单通道）
  if (ctx?.indexQuote && mappedIndex && ctx.indexQuote.peTTM && ctx.indexQuote.peTTM > 0) {
    peTTM = ctx.indexQuote.peTTM;
    valuationSource = 'index_mapped';
  }

  // 复权口径一致性：parquet 底座为后复权(hfq)，腾讯日线为前复权(qfq)体系。
  // 用 qfq 收盘覆盖 currentPrice/bars 会造成复权断裂（如 601857 后复权 21.94 → 前复权 11.8 的假跳变），
  // 故实时同步只更新估值字段（pe/pb 为点数据，无复权问题）；
  // 行情 K 线与现价以 parquet 为权威，每日更新走 parquet 重建（AKShare hfq），不走实时覆盖。
  // 价格口径分离（2026-10-12 修正）：currentPrice/preClose/changePct 用腾讯实时快照的「市价」
  // （下单/市值口径，与炒股软件一致）；bars 保持 parquet 后复权底座（收益率/波动率口径）不动。
  // 此前两个极端都错过：用 qfq 日线收盘覆盖 price → 复权断裂（601857 21.94→11.8 假跳变）；
  // 完全不覆盖 → price 停在 hfq 历史价（福耀显示 5248 而市价约 50，目标股数错几十倍）。
  // 市价兜底链：腾讯快照实时价 → parquet VWAP（单源自洽，见 realData 计算）→ hfq close（最后手段）。
  // 旧代码快照失败时 livePrice=0，currentPrice 停留在 hfq（目标股数错复权因子倍）。
  const vwapFallback =
    typeof (inst as any).vwapPrice === 'number' && (inst as any).vwapPrice > 0
      ? (inst as any).vwapPrice
      : 0;
  const livePrice =
    quoteSnapshot && quoteSnapshot.currentPrice > 0
      ? quoteSnapshot.currentPrice
      : vwapFallback;
  const livePreClose = quoteSnapshot && quoteSnapshot.preClose > 0 ? quoteSnapshot.preClose : 0;
  // dailyATR 的市价化唯一 owner（tribunal G1c3/G3i2）：inst.dailyATR 一律是「由 hfq bars
  // 算出的绝对值」（realData 加载时刻意不做 factor 换算，避免 registry 标的被缩放两次成 f²）。
  // 此处按「市价 / hfq 最后收盘」比值换算一次，registry 与底座标的一致对待。
  // atrScale≈1 时（市价与 hfq 末收一致的 ETF）天然无操作。
  const hfqLastClose = prevBars.length > 0 ? prevBars[prevBars.length - 1].close : 0;
  const atrScale = livePrice > 0 && hfqLastClose > 0 ? livePrice / hfqLastClose : 1;
  const displayATR =
    atrScale !== 1 ? Number((inst.dailyATR * atrScale).toFixed(4)) : inst.dailyATR;
  const updatedInstrument: AShareInstrument = {
    ...inst,
    currentPrice: livePrice > 0 ? livePrice : inst.currentPrice,
    preClose: livePreClose > 0 ? livePreClose : inst.preClose,
    changePct:
      livePrice > 0 && livePreClose > 0
        ? Number((((livePrice - livePreClose) / livePreClose) * 100).toFixed(2))
        : inst.changePct,
    dailyATR: displayATR,
    peTTM,
    pb,
    valuationSource,
    syntheticBars: false,
  };

  return {
    instrument: updatedInstrument,
    detail: {
      id: inst.id,
      code: inst.code,
      name: inst.name,
      prevPrice,
      newPrice: livePrice > 0 ? livePrice : prevPrice,
      prevDate,
      newDate: quoteDate || prevDate,
      addedBars: 0,
      isUpdated:
        (livePrice > 0 && livePrice !== prevPrice) ||
        peTTM !== (inst.peTTM ?? 0) ||
        pb !== (inst.pb ?? 0),
      dailyATR: displayATR,
      annualizedVol: inst.annualizedVol,
      peTTM,
      pb,
      valuationSource,
      warning: warning || undefined,
      snapshotKey,
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

  // 1. 批量获取实时快照（含宽基 ETF 映射的指数代码，用于指数 PE）
  const symbols = instruments.map(i => codeToTencentSymbol(i.code));
  for (const inst of instruments) {
    const six = inst.code.split('.')[0];
    const idx = ETF_INDEX_MAP[six];
    if (idx) symbols.push(`sh${idx}`);
  }
  const quotesMap = await fetchBatchTencentQuotes(symbols);

  // 1.5 第二通道（东财）互验数据：仅个股（东财指数 PE 为假值）
  const stockCodes = instruments.filter(i => i.isETF === false).map(i => i.code.split('.')[0]);
  const emMap = await fetchEastmoneyQuotes(stockCodes);

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
      const six = inst.code.split('.')[0];
      const idx = ETF_INDEX_MAP[six];
      const indexQuote = idx ? quotesMap.get(`sh${idx}`) : undefined;
      return syncSingleInstrument(inst, quote, { emQuote: emMap.get(six), indexQuote });
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

  // 3. 估值快照落盘（同 key+date 去重）并用最新历史刷新分位
  const snapEntries: ValuationSnapshot[] = [];
  for (const d of details) {
    if (!d.snapshotKey || !d.newDate) continue;
    if (!((d.peTTM ?? 0) > 0 || (d.pb ?? 0) > 0)) continue;
    snapEntries.push({
      date: d.newDate,
      key: d.snapshotKey,
      pe: (d.peTTM ?? 0) > 0 ? d.peTTM : undefined,
      pb: (d.pb ?? 0) > 0 ? d.pb : undefined,
      source: d.valuationSource === 'index_mapped' ? 'tencent-index' : 'tencent',
    });
  }
  const appended = appendValuationSnapshots(snapEntries);
  const enriched = enrichUniverseValuation(updatedInstruments);

  const report: SyncReport = {
    success: failedCount === 0 || updatedCount > 0,
    timestamp: new Date().toISOString(),
    latestTradingDate,
    totalInstruments: instruments.length,
    updatedCount,
    alreadyLatestCount,
    failedCount,
    valuationSnapshotsAppended: appended,
    details,
  };

  return { updatedInstruments: enriched.instruments, report };
}
