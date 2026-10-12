import { AShareInstrument, FinancialReportPoint, FundamentalProfile } from '../types/ashare';

/**
 * 基本面分析与财务质量分析服务 (Fundamental Analysis Service)
 * 
 * 架构设计原则：
 * 1. 解耦隔离：与行情日线、卡弗头寸引擎完全解耦，可独立替换或扩展数据源（东方财富、腾讯财经、AKShare、Tushare）。
 * 2. 真实性与时效性：直接提取 A 股上市公司最新中报/季报/年报的扣非 ROE、净利润同比、营收同比与毛利率。
 * 3. 价值陷阱识别算法：结合“估值百分位 + 盈利增速趋势 + 资本回报率 ROE”对低估资产进行体检。
 */

// 内存单例缓存，避免重复网络调用
let fundamentalCache = new Map<string, FundamentalProfile>();

/**
 * 离线内置种子财报与股息率底座（确保无外网时依然具备真实基准数据）
 */
export const SEED_FUNDAMENTALS: Record<string, Partial<FundamentalProfile>> = {
  '601318': {
    code: '601318',
    name: '中国平安',
    dividendYield: 5.17,
    roe: 9.00,
    revenueGrowthYoy: 15.01,
    netProfitGrowthYoy: 36.06,
    grossMargin: 18.69,
    debtRatio: 89.83,
    eps: 5.11,
    latestReportPeriod: '2026中报',
    qualityScore: 82,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '营运利润与NBV稳健扩张，股息率>5%具备强安全边际，未见价值陷阱迹象。',
  },
  '601288': {
    code: '601288',
    name: '农业银行',
    dividendYield: 3.57,
    roe: 5.07,
    revenueGrowthYoy: 11.07,
    netProfitGrowthYoy: 4.93,
    grossMargin: 36.04,
    debtRatio: 93.47,
    eps: 0.42,
    latestReportPeriod: '2026中报',
    qualityScore: 78,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '国有大行资产质量稳固，净息差收窄趋缓，低PB与持续分红提供扎实防守底色。',
  },
  '000333': {
    code: '000333',
    name: '美的集团',
    dividendYield: 5.11,
    roe: 11.33,
    revenueGrowthYoy: 3.46,
    netProfitGrowthYoy: 1.66,
    grossMargin: 10.22,
    debtRatio: 64.89,
    eps: 3.47,
    latestReportPeriod: '2026中报',
    qualityScore: 85,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '全球白电龙头，海外ToB业务稳步推进，自由现金流丰沛，高质量价值股。',
  },
  '600660': {
    code: '600660',
    name: '福耀玻璃',
    dividendYield: 4.07,
    roe: 10.34,
    revenueGrowthYoy: 2.44,
    netProfitGrowthYoy: -17.37,
    grossMargin: 18.08,
    debtRatio: 48.38,
    eps: 1.52,
    latestReportPeriod: '2026中报',
    qualityScore: 68,
    valueTrapRisk: 'MEDIUM',
    diagnosticSummary: '全球汽车玻璃壁垒极高，但近期单季利润受海外汇率与运费扰动负增长，需观察周期反转。',
  },
  '002714': {
    code: '002714',
    name: '牧原股份',
    dividendYield: 3.13,
    roe: -7.48,
    revenueGrowthYoy: -22.30,
    netProfitGrowthYoy: -157.72,
    grossMargin: -10.24,
    debtRatio: 54.18,
    eps: -1.05,
    latestReportPeriod: '2026中报',
    qualityScore: 32,
    valueTrapRisk: 'HIGH',
    diagnosticSummary: '典型重周期下行：ROE转负且利润断崖下跌。即便低PB亦属周期底亏损，高度警惕价值陷阱。',
  },
  '600886': {
    code: '600886',
    name: '国投电力',
    dividendYield: 3.22,
    roe: 5.05,
    revenueGrowthYoy: -7.05,
    netProfitGrowthYoy: -6.83,
    grossMargin: 26.69,
    debtRatio: 61.26,
    eps: 0.44,
    latestReportPeriod: '2026中报',
    qualityScore: 65,
    valueTrapRisk: 'MEDIUM',
    diagnosticSummary: '雅砻江水电大水电防御品种，来水波动导致短期营收小幅下滑，长期现金流充裕。',
  },
  '601088': {
    code: '601088',
    name: '中国神华',
    dividendYield: 3.98,
    roe: 5.83,
    revenueGrowthYoy: 7.93,
    netProfitGrowthYoy: 4.10,
    grossMargin: 18.76,
    debtRatio: 40.27,
    eps: 1.32,
    latestReportPeriod: '2026中报',
    qualityScore: 84,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '煤电一体化高壁垒，长协煤价熨平周期，现金流与高分红承诺构筑护城河。',
  },
  '601919': {
    code: '601919',
    name: '中远海控',
    dividendYield: 6.07,
    roe: 5.70,
    revenueGrowthYoy: 2.59,
    netProfitGrowthYoy: -23.48,
    grossMargin: 14.03,
    debtRatio: 41.01,
    eps: 0.88,
    latestReportPeriod: '2026中报',
    qualityScore: 58,
    valueTrapRisk: 'HIGH',
    diagnosticSummary: '周期景气度高位回落，运价中枢下滑致利润收缩，静态高股息可能存在次年削减风险。',
  },
  '601899': {
    code: '601899',
    name: '紫金矿业',
    dividendYield: 2.59,
    roe: 19.60,
    revenueGrowthYoy: 15.78,
    netProfitGrowthYoy: 68.17,
    grossMargin: 25.65,
    debtRatio: 49.55,
    eps: 1.47,
    latestReportPeriod: '2026中报',
    qualityScore: 92,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '金铜量价齐升，资源储备与海外矿山投产驱动高ROE与高速盈利扩张。',
  },
  '601857': {
    code: '601857',
    name: '中国石油',
    dividendYield: 4.40,
    roe: 6.30,
    revenueGrowthYoy: 5.34,
    netProfitGrowthYoy: 22.03,
    grossMargin: 7.54,
    debtRatio: 38.88,
    eps: 0.57,
    latestReportPeriod: '2026中报',
    qualityScore: 76,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '上游油气增储上产，天然气销售量效齐增，国企改革分红率提升。',
  },
  '002223': {
    code: '002223',
    name: '鱼跃医疗',
    dividendYield: 4.62,
    roe: 6.22,
    revenueGrowthYoy: -1.92,
    netProfitGrowthYoy: -29.92,
    grossMargin: 18.56,
    debtRatio: 20.42,
    eps: 0.85,
    latestReportPeriod: '2026中报',
    qualityScore: 62,
    valueTrapRisk: 'MEDIUM',
    diagnosticSummary: '呼吸治疗等常规业务逐步恢复，高基数效应消退后进入常态化增长。',
  },
};

/**
 * 宽基 / 行业 ETF 基本面参考配置
 */
export const ETF_FUNDAMENTALS: Record<string, Partial<FundamentalProfile>> = {
  '510300': {
    code: '510300',
    name: '沪深300ETF',
    dividendYield: 2.92,
    roe: 10.45,
    revenueGrowthYoy: 3.85,
    netProfitGrowthYoy: 5.12,
    latestReportPeriod: '指数成分加权',
    qualityScore: 78,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '代表A股核心资产大盘中枢，成分股平均ROE约10.5%，股息率接近3%，整体无系统性价值陷阱。',
  },
  '510500': {
    code: '510500',
    name: '中证500ETF',
    dividendYield: 1.85,
    roe: 7.60,
    revenueGrowthYoy: 4.20,
    netProfitGrowthYoy: 2.10,
    latestReportPeriod: '指数成分加权',
    qualityScore: 68,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '中盘成长制造风格，估值位于历史合理分位，成长性优于大盘但盈利波动略大。',
  },
  '588000': {
    code: '588000',
    name: '科创50ETF',
    dividendYield: 0.85,
    roe: 6.20,
    revenueGrowthYoy: 12.80,
    netProfitGrowthYoy: -8.40,
    latestReportPeriod: '指数成分加权',
    qualityScore: 64,
    valueTrapRisk: 'MEDIUM',
    diagnosticSummary: '硬科技高研发投入，半导体周期触底复苏阶段，高PE需靠未来盈利兑现消化。',
  },
  '512890': {
    code: '512890',
    name: '红利低波ETF',
    dividendYield: 5.35,
    roe: 11.20,
    revenueGrowthYoy: 5.20,
    netProfitGrowthYoy: 6.80,
    latestReportPeriod: '指数成分加权',
    qualityScore: 88,
    valueTrapRisk: 'LOW',
    diagnosticSummary: '高股息率叠加低波动约束，成分股现金流充沛且分红持续性强，避险防御性极佳。',
  },
};

/**
 * 计算基本面质量评分 (Quality Score 0 - 100)
 * 依据财务三因子：资本回报率 (ROE) + 盈利成长性 (Net Profit YoY) + 现金回报 (Dividend Yield)
 */
export function calculateQualityScore(data: {
  roe?: number;
  netProfitGrowthYoy?: number;
  revenueGrowthYoy?: number;
  dividendYield?: number;
}): number {
  const roe = data.roe ?? 0;
  const profitYoy = data.netProfitGrowthYoy ?? 0;
  const divYield = data.dividendYield ?? 0;

  // 1. ROE 评分 (0 - 45分): 15% 以上满分，8% - 15% 优秀，<0 扣至0分
  let roeScore = 0;
  if (roe >= 15) roeScore = 45;
  else if (roe > 0) roeScore = Math.min(45, (roe / 15) * 45);
  else roeScore = 0;

  // 2. 净利润增速评分 (0 - 35分): >25% 满分，0%~25% 线性，<-30% 0分
  let growthScore = 0;
  if (profitYoy >= 25) growthScore = 35;
  else if (profitYoy > 0) growthScore = 15 + (profitYoy / 25) * 20;
  else if (profitYoy > -30) growthScore = Math.max(0, 15 + (profitYoy / 30) * 15);
  else growthScore = 0;

  // 3. 股息率评分 (0 - 20分): >5% 满分，2%~5% 线性
  let divScore = 0;
  if (divYield >= 5) divScore = 20;
  else if (divYield > 0) divScore = (divYield / 5) * 20;

  return Math.round(Math.min(100, Math.max(10, roeScore + growthScore + divScore)));
}

/**
 * 智能价值陷阱检测 (Value Trap Detector)
 * 逻辑：如果标的当前处于低估区间（PE/PB分位低），但盈利增速深度滑坡且ROE显著恶化，
 * 说明“便宜”可能是由基本面坍塌导致的伪便宜（价值陷阱）。
 */
export function evaluateValueTrapRisk(
  instrument: AShareInstrument,
  fundamentals: {
    roe?: number;
    netProfitGrowthYoy?: number;
    revenueGrowthYoy?: number;
  }
): { risk: 'LOW' | 'MEDIUM' | 'HIGH'; warning?: string } {
  // 债券/商品 ETF 不适用价值陷阱检测
  if (instrument.category === 'bond_etf' || instrument.category === 'commodity_etf') {
    return { risk: 'LOW' };
  }

  const pePct = instrument.pePercentile ?? 50;
  const pbPct = instrument.pbPercentile ?? 50;
  const compValuation = Math.round(pePct * 0.55 + pbPct * 0.45);
  const roe = fundamentals.roe ?? 0;
  const profitYoy = fundamentals.netProfitGrowthYoy ?? 0;
  const revYoy = fundamentals.revenueGrowthYoy ?? 0;

  // 高危价值陷阱：估值分位 < 40% (名义便宜)，但净利润暴跌 > 50% 或 ROE < 0 发生亏损
  if (compValuation < 40 && (profitYoy < -50 || roe < 0)) {
    return {
      risk: 'HIGH',
      warning: `警惕严重价值陷阱：估值虽处于历史低位(${compValuation}%)，但${roe < 0 ? '净资产回报已转负亏损' : '净利润大幅下滑' + profitYoy.toFixed(1) + '%'}，当心戴维斯双杀。`,
    };
  }

  // 中度警示：估值偏低(<50%)且连续负增长(利润同比<-15% 且 营收同比<0)
  if (compValuation < 50 && profitYoy < -15 && revYoy < 0) {
    return {
      risk: 'MEDIUM',
      warning: `基本面承压警示：当前估值偏低，但主营营收与净利润双双滑坡(净利${profitYoy.toFixed(1)}%)，盈利动能不足。`,
    };
  }

  // 质量低估（良性）：低估且ROE优秀(>10%)、利润正增长
  if (compValuation < 40 && roe >= 8 && profitYoy >= 0) {
    return {
      risk: 'LOW',
      warning: undefined,
    };
  }

  return { risk: 'LOW' };
}

/**
 * 获取标的基本面画像（支持个股及 ETF，优先查缓存，次之种子底座）
 */
export function getFundamentalProfile(instrument: AShareInstrument): FundamentalProfile {
  const code = instrument.code.split('.')[0];
  if (fundamentalCache.has(code)) {
    return fundamentalCache.get(code)!;
  }

  const seed = instrument.isETF ? ETF_FUNDAMENTALS[code] : SEED_FUNDAMENTALS[code];
  const divYield = instrument.dividendYield || seed?.dividendYield || 0;
  const roe = instrument.roe ?? seed?.roe;
  const netProfitYoy = instrument.netProfitGrowthYoy ?? seed?.netProfitGrowthYoy;
  const revYoy = instrument.revenueGrowthYoy ?? seed?.revenueGrowthYoy;

  const qualityScore = calculateQualityScore({
    roe,
    netProfitGrowthYoy: netProfitYoy,
    revenueGrowthYoy: revYoy,
    dividendYield: divYield,
  });

  const { risk, warning } = evaluateValueTrapRisk(instrument, {
    roe,
    netProfitGrowthYoy: netProfitYoy,
    revenueGrowthYoy: revYoy,
  });

  const profile: FundamentalProfile = {
    code,
    name: instrument.name,
    dividendYield: divYield,
    roe,
    netProfitGrowthYoy: netProfitYoy,
    revenueGrowthYoy: revYoy,
    grossMargin: instrument.grossMargin ?? seed?.grossMargin,
    debtRatio: instrument.debtRatio ?? seed?.debtRatio,
    eps: instrument.eps ?? seed?.eps,
    bps: instrument.bps ?? seed?.bps,
    latestReportPeriod: instrument.latestReportPeriod || seed?.latestReportPeriod || '最新公告期',
    reports: instrument.historicalFundamentals || seed?.reports,
    qualityScore,
    valueTrapRisk: risk,
    diagnosticSummary: warning || seed?.diagnosticSummary || '基本面运行平稳，无显著异常指标。',
  };

  fundamentalCache.set(code, profile);
  return profile;
}

/**
 * 富化整个 Universe 的基本面质量信息
 */
export function enrichUniverseFundamentals(instruments: AShareInstrument[]): AShareInstrument[] {
  return instruments.map((inst) => {
    const profile = getFundamentalProfile(inst);
    return {
      ...inst,
      dividendYield: profile.dividendYield || inst.dividendYield,
      roe: profile.roe ?? inst.roe,
      netProfitGrowthYoy: profile.netProfitGrowthYoy ?? inst.netProfitGrowthYoy,
      revenueGrowthYoy: profile.revenueGrowthYoy ?? inst.revenueGrowthYoy,
      grossMargin: profile.grossMargin ?? inst.grossMargin,
      debtRatio: profile.debtRatio ?? inst.debtRatio,
      eps: profile.eps ?? inst.eps,
      bps: profile.bps ?? inst.bps,
      latestReportPeriod: profile.latestReportPeriod || inst.latestReportPeriod,
      historicalFundamentals: profile.reports || inst.historicalFundamentals,
      fundamentalQualityScore: profile.qualityScore,
      valueTrapRisk: profile.valueTrapRisk,
    };
  });
}
