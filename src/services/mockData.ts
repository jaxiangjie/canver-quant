import { AShareInstrument, AShareBar } from '../types/ashare';

/**
 * Generate synthetic but realistic 250 trading days of A-Share/ETF price series
 */
export function generateHistoricalBars(
  basePrice: number,
  annualVol: number,
  drift: number,
  trendType: 'up' | 'down' | 'oscillator' | 'steady',
  seedOffset: number = 0
): AShareBar[] {
  const bars: AShareBar[] = [];
  const days = 250;
  const dailyVol = annualVol / Math.sqrt(250);
  let price = basePrice * 0.88; // start slightly earlier
  
  const today = new Date();
  
  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 1.45)); // approximate trading calendar
    const dateStr = d.toISOString().split('T')[0];

    // Seeded random walk with unique phase offset for different asset classes
    // Macro common factor (A-share market beta ~ 0.35) + idiosyncratic asset factor
    const macroBeta = Math.sin(i * 0.12) * 0.4 + Math.cos(i * 0.25) * 0.3;
    const idioRand = Math.sin((i + seedOffset * 37) * 0.28) * 0.6 + Math.cos((i + seedOffset * 19) * 0.41) * 0.4;
    
    // Asset class specific coupling:
    // Equities have strong shared market beta (~0.75) + individual idiosyncratic factor
    // Bonds have slight negative correlation with equities (-0.25)
    // Gold is largely non-correlated / safe haven (~0.05)
    // Nasdaq has mild positive correlation with A-share risk asset sentiment (~0.25)
    let combinedNoise = 0;
    if (seedOffset === 4) {
      // 511010 国债ETF: 股债跷跷板效应，与股票 Beta 弱负相关
      combinedNoise = -0.30 * macroBeta + 0.65 * idioRand;
    } else if (seedOffset === 5) {
      // 518880 黄金ETF: 国际避险与抗通胀资产，弱相关
      combinedNoise = 0.08 * macroBeta + 0.85 * idioRand;
    } else if (seedOffset === 6) {
      // 513100 纳指ETF: 海外流动性与科技股，适度相关
      combinedNoise = 0.32 * macroBeta + 0.75 * idioRand;
    } else {
      // A股宽基/红利/大盘股 (510300, 510500, 588000, 512890, 601857): 共享较强的 A 股市场大盘 Beta
      combinedNoise = 0.72 * macroBeta + 0.40 * idioRand;
    }

    let trendFactor = 0;
    if (trendType === 'up') trendFactor = 0.0008;
    else if (trendType === 'down') trendFactor = -0.0006;
    else if (trendType === 'steady') trendFactor = 0.0001;
    
    const dayReturn = trendFactor + (combinedNoise * dailyVol * 0.85);
    const preClose = price;
    price = Math.max(0.1, price * (1 + dayReturn));
    
    const rand = combinedNoise;
    const high = price * (1 + Math.abs(rand * 0.008));
    const low = price * (1 - Math.abs(rand * 0.007));
    const open = (preClose + price) / 2;
    const changePct = ((price - preClose) / preClose) * 100;
    const volume = Math.floor(50000 + Math.abs(rand * 80000));
    const turnover = Math.round((volume * price) / 100);

    bars.push({
      tradeDate: dateStr,
      open: Number(open.toFixed(3)),
      high: Number(high.toFixed(3)),
      low: Number(low.toFixed(3)),
      close: Number(price.toFixed(3)),
      preClose: Number(preClose.toFixed(3)),
      changePct: Number(changePct.toFixed(2)),
      volume,
      turnover,
      atr20: Number((price * dailyVol * 1.2).toFixed(3)),
    });
  }

  // Calculate Moving Averages
  for (let i = 0; i < bars.length; i++) {
    if (i >= 19) {
      const slice20 = bars.slice(i - 19, i + 1);
      bars[i].ma20 = Number((slice20.reduce((acc, b) => acc + b.close, 0) / 20).toFixed(3));
    }
    if (i >= 59) {
      const slice60 = bars.slice(i - 59, i + 1);
      bars[i].ma60 = Number((slice60.reduce((acc, b) => acc + b.close, 0) / 60).toFixed(3));
    }
    if (i >= 249) {
      const slice250 = bars.slice(i - 249, i + 1);
      bars[i].ma250 = Number((slice250.reduce((acc, b) => acc + b.close, 0) / 250).toFixed(3));
    }
  }

  return bars;
}

export const INITIAL_INSTRUMENTS: AShareInstrument[] = [
  {
    id: '510300',
    code: '510300.SH',
    name: '沪深300ETF',
    category: 'broad_etf',
    isETF: true,
    isT0: false,
    stampDutyExempt: true,
    currentPrice: 4.025,
    preClose: 3.992,
    changePct: 0.83,
    dailyATR: 0.051,
    annualizedVol: 0.185,
    riskBudgetWeight: 0.15,
    currentShares: 50000, // 500手
    premiumDiscountRate: 0.04,
    dividendYield: 2.75,
    peTTM: 11.8,
    pb: 1.25,
    pePercentile: 24.5,
    pbPercentile: 18.2,
    bars: generateHistoricalBars(4.025, 0.185, 0.08, 'up', 0),
  },
  {
    id: '510500',
    code: '510500.SH',
    name: '中证500ETF',
    category: 'broad_etf',
    isETF: true,
    isT0: false,
    stampDutyExempt: true,
    currentPrice: 5.720,
    preClose: 5.670,
    changePct: 0.88,
    dailyATR: 0.082,
    annualizedVol: 0.224,
    riskBudgetWeight: 0.15,
    currentShares: 26000, // 260手
    premiumDiscountRate: -0.02,
    dividendYield: 1.82,
    peTTM: 22.4,
    pb: 1.78,
    pePercentile: 32.0,
    pbPercentile: 28.5,
    bars: generateHistoricalBars(5.720, 0.224, 0.05, 'oscillator', 1),
  },
  {
    id: '588000',
    code: '588000.SH',
    name: '科创50ETF',
    category: 'broad_etf',
    isETF: true,
    isT0: false,
    stampDutyExempt: true,
    currentPrice: 0.942,
    preClose: 0.925,
    changePct: 1.84,
    dailyATR: 0.021,
    annualizedVol: 0.298,
    riskBudgetWeight: 0.10,
    currentShares: 106000, // 1060手
    premiumDiscountRate: 0.12,
    dividendYield: 0.65,
    peTTM: 42.6,
    pb: 3.85,
    pePercentile: 16.5,
    pbPercentile: 21.0,
    bars: generateHistoricalBars(0.942, 0.298, 0.12, 'up', 2),
  },
  {
    id: '512890',
    code: '512890.SH',
    name: '红利低波ETF',
    category: 'sector_etf',
    isETF: true,
    isT0: false,
    stampDutyExempt: true,
    currentPrice: 1.168,
    preClose: 1.162,
    changePct: 0.52,
    dailyATR: 0.012,
    annualizedVol: 0.118,
    riskBudgetWeight: 0.15,
    currentShares: 130000, // 1300手
    premiumDiscountRate: 0.01,
    dividendYield: 4.85,
    peTTM: 6.2,
    pb: 0.74,
    pePercentile: 28.0,
    pbPercentile: 35.0,
    bars: generateHistoricalBars(1.168, 0.118, 0.09, 'steady', 3),
  },
  {
    id: '511010',
    code: '511010.SH',
    name: '国债ETF',
    category: 'bond_etf',
    isETF: true,
    isT0: true, // T+0 回转
    stampDutyExempt: true,
    currentPrice: 107.25,
    preClose: 107.21,
    changePct: 0.04,
    dailyATR: 0.18,
    annualizedVol: 0.026,
    riskBudgetWeight: 0.15,
    currentShares: 1400, // 14手
    premiumDiscountRate: -0.01,
    dividendYield: 2.30,
    peTTM: 0,
    pb: 0,
    pePercentile: 50.0,
    pbPercentile: 50.0,
    bars: generateHistoricalBars(107.25, 0.026, 0.03, 'steady', 4),
  },
  {
    id: '518880',
    code: '518880.SH',
    name: '黄金ETF',
    category: 'commodity_etf',
    isETF: true,
    isT0: true, // T+0 回转
    stampDutyExempt: true,
    currentPrice: 5.680,
    preClose: 5.655,
    changePct: 0.44,
    dailyATR: 0.052,
    annualizedVol: 0.142,
    riskBudgetWeight: 0.10,
    currentShares: 17600, // 176手
    premiumDiscountRate: 0.08,
    dividendYield: 0.00,
    peTTM: 0,
    pb: 0,
    pePercentile: 50.0,
    pbPercentile: 50.0,
    bars: generateHistoricalBars(5.680, 0.142, 0.15, 'up', 5),
  },
  {
    id: '513100',
    code: '513100.SH',
    name: '纳指ETF (QDII)',
    category: 'qdii_etf',
    isETF: true,
    isT0: true, // T+0 回转
    stampDutyExempt: true,
    currentPrice: 1.624,
    preClose: 1.610,
    changePct: 0.87,
    dailyATR: 0.023,
    annualizedVol: 0.198,
    riskBudgetWeight: 0.10,
    currentShares: 61000, // 610手
    premiumDiscountRate: 1.15, // 存在溢价率
    dividendYield: 0.72,
    peTTM: 32.5,
    pb: 5.60,
    pePercentile: 78.5,
    pbPercentile: 82.0,
    bars: generateHistoricalBars(1.624, 0.198, 0.18, 'up', 6),
  },
  {
    id: '601857',
    code: '601857.SH',
    name: '中国石油',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false, // A股个股卖出需缴纳千0.5印花税
    currentPrice: 8.85,
    preClose: 8.78,
    changePct: 0.80,
    dailyATR: 0.14,
    annualizedVol: 0.205,
    riskBudgetWeight: 0.10, // 8大标的之一，占比 10%
    currentShares: 11000, // 110手 (约 9.7 万元)
    dividendYield: 5.65, // A股能源高股息标杆
    peTTM: 9.8, // 滚动市盈率低位
    pb: 0.95, // 市净率低位
    pePercentile: 36.5,
    pbPercentile: 32.0,
    bars: generateHistoricalBars(8.85, 0.205, 0.09, 'steady', 7),
  },
  {
    id: '513180',
    code: '513180.SH',
    name: '恒生科技ETF (QDII)',
    category: 'qdii_etf',
    isETF: true,
    isT0: true, // T+0 回转 (跨境 QDII ETF)
    stampDutyExempt: true,
    currentPrice: 0.620,
    preClose: 0.615,
    changePct: 0.81,
    dailyATR: 0.018,
    annualizedVol: 0.305, // 恒生科技高波动，真实数值由 parquet 覆盖
    riskBudgetWeight: 0.10,
    currentShares: 80000, // 800手
    premiumDiscountRate: 0.85, // QDII 常见溢价
    dividendYield: 0.55,
    peTTM: 22.0,
    pb: 2.60,
    pePercentile: 30.0,
    pbPercentile: 25.0,
    bars: generateHistoricalBars(0.620, 0.305, 0.14, 'up', 8),
  },
  {
    id: '513520',
    code: '513520.SH',
    name: '日经225ETF (QDII)',
    category: 'qdii_etf',
    isETF: true,
    isT0: true, // T+0 回转 (跨境 QDII ETF)
    stampDutyExempt: true,
    currentPrice: 2.394, // 后复权价，真实数值由 parquet 覆盖
    preClose: 2.400,
    changePct: -0.25,
    dailyATR: 0.032,
    annualizedVol: 0.347, // 120日真实年化波动（后复权）
    riskBudgetWeight: 0.10,
    currentShares: 0, // 尚未建仓
    premiumDiscountRate: 0.30, // QDII 常见溢价
    dividendYield: 1.80,
    peTTM: 18.5,
    pb: 1.75,
    pePercentile: 42.0,
    pbPercentile: 38.0,
    bars: generateHistoricalBars(2.394, 0.347, 0.12, 'up', 8),
  },

  // ── poorlab 11 腿池（上一级 pool-lab 定稿生产名单，A股个股）──
  // 价格/波动/bars 均由 parquet 真实日线覆盖（realData.loadRealUniverse），
  // 下方仅为类型占位；currentShares=0 表示新池尚未建仓。
  {
    id: '601288',
    code: '601288.SH',
    name: '农业银行',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false, // A股个股卖出需缴纳千0.5印花税
    currentPrice: 4.50,
    preClose: 4.48,
    changePct: 0.45,
    dailyATR: 0.06,
    annualizedVol: 0.22, // 真实数值由 parquet 覆盖
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 3.58,
    peTTM: 6.4,
    pb: 0.68,
    pePercentile: 40.0,
    pbPercentile: 35.0,
    bars: generateHistoricalBars(4.50, 0.22, 0.06, 'steady', 9),
  },
  {
    id: '601318',
    code: '601318.SH',
    name: '中国平安',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 52.0,
    preClose: 51.8,
    changePct: 0.39,
    dailyATR: 0.9,
    annualizedVol: 0.24,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 6.91,
    peTTM: 9.1,
    pb: 1.05,
    pePercentile: 22.0,
    pbPercentile: 28.0,
    bars: generateHistoricalBars(52.0, 0.24, 0.07, 'oscillator', 10),
  },
  {
    id: '600886',
    code: '600886.SH',
    name: '国投电力',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 15.0,
    preClose: 14.9,
    changePct: 0.67,
    dailyATR: 0.25,
    annualizedVol: 0.27,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 2.50,
    peTTM: 13.5,
    pb: 1.85,
    pePercentile: 30.0,
    pbPercentile: 32.0,
    bars: generateHistoricalBars(15.0, 0.27, 0.08, 'up', 11),
  },
  {
    id: '601088',
    code: '601088.SH',
    name: '中国神华',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 38.0,
    preClose: 37.8,
    changePct: 0.53,
    dailyATR: 0.6,
    annualizedVol: 0.23,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 4.21,
    peTTM: 11.2,
    pb: 1.55,
    pePercentile: 45.0,
    pbPercentile: 50.0,
    bars: generateHistoricalBars(38.0, 0.23, 0.09, 'steady', 12),
  },
  {
    id: '601919',
    code: '601919.SH',
    name: '中远海控',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 14.0,
    preClose: 13.9,
    changePct: 0.72,
    dailyATR: 0.3,
    annualizedVol: 0.30,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 6.11,
    peTTM: 4.8,
    pb: 1.02,
    pePercentile: 18.0,
    pbPercentile: 22.0,
    bars: generateHistoricalBars(14.0, 0.30, 0.10, 'oscillator', 13),
  },
  {
    id: '601899',
    code: '601899.SH',
    name: '紫金矿业',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 17.0,
    preClose: 16.9,
    changePct: 0.59,
    dailyATR: 0.4,
    annualizedVol: 0.34,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 2.69,
    peTTM: 14.0,
    pb: 3.10,
    pePercentile: 35.0,
    pbPercentile: 40.0,
    bars: generateHistoricalBars(17.0, 0.34, 0.12, 'up', 14),
  },
  {
    id: '000333',
    code: '000333.SZ',
    name: '美的集团',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 70.0,
    preClose: 69.5,
    changePct: 0.72,
    dailyATR: 1.2,
    annualizedVol: 0.25,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 5.37,
    peTTM: 13.0,
    pb: 2.60,
    pePercentile: 38.0,
    pbPercentile: 42.0,
    bars: generateHistoricalBars(70.0, 0.25, 0.08, 'oscillator', 15),
  },
  {
    id: '600660',
    code: '600660.SH',
    name: '福耀玻璃',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 55.0,
    preClose: 54.7,
    changePct: 0.55,
    dailyATR: 1.0,
    annualizedVol: 0.26,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 5.79,
    peTTM: 18.0,
    pb: 3.80,
    pePercentile: 48.0,
    pbPercentile: 50.0,
    bars: generateHistoricalBars(55.0, 0.26, 0.09, 'up', 16),
  },
  {
    id: '002714',
    code: '002714.SZ',
    name: '牧原股份',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 45.0,
    preClose: 44.8,
    changePct: 0.45,
    dailyATR: 1.1,
    annualizedVol: 0.33,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 3.19,
    peTTM: 11.0,
    pb: 3.20,
    pePercentile: 20.0,
    pbPercentile: 18.0,
    bars: generateHistoricalBars(45.0, 0.33, 0.05, 'oscillator', 17),
  },
  {
    id: '002223',
    code: '002223.SZ',
    name: '鱼跃医疗',
    category: 'stock_cn',
    isETF: false,
    isT0: false,
    stampDutyExempt: false,
    currentPrice: 35.0,
    preClose: 34.8,
    changePct: 0.57,
    dailyATR: 0.7,
    annualizedVol: 0.28,
    riskBudgetWeight: 0.0909,
    currentShares: 0,
    dividendYield: 1.85,
    peTTM: 20.0,
    pb: 2.90,
    pePercentile: 25.0,
    pbPercentile: 24.0,
    bars: generateHistoricalBars(35.0, 0.28, 0.06, 'oscillator', 18),
  },
];
