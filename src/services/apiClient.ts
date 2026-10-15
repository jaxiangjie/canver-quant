import { AShareInstrument, AShareBar, ExternalDataAdapterConfig } from '../types/ashare';
import { INITIAL_INSTRUMENTS, generateHistoricalBars } from './mockData';
import { generate3YearValuationHistory } from './ashareStrategies';
import { syncAllInstruments, SyncReport } from './liveMarketSync';

const LOCAL_STORAGE_KEY = 'carver_ashare_universe_v3';
const DATA_CONFIG_KEY = 'carver_data_adapter_config_v1';

/**
 * 日线增量同步（K 线）报告 —— 与 src/services/dailyBarSync.ts 的 BarSyncReport 同形。
 * 刻意在此本地声明而非 import：dailyBarSync 依赖 node 的 fs/path 与 python 子进程，
 * 把它的模块引入浏览器端会污染打包产物。字段改动时两边需同步。
 */
export interface BarSyncSummary {
  total: number;
  updated: number;
  upToDate: number;
  failed: number;
  skipped?: boolean;
  reason?: string;
  gateDate?: string;
}

/**
 * 把「日线同步」结果翻成一句人话（App 悬浮提示 / 数据适配台共用，避免两处口径分叉）。
 * 关键点：K 线没更新成功时绝不能并入快照的成功文案 —— 那会让用户拿着过期 K 线去调仓。
 */
export function barSyncNotice(
  bar: BarSyncSummary | null,
): { type: 'success' | 'info' | 'error'; message: string } | null {
  if (!bar) return null;
  if (bar.skipped) {
    return { type: 'info', message: `K 线未改动：${bar.reason || '本地已是最新交易日'}` };
  }
  if (bar.failed > 0) {
    return {
      type: 'error',
      message: `日线同步未完成：仅 ${bar.updated}/${bar.total} 只推进，${bar.failed} 只失败；本轮信号仍基于旧 K 线，请在数据适配台重试`,
    };
  }
  if (bar.updated === 0) {
    return { type: 'info', message: `日线无需更新：${bar.total} 只标的均已在最新交易日` };
  }
  return {
    type: 'success',
    message: `K 线已推进 ${bar.updated}/${bar.total} 只标的，EWMAC/波动率/目标股数已重算`,
  };
}

function emptySyncReport(total: number): SyncReport {
  return {
    success: false,
    timestamp: new Date().toISOString(),
    latestTradingDate: '',
    totalInstruments: total,
    updatedCount: 0,
    alreadyLatestCount: 0,
    failedCount: total,
    details: [],
  };
}

export const DEFAULT_DATA_CONFIG: ExternalDataAdapterConfig = {
  useMock: true,
  endpointUrl: '/api/ashare/ingest',
  syncIntervalHours: 24,
  lastSyncTime: new Date().toISOString().replace('T', ' ').substring(0, 19),
};

/**
 * Ensure loaded instrument has complete, valid bars, technical indicators, and valuation metrics
 */
export function hydrateInstrument(raw: any): AShareInstrument {
  const currentPrice = Number(raw?.currentPrice || raw?.close || raw?.price || 1.0);
  const annualizedVol = Number(raw?.annualizedVol || raw?.vol || 0.18);
  const code = String(raw?.code || raw?.id || '510300.SH');
  const isETF = raw?.isETF ?? (code.startsWith('51') || code.startsWith('15') || code.startsWith('58'));
  const isT0 = raw?.isT0 ?? (code.startsWith('511') || code.startsWith('513') || code.startsWith('518'));

  // bars 不足时会被合成为伪随机 K 线 —— 必须打上 syntheticBars 标记，
  // 否则这些假数据会静默进入回测与相关性计算（历史 P0 问题）。
  const hasRealBars = Array.isArray(raw?.bars) && raw.bars.length >= 20;
  const bars = hasRealBars
    ? raw.bars
    : generateHistoricalBars(currentPrice, annualizedVol, 0.05, 'oscillator');

  return {
    id: String(raw?.id || code).replace(/[^a-zA-Z0-9]/g, ''),
    code: code.includes('.') ? code : (code.startsWith('6') || code.startsWith('5') ? `${code}.SH` : `${code}.SZ`),
    name: String(raw?.name || `自选标的 (${code})`),
    category: raw?.category || (isETF ? 'broad_etf' : 'stock_cn'),
    isETF,
    isT0,
    stampDutyExempt: raw?.stampDutyExempt ?? isETF,
    currentPrice,
    preClose: Number(raw?.preClose || raw?.pre_close || currentPrice),
    changePct: Number(raw?.changePct || raw?.pct_chg || 0),
    dailyATR: Number(raw?.dailyATR || raw?.atr || (currentPrice * (annualizedVol / 15.8))),
    annualizedVol,
    riskBudgetWeight: Number(raw?.riskBudgetWeight ?? 0.1),
    currentShares: Number(raw?.currentShares ?? 0),
    premiumDiscountRate: raw?.premiumDiscountRate,
    dividendYield: raw?.dividendYield,
    peTTM: Number(raw?.peTTM ?? (isETF ? 14.5 : 22.0)),
    pb: Number(raw?.pb ?? 1.45),
    pePercentile: Number(raw?.pePercentile ?? (raw?.category === 'bond_etf' || raw?.category === 'commodity_etf' ? 50 : 35)),
    pbPercentile: Number(raw?.pbPercentile ?? (raw?.category === 'bond_etf' || raw?.category === 'commodity_etf' ? 50 : 30)),
    // 演示模式兜底：无真实估值数据时合成 PE/PB 序列（真实行情无此字段，图表已改用价格分位）。
historicalValuation: Array.isArray(raw?.historicalValuation) && raw.historicalValuation.length > 0
      ? raw.historicalValuation
      : generate3YearValuationHistory({
          category: raw?.category || (isETF ? 'broad_etf' : 'stock_cn'),
          peTTM: Number(raw?.peTTM ?? (isETF ? 14.5 : 22.0)),
          pb: Number(raw?.pb ?? 1.45),
          pePercentile: Number(raw?.pePercentile ?? (raw?.category === 'bond_etf' || raw?.category === 'commodity_etf' ? 50 : 35)),
          pbPercentile: Number(raw?.pbPercentile ?? (raw?.category === 'bond_etf' || raw?.category === 'commodity_etf' ? 50 : 30)),
        }),
    bars,
    syntheticBars: !hasRealBars,
    // 真实 K 线元信息透传（2026-10-15）：bars 被服务端剥离时，上面的 bars 是合成的，
    // 展示层必须用这两个字段，不能拿合成 bars 的根数/末根日期当真实数据。
    barsCount: Number(raw?.barsCount ?? (Array.isArray(raw?.bars) ? raw.bars.length : 0)) || undefined,
    lastBarDate: raw?.lastBarDate ?? (hasRealBars ? raw.bars[raw.bars.length - 1].tradeDate : null),
    // 服务端用真实 bars 算好的策略标量：必须透传，否则 hydrate 会把唯一真实的趋势口径丢掉
    signals: raw?.signals,
    dataSource: raw?.dataSource ?? (hasRealBars ? 'parquet' : 'manual'),
    // 成交额是否合成（staging 晋升源 = volShares×close）：与 K 线真假无关，ADV 类消费方要知情
    syntheticAmount: raw?.syntheticAmount,
    // 基本面健康度扩展字段透传
    roe: raw?.roe,
    netProfitGrowthYoy: raw?.netProfitGrowthYoy,
    revenueGrowthYoy: raw?.revenueGrowthYoy,
    grossMargin: raw?.grossMargin,
    debtRatio: raw?.debtRatio,
    eps: raw?.eps,
    bps: raw?.bps,
    latestReportPeriod: raw?.latestReportPeriod,
    historicalFundamentals: raw?.historicalFundamentals,
    fundamentalQualityScore: raw?.fundamentalQualityScore,
    valueTrapRisk: raw?.valueTrapRisk,
  };
}

export class AShareDataService {
  /**
   * Load active instruments either from server API or local store fallback
   */
  static async loadInstruments(): Promise<AShareInstrument[]> {
    try {
      const res = await fetch('/api/ashare/instruments', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const hydrated = data.map(hydrateInstrument);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(hydrated));
          // 静默异步加载估值历史序列，供前端回测与图表消费
          fetch('/api/ashare/valuation-series')
            .then(r => r.ok ? r.json() : null)
            .then(seriesObj => {
              if (seriesObj && typeof seriesObj === 'object') {
                import('./valuationStore').then(vs => {
                  const map = new Map<string, any[]>();
                  for (const [k, v] of Object.entries(seriesObj)) {
                    if (Array.isArray(v)) map.set(k, v);
                  }
                  vs.setClientValuationSeries(map);
                });
              }
            })
            .catch(() => {});
          return hydrated;
        }
      }
    } catch {
      // Server not reachable or client preview; fallback to local storage
    }

    const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(hydrateInstrument);
        }
      } catch {
        // invalid cache
      }
    }

    // Default seed
    const seed = INITIAL_INSTRUMENTS.map(hydrateInstrument);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  /**
   * Save instruments to localStorage and attempt server sync
   */
  static async saveInstruments(instruments: AShareInstrument[]): Promise<void> {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(instruments));
    try {
      // 瘦身上传：ingest 语义是「用户操作结果提交」，只传可编辑字段（服务端防御也只接受这两个字段）。
      // 全量上传（含 bars，曾达 17MB）既浪费又给过期数据覆盖服务端留口子。
      const payload = instruments.map((i) => ({
        id: i.id,
        code: i.code,
        currentShares: i.currentShares,
        riskBudgetWeight: i.riskBudgetWeight,
      }));
      await fetch('/api/ashare/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: payload }),
      });
    } catch {
      // offline / mock mode
    }
  }

  /**
   * Ingest raw external data payload from user (Tushare / custom JSON / AKShare)
   */
  static async ingestRawPayload(payload: any[]): Promise<AShareInstrument[]> {
    const current = await this.loadInstruments();
    const updated = [...current];

    for (const item of payload) {
      const code = String(item.code || item.ts_code || '').trim().toUpperCase();
      if (!code) continue;

      const existingIdx = updated.findIndex(u => u.code.toUpperCase() === code || u.id === code);
      const isETF = item.isETF ?? (code.startsWith('51') || code.startsWith('15') || code.startsWith('58'));
      const isT0 = item.isT0 ?? (code.startsWith('511') || code.startsWith('513') || code.startsWith('518'));

      const newInstrument: AShareInstrument = {
        id: code.replace(/[^a-zA-Z0-9]/g, ''),
        code: code.includes('.') ? code : (code.startsWith('6') || code.startsWith('5') ? `${code}.SH` : `${code}.SZ`),
        name: item.name || `自选标的 (${code})`,
        category: item.category || (isETF ? 'broad_etf' : 'stock_cn'),
        isETF,
        isT0,
        stampDutyExempt: isETF,
        currentPrice: Number(item.close || item.currentPrice || item.price || 1.0),
        preClose: Number(item.preClose || item.pre_close || item.price || 1.0),
        changePct: Number(item.changePct || item.pct_chg || 0),
        dailyATR: Number(item.dailyATR || item.atr || 0.05),
        annualizedVol: Number(item.annualizedVol || item.vol || 0.18),
        riskBudgetWeight: Number(item.riskBudgetWeight || 0.1),
        currentShares: Number(item.currentShares || 0),
        premiumDiscountRate: item.premiumDiscountRate,
        dividendYield: item.dividendYield,
        bars: Array.isArray(item.bars) && item.bars.length > 0 ? item.bars : (existingIdx >= 0 ? updated[existingIdx].bars : []),
      };

      const hydrated = hydrateInstrument(newInstrument);

      if (existingIdx >= 0) {
        updated[existingIdx] = { ...updated[existingIdx], ...hydrated };
      } else {
        updated.push(hydrated);
      }
    }

    await this.saveInstruments(updated);
    return updated;
  }

  /**
   * Load Adapter config
   */
  static loadConfig(): ExternalDataAdapterConfig {
    const cached = localStorage.getItem(DATA_CONFIG_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // ignore
      }
    }
    return DEFAULT_DATA_CONFIG;
  }

  static saveConfig(cfg: ExternalDataAdapterConfig) {
    localStorage.setItem(DATA_CONFIG_KEY, JSON.stringify(cfg));
  }

  static resetUniverse(): AShareInstrument[] {
    const seed = INITIAL_INSTRUMENTS.map(hydrateInstrument);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  /**
   * 获取当前本地/内存宇宙的最大交易日（真实口径）
   *
   * 优先用服务端下发的 lastBarDate：前端 bars 在「服务端瘦身」时是合成序列
   * （hydrateInstrument 兜底生成，末根日期恒为「今天」），拿它算时效会让界面
   * 永远显示「已是最新」。合成 bars 只在没有 lastBarDate 时兜底。
   */
  static getLatestTradeDate(instruments: AShareInstrument[]): string {
    let maxDate = '';
    for (const inst of instruments) {
      const d = inst.lastBarDate || (inst.syntheticBars ? '' : inst.bars?.[inst.bars.length - 1]?.tradeDate) || '';
      if (d && (!maxDate || d > maxDate)) {
        maxDate = d;
      }
    }
    return maxDate;
  }

  /**
   * 在线增量同步最新交易日行情数据（日线 K 线 + 快照）
   * 优先通过服务端 /api/ashare/sync-latest 获取，落盘持久化；若网络或服务端离线则在客户端回退直接同步
   *
   * 返回的 barReport 是「日线 K 线」这一半的结果，与 report（快照字段）分开：
   * 调用方必须分别展示，否则「K 线同步失败」会被快照成功掩盖成一句「同步成功」。
   */
  static async syncLatestMarketData(options?: { codes?: string[] }): Promise<{
    report: SyncReport;
    barReport: BarSyncSummary | null;
    instruments: AShareInstrument[];
  }> {
    try {
      const res = await fetch('/api/ashare/sync-latest', {
        method: options?.codes ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: options?.codes ? JSON.stringify({ codes: options.codes }) : undefined,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.instruments)) {
          const hydrated = data.instruments.map(hydrateInstrument);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(hydrated));
          return {
            report: data.report,
            barReport: data.barReport ?? null,
            instruments: hydrated,
          };
        }
      }
    } catch (err) {
      // 诚实失败：不再回退「浏览器直连公共接口同步」。
      // 该路径用可能过期的本地 universe 合并行情并 POST ingest 回写服务端，
      // 是真实行情被 mock/qfq 数据污染的主动手（2026-10-12 事故）。
      console.warn('[apiClient] server sync failed; keep current universe unchanged:', err);
      const current = await this.loadInstruments();
      return { report: emptySyncReport(current.length), barReport: null, instruments: current };
    }

    // 服务端返回异常（success=false）：同样保持现状，不降级直连
    const current = await this.loadInstruments();
    return { report: emptySyncReport(current.length), barReport: null, instruments: current };
  }

  /**
   * 按需拉取单只标的 K 线（/instruments 已 strip bars 瘦身，17MB → 200KB）
   * limit: 只取尾部 N 根（如算指标只需 ~400 根）；不传则全量（回测/相关性需要全历史）
   */
  static async fetchInstrumentBars(code: string, limit?: number): Promise<AShareBar[]> {
    const q = limit && limit > 0 ? `?limit=${Math.floor(limit)}` : '';
    const res = await fetch(`/api/ashare/bars/${encodeURIComponent(code)}${q}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.bars) ? data.bars : [];
  }

  /** 真实 K 线缓存：key = code@lastBarDate（服务端数据推进/重新同步后 key 变化，自动失效） */
  private static barsCache = new Map<string, AShareBar[]>();
  private static barsInflight = new Map<string, Promise<AShareBar[]>>();

  /**
   * 按需补齐真实 K 线（2026-10-15）。
   *
   * 为什么需要：服务端 /instruments 走 stripBars 瘦身，浏览器侧 hydrateInstrument 会用伪随机序列
   * 兜底（syntheticBars=true）。而 `runRealBacktest` / `correlationEngine` 会过滤 syntheticBars →
   * 界面上「回测沙盘」与「相关性矩阵」直接是空的；本地重算 EWMAC 也会得到伪标量。
   *
   * 语义：只对「服务端确有 parquet 数据」（dataSource==='parquet'）且当前仍是合成 bars 的标的
   * 拉真实 K 线；全部命中缓存时返回**原数组引用**（调用方可据此跳过 setState，避免 effect 抖动）。
   * 拉取失败保持 syntheticBars 标记不变（诚实，下次可重试），绝不假装成功。
   */
  static async ensureRealBars(
    instruments: AShareInstrument[],
    opts: { limit?: number } = {},
  ): Promise<AShareInstrument[]> {
    const need = (Array.isArray(instruments) ? instruments : []).filter(
      (i) => i && i.dataSource === 'parquet' && i.syntheticBars === true,
    );
    if (!need.length) return instruments;

    const out = [...instruments];
    let changed = false;
    await Promise.all(
      need.map(async (inst) => {
        // ⚠️ 缓存 key 必须带 limit（2026-10-15 踩坑）：净值卡片按 limit=90 取尾部、
        // 回测面板按全量取历史，若 key 只含 code@lastBarDate，先请求的一方会把结果
        // 缓存给另一方 —— 回测拿到 90 根 → minHistoryBars 不足 → 「0 次再平衡」空回测。
        const key = `${inst.code}@${inst.lastBarDate ?? ''}@${opts.limit ?? 'full'}`;
        let bars = this.barsCache.get(key);
        if (!bars) {
          let pending = this.barsInflight.get(key);
          if (!pending) {
            pending = this.fetchInstrumentBars(inst.code, opts.limit);
            this.barsInflight.set(key, pending);
          }
          try {
            const fetched = await pending;
            if (fetched && fetched.length >= 20) {
              this.barsCache.set(key, fetched);
              bars = fetched;
            }
          } catch {
            /* 失败不缓存，下次重试 */
          } finally {
            this.barsInflight.delete(key);
          }
        }
        if (!bars || bars.length < 20) return;
        const idx = out.findIndex((x) => x.id === inst.id);
        if (idx >= 0) {
          out[idx] = { ...out[idx], bars, syntheticBars: false };
          changed = true;
        }
      }),
    );
    return changed ? out : instruments;
  }

  /**
   * 动态解析并补全任意 A 股 / ETF 标的信息（快捷输入支持：代码池优先 + 实时网络回退）
   */
  static async resolveSymbol(code: string): Promise<{ success: boolean; instrument?: AShareInstrument; message?: string }> {
    try {
      const res = await fetch(`/api/ashare/resolve-symbol/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (res.ok && data.success && data.instrument) {
        return { success: true, instrument: hydrateInstrument(data.instrument) };
      }
      return { success: false, message: data.message || '无法解析标的代码' };
    } catch (err: any) {
      return { success: false, message: err?.message || '网络请求失败' };
    }
  }
}
