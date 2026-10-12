import { AShareInstrument, ExternalDataAdapterConfig } from '../types/ashare';
import { INITIAL_INSTRUMENTS, generateHistoricalBars } from './mockData';
import { generate3YearValuationHistory } from './ashareStrategies';
import { syncAllInstruments, SyncReport } from './liveMarketSync';

const LOCAL_STORAGE_KEY = 'carver_ashare_universe_v3';
const DATA_CONFIG_KEY = 'carver_data_adapter_config_v1';

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
    dataSource: raw?.dataSource ?? (hasRealBars ? 'parquet' : 'manual'),
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
      await fetch('/api/ashare/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments }),
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
   * 获取当前本地/内存宇宙的最大交易日
   */
  static getLatestTradeDate(instruments: AShareInstrument[]): string {
    let maxDate = '';
    for (const inst of instruments) {
      if (Array.isArray(inst.bars) && inst.bars.length > 0) {
        const d = inst.bars[inst.bars.length - 1].tradeDate;
        if (d && (!maxDate || d > maxDate)) {
          maxDate = d;
        }
      }
    }
    return maxDate;
  }

  /**
   * 在线增量同步最新交易日行情数据
   * 优先通过服务端 /api/ashare/sync-latest 获取，落盘持久化；若网络或服务端离线则在客户端回退直接同步
   */
  static async syncLatestMarketData(options?: { codes?: string[] }): Promise<{
    report: SyncReport;
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
          return { report: data.report, instruments: hydrated };
        }
      }
    } catch (err) {
      console.warn('[apiClient] server sync failed, attempting direct sync:', err);
    }

    // 回退到客户端直接直连公共接口同步
    const current = await this.loadInstruments();
    const { updatedInstruments, report } = await syncAllInstruments(current);
    const hydrated = updatedInstruments.map(hydrateInstrument);
    await this.saveInstruments(hydrated);
    return { report, instruments: hydrated };
  }
}
