import { RebalanceRecord, RebalanceTradeItem } from '../types/ashare';

export const REBALANCE_STORAGE_KEY = 'carver_rebalance_history_v1';

/**
 * 标的代码归一化处理（去除 sh/sz 前缀与 .SH/.SZ 后缀，提取纯 6 位数字）
 */
export function normalizeInstrumentCode(code: string): string {
  if (!code) return '';
  return code.trim().toUpperCase().replace(/^(SH|SZ)/, '').split('.')[0];
}

/**
 * 初始预置调仓历史样本（保证用户初次进入就能直观体验「最近3次调仓轨迹」与「多组合专属记录」功能）
 */
export const INITIAL_REBALANCE_RECORDS: RebalanceRecord[] = [
  // 1. 实盘现状: 我的当前持仓 (42万) 组合调仓记录
  {
    id: 'reb_20261014_143000',
    portfolioId: 'user_actual_holdings',
    portfolioName: '实盘现状: 我的当前持仓 (42万)',
    timestamp: '2026-10-14T06:30:00.000Z',
    displayTime: '2026-10-14 14:30',
    totalCapital: 420000,
    tradesCount: 2,
    totalTurnover: 18322,
    estimatedFee: 14.5,
    trades: [
      {
        code: '601288.SH',
        name: '农业银行',
        action: 'BUY',
        shares: 600,
        price: 15.91,
        turnover: 9546,
        preShares: 8000,
        postShares: 8600,
        targetShares: 8600,
        reason: '突破 12% 缓冲带，低估值高股息资产触发补仓',
      },
      {
        code: '518880.SH',
        name: '黄金ETF',
        action: 'SELL',
        shares: 1500,
        price: 5.85,
        turnover: 8776,
        preShares: 13700,
        postShares: 12200,
        targetShares: 12200,
        reason: '大宗避险资产涨幅过大，平准化削峰止盈',
      },
    ],
  },
  {
    id: 'reb_20260920_101500',
    portfolioId: 'user_actual_holdings',
    portfolioName: '实盘现状: 我的当前持仓 (42万)',
    timestamp: '2026-09-20T02:15:00.000Z',
    displayTime: '2026-09-20 10:15',
    totalCapital: 420000,
    tradesCount: 2,
    totalTurnover: 23440,
    estimatedFee: 18.2,
    trades: [
      {
        code: '601288.SH',
        name: '农业银行',
        action: 'BUY',
        shares: 1000,
        price: 14.80,
        turnover: 14800,
        preShares: 7000,
        postShares: 8000,
        targetShares: 8000,
        reason: 'PE 分位处于历史 10% 黄金坑，逆向战术偏置建仓',
      },
      {
        code: '513180.SH',
        name: '恒生科技ETF (QDII)',
        action: 'SELL',
        shares: 12000,
        price: 0.72,
        turnover: 8640,
        preShares: 220000,
        postShares: 208000,
        targetShares: 208000,
        reason: '高波科技资产超配，压降单标的集中度风险',
      },
    ],
  },
  {
    id: 'reb_20260815_140000',
    portfolioId: 'user_actual_holdings',
    portfolioName: '实盘现状: 我的当前持仓 (42万)',
    timestamp: '2026-08-15T06:00:00.000Z',
    displayTime: '2026-08-15 14:00',
    totalCapital: 420000,
    tradesCount: 2,
    totalTurnover: 24076,
    estimatedFee: 17.5,
    trades: [
      {
        code: '601288.SH',
        name: '农业银行',
        action: 'BUY',
        shares: 1000,
        price: 15.30,
        turnover: 15300,
        preShares: 6000,
        postShares: 7000,
        targetShares: 7000,
        reason: '定期月度再平衡，红利标的达到配置目标',
      },
      {
        code: '518880.SH',
        name: '黄金ETF',
        action: 'BUY',
        shares: 1500,
        price: 5.85,
        turnover: 8776,
        preShares: 12200,
        postShares: 13700,
        targetShares: 13700,
        reason: '地缘宏观避险需求提升，卡弗波动率预算加配黄金',
      },
    ],
  },

  // 2. poorlab 11 腿（个股）组合调仓样本
  {
    id: 'reb_20261009_150000',
    portfolioId: 'poorlab11',
    portfolioName: 'poorlab 11 腿（个股）',
    timestamp: '2026-10-09T07:00:00.000Z',
    displayTime: '2026-10-09 15:00',
    totalCapital: 1000000,
    tradesCount: 2,
    totalTurnover: 96480,
    estimatedFee: 78.5,
    trades: [
      {
        code: '600886.SH',
        name: '国投电力',
        action: 'BUY',
        shares: 100,
        price: 880.00,
        turnover: 88000,
        preShares: 100,
        postShares: 200,
        targetShares: 200,
        reason: '动量标量达到 +8.7 强多头，释放进攻配置',
      },
      {
        code: '601857.SH',
        name: '中国石油',
        action: 'SELL',
        shares: 400,
        price: 21.20,
        turnover: 8480,
        preShares: 5600,
        postShares: 5200,
        targetShares: 5200,
        reason: '短期估值修复达到上限，削峰平准止盈',
      },
    ],
  },
  {
    id: 'reb_20260902_143000',
    portfolioId: 'poorlab11',
    portfolioName: 'poorlab 11 腿（个股）',
    timestamp: '2026-09-02T06:30:00.000Z',
    displayTime: '2026-09-02 14:30',
    totalCapital: 1000000,
    tradesCount: 2,
    totalTurnover: 107700,
    estimatedFee: 85.0,
    trades: [
      {
        code: '600886.SH',
        name: '国投电力',
        action: 'BUY',
        shares: 100,
        price: 865.00,
        turnover: 86500,
        preShares: 0,
        postShares: 100,
        targetShares: 100,
        reason: '低波防御公用事业建仓，充当核心压舱石',
      },
      {
        code: '601318.SH',
        name: '中国平安',
        action: 'BUY',
        shares: 400,
        price: 53.00,
        turnover: 21200,
        preShares: 1400,
        postShares: 1800,
        targetShares: 1800,
        reason: '非银金融综合分位见底，卡弗逆向偏置加配',
      },
    ],
  },
  {
    id: 'reb_20260810_100000',
    portfolioId: 'poorlab11',
    portfolioName: 'poorlab 11 腿（个股）',
    timestamp: '2026-08-10T02:00:00.000Z',
    displayTime: '2026-08-10 10:00',
    totalCapital: 1000000,
    tradesCount: 2,
    totalTurnover: 42400,
    estimatedFee: 33.6,
    trades: [
      {
        code: '601857.SH',
        name: '中国石油',
        action: 'BUY',
        shares: 1000,
        price: 21.00,
        turnover: 21000,
        preShares: 4600,
        postShares: 5600,
        targetShares: 5600,
        reason: '中特估高分红现金流稳健，配置权重对齐',
      },
      {
        code: '000333.SZ',
        name: '美的集团',
        action: 'BUY',
        shares: 300,
        price: 71.30,
        turnover: 21400,
        preShares: 1100,
        postShares: 1400,
        targetShares: 1400,
        reason: '出海家电优质白马，ROE 维持 20% 以上质量守门通过',
      },
    ],
  },

  // 3. 均衡 ETF 9 腿 组合调仓样本
  {
    id: 'reb_20261010_113000',
    portfolioId: 'balanced9',
    portfolioName: '均衡 ETF 9 腿',
    timestamp: '2026-10-10T03:30:00.000Z',
    displayTime: '2026-10-10 11:30',
    totalCapital: 1000000,
    tradesCount: 2,
    totalTurnover: 52100,
    estimatedFee: 5.2,
    trades: [
      {
        code: '510300.SH',
        name: '沪深300ETF',
        action: 'SELL',
        shares: 4000,
        price: 4.02,
        turnover: 16080,
        preShares: 38000,
        postShares: 34000,
        targetShares: 34000,
        reason: '冲高触及上轨缓冲带，大盘宽基被动削峰',
      },
      {
        code: '510500.SH',
        name: '中证500ETF',
        action: 'BUY',
        shares: 6000,
        price: 6.00,
        turnover: 36000,
        preShares: 22000,
        postShares: 28000,
        targetShares: 28000,
        reason: '中盘成长性价比显现，卡弗波动率预算补齐',
      },
    ],
  },
];

/** 从本地存储加载所有调仓记录 */
export function loadLocalRebalanceHistory(): RebalanceRecord[] {
  try {
    const raw = localStorage.getItem(REBALANCE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  return INITIAL_REBALANCE_RECORDS;
}

/** 保存调仓记录到本地存储 */
export function saveLocalRebalanceHistory(records: RebalanceRecord[]): void {
  try {
    localStorage.setItem(REBALANCE_STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* ignore */
  }
}

/** 从服务端获取最新调仓记录 */
export async function fetchServerRebalanceHistory(portfolioId?: string, code?: string): Promise<RebalanceRecord[]> {
  try {
    const params = new URLSearchParams();
    if (portfolioId) params.append('portfolioId', portfolioId);
    if (code) params.append('code', code);
    const qs = params.toString();
    const res = await fetch(`/api/ashare/rebalance-history${qs ? '?' + qs : ''}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const j = await res.json();
      if (Array.isArray(j?.history) && j.history.length > 0) {
        saveLocalRebalanceHistory(j.history);
        return j.history;
      }
    }
  } catch {
    /* fallback to local */
  }
  return loadLocalRebalanceHistory();
}

/** 持久化保存一条新的调仓记录（本地+服务端双写，带原子去重） */
export async function persistNewRebalanceRecord(record: RebalanceRecord): Promise<RebalanceRecord[]> {
  const current = loadLocalRebalanceHistory();
  const next = [record, ...current.filter((r) => r.id !== record.id)].slice(0, 500);
  saveLocalRebalanceHistory(next);

  try {
    await fetch('/api/ashare/rebalance-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.warn('[rebalanceStore] server persist failed, local saved:', e);
  }
  return next;
}

export interface InstrumentTradeHistoryItem {
  recordId: string;
  timestamp: string;
  displayTime: string;
  portfolioId: string;
  portfolioName: string;
  totalCapital: number;
  trade: RebalanceTradeItem;
}

/** 获取某个标的最近 N 次调仓记录（默认 3 次） */
export function getLatestTradesForInstrument(
  history: RebalanceRecord[],
  code: string,
  limit: number = 3
): InstrumentTradeHistoryItem[] {
  if (!history || !Array.isArray(history) || !code) return [];
  const cleanCode = normalizeInstrumentCode(code);
  const results: InstrumentTradeHistoryItem[] = [];

  for (const record of history) {
    if (!Array.isArray(record.trades)) continue;
    for (const trade of record.trades) {
      const tradeClean = normalizeInstrumentCode(trade.code);
      if (trade.code === code || tradeClean === cleanCode) {
        results.push({
          recordId: record.id,
          timestamp: record.timestamp,
          displayTime: record.displayTime,
          portfolioId: record.portfolioId,
          portfolioName: record.portfolioName,
          totalCapital: record.totalCapital,
          trade,
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

/** 按组合 ID 过滤调仓记录 */
export function getRebalanceHistoryForPortfolio(
  history: RebalanceRecord[],
  portfolioId?: string
): RebalanceRecord[] {
  if (!history || !Array.isArray(history)) return [];
  if (!portfolioId || portfolioId === 'all') return history;
  return history.filter((r) => r.portfolioId === portfolioId);
}
