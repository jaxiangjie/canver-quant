import { AShareInstrument, CarverSettings, CustomPortfolio, CustomPortfolioItem } from '../types/ashare';
import { calculateInstrumentPosition, DEFAULT_CARVER_SETTINGS } from './carverEngine';

export const PORTFOLIO_COLLECTION_STORAGE_KEY = 'carver_custom_portfolios_library_v2';
export const PORTFOLIO_SELECTED_SLOTS_KEY = 'carver_portfolio_slots_selection_v2';

// 官方内置预设基准（锁定官方标记）
export const OFFICIAL_PORTFOLIOS: CustomPortfolio[] = [
  {
    id: 'official_balanced9',
    name: '官方基准: 均衡 ETF 9 腿 (全天候)',
    description: '涵盖A股宽基、双创、红利、国债、黄金与海外QDII的标准全天候配置方案',
    totalCapital: 1000000,
    isOfficial: true,
    updatedAt: '2026-10-12T00:00:00.000Z',
    items: [
      { id: 'ob_1', code: '510300.SH', name: '沪深300ETF', category: 'broad_etf', amount: 150000, annualizedVol: 0.22, notes: '大盘核心资产' },
      { id: 'ob_2', code: '510500.SH', name: '中证500ETF', category: 'broad_etf', amount: 120000, annualizedVol: 0.25, notes: '中盘成长资产' },
      { id: 'ob_3', code: '588000.SH', name: '科创50ETF', category: 'broad_etf', amount: 80000, annualizedVol: 0.32, notes: '高贝塔科技' },
      { id: 'ob_4', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 150000, annualizedVol: 0.14, notes: '高股息防御资产' },
      { id: 'ob_5', code: '511010.SH', name: '国债ETF', category: 'bond_etf', amount: 200000, annualizedVol: 0.05, notes: '核心固定收益压舱石' },
      { id: 'ob_6', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 120000, annualizedVol: 0.18, notes: '大宗商品抗通胀' },
      { id: 'ob_7', code: '513100.SH', name: '纳指ETF (QDII)', category: 'qdii_etf', amount: 80000, annualizedVol: 0.23, notes: '全球科技分散' },
      { id: 'ob_8', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 50000, annualizedVol: 0.28, notes: '港股科技卫星' },
      { id: 'ob_9', code: '513520.SH', name: '日经225ETF (QDII)', category: 'qdii_etf', amount: 50000, annualizedVol: 0.24, notes: '海外分散配置' },
    ],
  },
  {
    id: 'user_actual_holdings',
    name: '实盘现状: 我的当前持仓 (42万)',
    description: '重仓恒生科技、航天与机器人，缺乏固收与现金备付垫的现状组合',
    totalCapital: 420000,
    isOfficial: false,
    updatedAt: new Date().toISOString(),
    items: [
      { id: 'act_1', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 150000, profitRate: -24.0, profitAmount: -36000, annualizedVol: 0.28, notes: '单标的占比高达35.7%，严重超配高波' },
      { id: 'act_2', code: '562500.SH', name: '机器人ETF华夏', category: 'sector_etf', amount: 45000, profitRate: -13.3, profitAmount: -6000, annualizedVol: 0.35, notes: '高贝塔制造业赛道' },
      { id: 'act_3', code: '512660.SH', name: '军工/航天ETF', category: 'sector_etf', amount: 45000, profitRate: -13.3, profitAmount: -6000, annualizedVol: 0.35, notes: '与机器人高度正相关' },
      { id: 'act_4', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 50000, profitRate: 3.0, profitAmount: 1500, annualizedVol: 0.14, notes: '低波动稳健资产' },
      { id: 'act_5', code: '601288.SH', name: '农业银行 (低估银行)', category: 'stock_cn', amount: 50000, profitRate: 3.0, profitAmount: 1500, annualizedVol: 0.23, notes: '高股息防御资产' },
      { id: 'act_6', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 80000, profitRate: -3.7, profitAmount: -3000, annualizedVol: 0.21, notes: '大宗抗通胀避险资产' },
    ],
  },
  {
    id: 'user_optimized_carver',
    name: '拟定优化: Carver 风险平价平衡方案 (42万)',
    description: '恒科削减、机器人航天合并控仓、增补国债与现金垫的平衡组合',
    totalCapital: 420000,
    isOfficial: false,
    updatedAt: new Date().toISOString(),
    items: [
      { id: 'opt_1', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 75000, annualizedVol: 0.28, notes: '压降至18%合理风控区间，保留反弹弹性' },
      { id: 'opt_2', code: '562500.SH', name: '机器人/航天成长', category: 'sector_etf', amount: 45000, annualizedVol: 0.35, notes: '合并控仓在11%左右，作为进攻卫星' },
      { id: 'opt_3', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 60000, annualizedVol: 0.14, notes: '压舱底仓，高股息正现金流' },
      { id: 'opt_4', code: '601288.SH', name: '农业银行 (低估银行)', category: 'stock_cn', amount: 50000, annualizedVol: 0.23, notes: '高股息防御底仓' },
      { id: 'opt_5', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 80000, annualizedVol: 0.21, notes: '避险抗通胀资产' },
      { id: 'opt_6', code: '511010.SH', name: '国债ETF (压舱石)', category: 'bond_etf', amount: 60000, annualizedVol: 0.05, notes: '新增固收类，大幅平抑组合总波动' },
      { id: 'opt_7', code: 'CASH', name: '现金 / 货币基金 (安全垫)', category: 'bond_etf', amount: 50000, annualizedVol: 0.01, notes: '12%机动备付资金，消除回撤焦虑' },
    ],
  },
];

/**
 * 加载所有自选组合（内置官方基准 + 用户保存的自选组）
 */
export function loadAllPortfolios(): CustomPortfolio[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_COLLECTION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 保证官方预设不被彻底丢失
        const officialIds = new Set(OFFICIAL_PORTFOLIOS.filter(p => p.isOfficial).map(p => p.id));
        const merged = [...parsed];
        for (const off of OFFICIAL_PORTFOLIOS) {
          if (off.isOfficial && !merged.some(m => m.id === off.id)) {
            merged.unshift(off);
          }
        }
        return merged;
      }
    }
  } catch {
    /* ignore */
  }
  return OFFICIAL_PORTFOLIOS;
}

/**
 * 保存组合列表至本地持久化
 */
export function saveAllPortfolios(portfolios: CustomPortfolio[]): void {
  try {
    localStorage.setItem(PORTFOLIO_COLLECTION_STORAGE_KEY, JSON.stringify(portfolios));
  } catch {
    /* ignore */
  }
}

/**
 * 基于标的波动率，一键反比平准化自动计算各标的目标金额
 */
export function calculateRiskParityAllocation(
  items: Array<{ code: string; annualizedVol?: number }>,
  totalCapital: number
): Map<string, number> {
  const result = new Map<string, number>();
  if (!items.length || totalCapital <= 0) return result;

  // 权重正比于 1 / Vol
  const invVols = items.map(it => {
    const vol = Math.max(0.01, it.annualizedVol ?? 0.25);
    return { code: it.code, invVol: 1 / vol };
  });

  const sumInv = invVols.reduce((s, x) => s + x.invVol, 0);
  if (sumInv <= 0) return result;

  invVols.forEach(x => {
    const targetAmt = Math.round((x.invVol / sumInv) * totalCapital / 1000) * 1000;
    result.set(x.code, targetAmt);
  });

  return result;
}

export interface CarverAllocationResult {
  items: CustomPortfolioItem[];
  allocatedCapital: number;
  cashReserve: number;
  message: string;
}

/**
 * 🎯 真正的 Carver 系统化动态定仓：
 * 基于标的历史行情、年线 MA250 趋势、EWMAC 动量标量、估值双守门与单标的 25% 封顶风控。
 * 绝不强行填满 100% 资金！动量差/左侧阴跌的标的自动压缩仓位，未配置资金自动沉淀为现金安全垫。
 */
export function calculateCarverDynamicAllocation(
  portfolio: CustomPortfolio,
  catalog: AShareInstrument[],
  customSettings?: CarverSettings
): CarverAllocationResult {
  const settings: CarverSettings = {
    ...DEFAULT_CARVER_SETTINGS,
    ...customSettings,
    totalCapital: portfolio.totalCapital,
  };

  const catalogMap = new Map<string, AShareInstrument>();
  catalog.forEach(c => {
    catalogMap.set(c.code, c);
    catalogMap.set(c.code.split('.')[0], c);
  });

  // 1. 过滤有效交易标的（剔除已有的现金占位，稍后由系统根据余量自动精确生成）
  const tradableItems = portfolio.items.filter(it => it.code !== 'CASH');
  if (tradableItems.length === 0) {
    return {
      items: [
        {
          id: `cash_${Date.now()}`,
          code: 'CASH',
          name: '现金 / 货币基金 (安全垫)',
          category: 'bond_etf',
          amount: portfolio.totalCapital,
          annualizedVol: 0.01,
          notes: '组合未持有标的，100% 现金避险',
        },
      ],
      allocatedCapital: 0,
      cashReserve: portfolio.totalCapital,
      message: '组合中无可用交易标的，全部保留现金。',
    };
  }

  // 构建临时 universe 用于传给 calculateInstrumentPosition
  const tempUniverse: AShareInstrument[] = tradableItems.map(it => {
    const fromCat = catalogMap.get(it.code) || catalogMap.get(it.code.split('.')[0]);
    if (fromCat) {
      return {
        ...fromCat,
        riskBudgetWeight: 1.0 / tradableItems.length,
      };
    }
    // 池外自选标的：构造合法对象
    const p = it.currentPrice && it.currentPrice > 0 ? it.currentPrice : 1.0;
    const vol = it.annualizedVol ?? 0.25;
    return {
      id: it.code.split('.')[0],
      code: it.code,
      name: it.name,
      category: it.category,
      isETF: it.category.includes('etf'),
      isT0: it.category === 'bond_etf' || it.category === 'commodity_etf' || it.category === 'qdii_etf',
      stampDutyExempt: it.category.includes('etf'),
      currentPrice: p,
      preClose: p,
      changePct: 0,
      dailyATR: Number((p * (vol / 15.8)).toFixed(4)),
      annualizedVol: vol,
      riskBudgetWeight: 1.0 / tradableItems.length,
      currentShares: Math.floor((it.amount / p) / 100) * 100,
      bars: [],
    };
  });

  let totalAllocated = 0;
  const updatedItems: CustomPortfolioItem[] = [];

  tradableItems.forEach((it, idx) => {
    const inst = tempUniverse[idx];
    const pos = calculateInstrumentPosition(inst, tempUniverse, settings);
    const p = Math.max(0.01, inst.currentPrice);
    
    // 目标金额 = 目标股数 * 最新市价 (必须遵守向下整手 100 股)
    let targetAmt = Math.round((pos.targetShares * p) / 100) * 100;

    // 单标的硬风控上限 (默认不超过 25%)
    const maxCap = Math.round(portfolio.totalCapital * (settings.maxInstrumentRiskCap || 0.25));
    if (targetAmt > maxCap) targetAmt = maxCap;

    totalAllocated += targetAmt;

    let note = `标量 ${pos.forecastScalar > 0 ? '+' : ''}${pos.forecastScalar.toFixed(1)} (乘数 ${pos.scalarMultiplier.toFixed(2)}x)`;
    if (pos.forecastScalar <= -5) {
      note += '；跌破均线/负动量，Carver 强制压降仓位防守';
    } else if (pos.forecastScalar >= 5) {
      note += '；站上年线/正动量，释放进攻仓位';
    } else {
      note += '；中性震荡区间';
    }

    updatedItems.push({
      ...it,
      amount: targetAmt,
      currentPrice: p,
      annualizedVol: inst.annualizedVol,
      notes: note,
    });
  });

  // 剩余未用尽的流动性资金，按量化纪律沉淀为现金安全垫
  const cashReserve = Math.max(0, portfolio.totalCapital - totalAllocated);
  if (cashReserve >= 500) {
    updatedItems.push({
      id: `cash_${Date.now()}`,
      code: 'CASH',
      name: '现金 / 货币基金 (安全垫)',
      category: 'bond_etf',
      amount: cashReserve,
      annualizedVol: 0.01,
      notes: `Carver 动态风控沉淀: 当前非满仓状态，留有 ${( (cashReserve / portfolio.totalCapital) * 100 ).toFixed(1)}% 现金消除焦虑`,
    });
  }

  const equityRatio = ((totalAllocated / portfolio.totalCapital) * 100).toFixed(1);
  return {
    items: updatedItems,
    allocatedCapital: totalAllocated,
    cashReserve,
    message: `Carver 动态策略计算完毕: 权益配置仓位 ${equityRatio}% (¥${totalAllocated.toLocaleString()})，保留现金安全垫 ¥${cashReserve.toLocaleString()}`,
  };
}
