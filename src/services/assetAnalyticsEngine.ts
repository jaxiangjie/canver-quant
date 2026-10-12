import { 
  AShareInstrument, 
  CarverSettings, 
  PositionCalculation, 
  InstrumentAnalyticsItem, 
  ValueMomentumQuadrant 
} from '../types/ashare';
import { evaluateAShareStrategies } from './ashareStrategies';
import { getFundamentalProfile } from './fundamentalService';

/**
 * 10-Year China Government Bond Yield (Risk-Free Benchmark for Fed Model ERP)
 * 当前中国10年期国债收益率中枢约为 2.30%
 */
export const CHINA_10Y_BOND_YIELD = 2.30;

/**
 * Calculate deep multi-dimensional analytics for an instrument,
 * seamlessly uniting:
 * 1. Graham / Marks / Swensen Value & Cycle Margin of Safety (PE/PB Percentiles, Dividend, ERP)
 * 2. Robert Carver / Andreas Clenow Systematic Volatility & Trend Risk Engine (Vol Percentile, EWMAC, Buffer, Caps)
 */
export function computeInstrumentAnalytics(
  instrument: AShareInstrument,
  position: PositionCalculation | undefined,
  settings: CarverSettings,
  universe: AShareInstrument[]
): InstrumentAnalyticsItem {
  const profile = getFundamentalProfile(instrument);
  const isCommodityOrBond = instrument.category === 'bond_etf' || instrument.category === 'commodity_etf';
  const peTTM = instrument.peTTM ?? 0;
  const pb = instrument.pb ?? 0;
  const pePercentile = instrument.pePercentile ?? 50;
  const pbPercentile = instrument.pbPercentile ?? 50;
  const dividendYield = instrument.dividendYield || profile.dividendYield || 0;

  // 1. 估值综合百分位
  const compositeValuationPercentile = isCommodityOrBond 
    ? 50 
    : Math.round(pePercentile * 0.55 + pbPercentile * 0.45);

  // 2. 股债风险溢价 (ERP / Fed Model: 1/PE - 10Y国债收益率)
  // 当 PE > 0 时，Earnings Yield (E/P) = (1 / PE) * 100%
  let equityRiskPremium = 0;
  if (!isCommodityOrBond && peTTM > 0) {
    const earningsYield = (1 / peTTM) * 100;
    equityRiskPremium = Number((earningsYield - CHINA_10Y_BOND_YIELD).toFixed(2));
  } else if (instrument.category === 'bond_etf') {
    equityRiskPremium = 0; // 纯债基准
  } else if (instrument.category === 'commodity_etf') {
    equityRiskPremium = 0.5; // 大宗抗通胀溢价
  }

  // 3. 价值安全边际得分 (0 - 100)
  // 越低估（分位越低）、ERP越高、股息率越高，价值安全边际分越高
  let valueScore = 50;
  if (!isCommodityOrBond) {
    const valuationInversion = 100 - compositeValuationPercentile; // 估值分位越低，得分越高
    const erpBonus = Math.max(0, Math.min(25, (equityRiskPremium - 2.0) * 5));
    const divBonus = Math.max(0, Math.min(20, dividendYield * 3.5));
    valueScore = Math.round(Math.max(10, Math.min(98, valuationInversion * 0.6 + erpBonus + divBonus)));
  } else if (instrument.category === 'bond_etf') {
    valueScore = 65; // 国债固收防御底色
  } else if (instrument.category === 'commodity_etf') {
    valueScore = 55; // 黄金大宗避险中性
  }

  // 4. 波动率与系统化动量策略
  const signals = evaluateAShareStrategies(instrument, universe);
  const carverForecastScalar = signals.finalForecastScalar; // -20 到 +20
  const aboveMA250 = signals.absoluteMomentumPass;

  // 波动率历史分位 (相对于A股正常波动分布 10%~35%)
  // 年化波动越适中或较低，风控得分越高；高波则需要缩减头寸
  const annualizedVol = instrument.annualizedVol;
  let volatilityPercentile = 50;
  if (annualizedVol < 0.05) volatilityPercentile = 10;
  else if (annualizedVol < 0.12) volatilityPercentile = 25;
  else if (annualizedVol < 0.18) volatilityPercentile = 45;
  else if (annualizedVol < 0.24) volatilityPercentile = 65;
  else if (annualizedVol < 0.30) volatilityPercentile = 82;
  else volatilityPercentile = 95;

  // 5. 动量与系统化风控得分 (0 - 100)
  // 卡弗标量 (-20~+20 映射到 0~100) + 年线动量过滤 + 波动率稳定性
  const scalarScore = ((carverForecastScalar + 20) / 40) * 60; // 0~60分
  const maScore = aboveMA250 ? 25 : 5;                        // 年线上方奖励25分
  const volStabilityScore = (100 - volatilityPercentile) * 0.15; // 0~15分
  const momentumRiskScore = Math.round(Math.max(10, Math.min(98, scalarScore + maScore + volStabilityScore)));

  // 6. 价值与动量双轮四象限分类
  let quadrant: ValueMomentumQuadrant = 'GOLDEN_RESONANCE';
  let quadrantLabel = '双优黄金共振区';
  let quadrantColor = 'emerald';
  let quadrantAdvice = '估值处于极佳安全边际，叠加卡弗动量正向共振。建议维持全额风险预算，顺势加码。';

  if (valueScore >= 50 && momentumRiskScore >= 50) {
    quadrant = 'GOLDEN_RESONANCE';
    quadrantLabel = '双优黄金共振区 (低估+强动量)';
    quadrantColor = 'emerald';
    quadrantAdvice = '估值具备高安全边际，动量突破年线上行，戴维斯双击潜在区间。优先配置！';
  } else if (valueScore >= 50 && momentumRiskScore < 50) {
    quadrant = 'VALUE_DEFENSIVE';
    quadrantLabel = '左侧价值潜伏区 (低估+弱动量)';
    quadrantColor = 'cyan';
    quadrantAdvice = '估值低廉具备长期均值回归优势，但短期技术面震荡筑底。由卡弗模型限制仓位分批建仓，防止价值陷阱。';
  } else if (valueScore < 50 && momentumRiskScore >= 50) {
    quadrant = 'TREND_MOMENTUM';
    quadrantLabel = '动量趋势博弈区 (偏贵+强动量)';
    quadrantColor = 'amber';
    quadrantAdvice = '行情动量强劲但估值偏高、安全边际收窄。顺应卡弗趋势持有，但必须施加仓位折价并严格监控死区止盈。';
  } else {
    quadrant = 'AVOID_RISK';
    quadrantLabel = '双杀防守规避区 (偏贵+弱动量)';
    quadrantColor = 'rose';
    quadrantAdvice = '估值偏贵且破位下行，风险收益比极差。卡弗模型建议收紧仓位甚至清空，防范戴维斯双杀。';
  }

  // 7. 仓位数据与差异原因归因分析
  const currentShares = instrument.currentShares;
  const currentValue = Number((currentShares * instrument.currentPrice).toFixed(2));
  const currentWeight = Number(((currentValue / settings.totalCapital) * 100).toFixed(2));

  const targetShares = position?.targetShares ?? currentShares;
  const targetValue = position?.targetCapital ?? currentValue;
  const targetWeight = Number(((targetValue / settings.totalCapital) * 100).toFixed(2));
  const withinBuffer = position?.withinBuffer ?? true;
  const action = position?.action ?? 'HOLD';
  const recommendedShares = position?.recommendedShares ?? 0;

  // 深入剖析实际仓位与目标仓位不同的原因
  let reasonForDifference = '持仓与模型目标吻合良好，当前偏差在可容忍范围内。';
  const shareDiff = targetShares - currentShares;

  if (shareDiff === 0) {
    reasonForDifference = '实际股数与卡弗模型理论目标完全一致 (已精确取整至100股整手)。';
  } else if (withinBuffer) {
    reasonForDifference = `卡弗调仓死区缓冲保护中：目标股数与现仓相差 ${Math.abs(shareDiff)} 股，但偏离度未超出 ${Math.round(settings.bufferThreshold * 100)}% 缓冲阈值。为节省印花税与滑点，模型决策“按兵不动”。`;
  } else {
    if (action === 'BUY') {
      reasonForDifference = `触发调仓死区突破：近期资产价格波动或标量上行，使目标股数超出死区上界。系统建议买入 ${recommendedShares / 100} 手 (${recommendedShares} 股) 以拉齐风险暴露。`;
    } else if (action === 'SELL') {
      reasonForDifference = `触发调仓死区突破：近期波动率抬升或标量下移，使实际持仓超出死区下界。系统建议卖出 ${recommendedShares / 100} 手 (${recommendedShares} 股) 以锁定利润或控制下行风险。`;
    }
  }

  return {
    instrument,
    peTTM,
    pb,
    pePercentile,
    pbPercentile,
    compositeValuationPercentile,
    equityRiskPremium,
    dividendYield,
    valueScore,
    annualizedVol,
    volatilityPercentile,
    carverForecastScalar,
    aboveMA250,
    momentumRiskScore,
    quadrant,
    quadrantLabel,
    quadrantColor,
    quadrantAdvice,
    currentShares,
    currentValue,
    currentWeight,
    targetShares,
    targetValue,
    targetWeight,
    action,
    recommendedShares,
    withinBuffer,
    reasonForDifference,
    // 基本面深度健康度与价值陷阱诊断
    roe: profile.roe,
    netProfitGrowthYoy: profile.netProfitGrowthYoy,
    revenueGrowthYoy: profile.revenueGrowthYoy,
    grossMargin: profile.grossMargin,
    debtRatio: profile.debtRatio,
    latestReportPeriod: profile.latestReportPeriod,
    fundamentalQualityScore: profile.qualityScore,
    valueTrapRisk: profile.valueTrapRisk,
    valueTrapWarning: profile.diagnosticSummary,
    historicalFundamentals: profile.reports,
  };
}

/**
 * Compute batch analytics for all universe instruments
 */
export function computeUniverseAnalytics(
  universe: AShareInstrument[],
  positions: PositionCalculation[],
  settings: CarverSettings
): InstrumentAnalyticsItem[] {
  return universe.map(inst => {
    const pos = positions.find(p => p.instrument.id === inst.id);
    return computeInstrumentAnalytics(inst, pos, settings, universe);
  });
}
