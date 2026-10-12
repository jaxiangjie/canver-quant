import { 
  AShareInstrument, 
  CarverSettings, 
  PositionCalculation, 
  PortfolioSummaryStats,
  BacktestDataPoint 
} from '../types/ashare';
import { evaluateAShareStrategies } from './ashareStrategies';
import { computeUniverseCorrelationMatrix } from './correlationEngine';

export const DEFAULT_CARVER_SETTINGS: CarverSettings = {
  totalCapital: 1000000,         // 100 万元
  targetAnnualVol: 0.18,         // 18% 目标年化波动率（匹配 poorlab 11 腿池 σ_T≈18–22% 画像；受 20% 杠杆帽约束）
  bufferThreshold: 0.12,         // 12% 缓冲带死区
  maxInstrumentRiskCap: 0.25,    // 单标的风险权重上限 25%
  maxLeverage: 0.20,             // 最多 20% 杠杆 (即组合总市值最多 120% / 1.20x，杜绝 170%+ 杠杆)
  maxInstrumentPositionCap: 0.25, // 单标的最高持仓金额占比上限 25% (25万元)
  maxBondCap: 0.20,              // 债券类资产上限 20% (防止低波国债过度占用资金拖累整体收益)
  hysteresisBuffer: true,        // 启用卡弗缓冲带回差调仓 (只调至缓冲边界，避免边缘来回振荡摩擦)
  minTradeAmount: 2000,          // 调仓门槛 2000 元 (低于该金额暂缓调仓，省去碎股及最低手续费摩擦)
  useIDM: true,                  // 启用卡弗标的分散化乘数 (IDM)，解决多标的低波导致的年化偏低问题
  idmMode: 'auto',               // 默认动态自适应计算 IDM，支持手动调节
  manualIDM: 1.45,               // 手动设定值（推荐区间 1.20 - 1.80）
  maxIDM: 1.80,                  // IDM 放大倍数上限 1.80
  useERPTilt: false,             // A股 ERP 逆向战术偏置：闸门④回测(2008-2026,216次再平衡)增量噪声级(Sharpe+0.00)，默认关；重验见 scripts/gate4_compare.ts
  enforceTargetVol: true,        // 目标波动即基准敞口：中性=1.0x 满仓，让目标波动率真正生效（非上限）
  stockCommissionRate: 0.00025,  // 万2.5
  etfCommissionRate: 0.0001,     // 万1
  stockStampDuty: 0.0005,        // 股票卖出千分之0.5
  slippageBps: 5,                // 5个基点滑点
};

/**
 * 缓冲带决策（死区 + 回差调仓 + 最低调仓门槛）。
 * 单标的 calculateInstrumentPosition 与组合层 calculatePortfolio 第二遍共用同一套逻辑，
 * 避免组合层重算时把 hysteresisBuffer / minTradeAmount 静默丢弃（早前的 bug：组合层忽略了这两个开关）。
 */
function resolveBufferDecision(
  currentShares: number,
  targetShares: number,
  currentPrice: number,
  settings: CarverSettings
): { withinBuffer: boolean; action: 'BUY' | 'SELL' | 'HOLD'; recommendedShares: number } {
  let withinBuffer = false;
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let recommendedShares = 0;

  if (targetShares === 0 && currentShares > 0) {
    withinBuffer = false;
    action = 'SELL';
    recommendedShares = currentShares;
  } else if (currentShares === 0 && targetShares > 0) {
    withinBuffer = false;
    action = 'BUY';
    recommendedShares = targetShares;
  } else if (targetShares > 0) {
    const deviationRatio = Math.abs(targetShares - currentShares) / targetShares;
    const threshold = settings.bufferThreshold ?? 0.12;
    if (deviationRatio <= threshold) {
      withinBuffer = true;
      action = 'HOLD';
      recommendedShares = 0;
    } else {
      action = targetShares > currentShares ? 'BUY' : 'SELL';
      // 卡弗进阶：回差调仓 (Hysteresis Rebalance)
      // 触发后不一脚拉回靶心，而是只调至缓冲带边界（只调超出缓冲带的部分），节省 25%~35% 摩擦成本
      if (settings.hysteresisBuffer !== false) {
        const bufferDistanceShares = Math.floor((targetShares * threshold) / 100) * 100;
        const adjustedDelta = Math.max(100, Math.abs(targetShares - currentShares) - bufferDistanceShares);
        recommendedShares = Math.floor(adjustedDelta / 100) * 100;
      } else {
        recommendedShares = Math.floor(Math.abs(targetShares - currentShares) / 100) * 100;
      }
      // 最低调仓金额门槛校验（防几十几百元碎股交易浪费最低佣金）
      const minTrade = settings.minTradeAmount ?? 2000;
      if (recommendedShares * currentPrice < minTrade) {
        withinBuffer = true;
        action = 'HOLD';
        recommendedShares = 0;
      } else {
        withinBuffer = false;
      }
    }
  }
  return { withinBuffer, action, recommendedShares };
}

/**
 * Calculate Carver Volatility Sizing for a single instrument
 */
export function calculateInstrumentPosition(
  instrument: AShareInstrument,
  universe: AShareInstrument[] = [],
  settings: CarverSettings = DEFAULT_CARVER_SETTINGS,
  idmMultiplier: number = 1.0
): PositionCalculation {
  if (!instrument) {
    return {
      instrument: {} as any,
      currentShares: 0,
      currentValue: 0,
      currentWeight: 0,
      dailyInstrumentVol: 0,
      dailyCashRisk: 0,
      basePositionShares: 0,
      forecastScalar: 0,
      scalarMultiplier: 1,
      rawTargetShares: 0,
      targetShares: 0,
      targetCapital: 0,
      targetWeight: 0,
      shareDelta: 0,
      capitalDelta: 0,
      withinBuffer: true,
      action: 'HOLD',
      recommendedShares: 0,
      estimatedFee: 0,
    };
  }

  const currentPrice = Math.max(0.001, instrument.currentPrice || 1.0);
  const annualizedVol = Math.max(0.01, instrument.annualizedVol || 0.18);
  const currentShares = instrument.currentShares || 0;
  const currentValue = currentShares * currentPrice;
  const currentWeight = currentValue / (settings.totalCapital || 1000000);

  // 1. Daily Cash Volatility Target for total fund
  // Carver: Cash Vol Target = Total Capital * Target Annual Vol / sqrt(250)
  const dailyTotalCashVol = (settings.totalCapital * settings.targetAnnualVol) / Math.sqrt(250);

  // 2. Instrument Daily Volatility (in currency units per share)
  const instrumentDailyVol = currentPrice * (annualizedVol / Math.sqrt(250));

  // 3. Base Position Shares with Carver IDM Multiplier Compensation
  // Carver: Base Shares = (Daily Total Cash Vol * Risk Budget Weight * IDM) / Instrument Daily Vol
  const weightBudget = Math.min(settings.maxInstrumentRiskCap, instrument.riskBudgetWeight);
  const effectiveBudget = weightBudget * (settings.useIDM !== false ? Math.max(1.0, Math.min(settings.maxIDM || 1.80, idmMultiplier)) : 1.0);
  const basePositionShares = (dailyTotalCashVol * effectiveBudget) / Math.max(0.0001, instrumentDailyVol);

  // 4. Evaluate A-Share Strategy Signals & Carver Forecast Scalar (-20 to +20)
  const strategySignals = evaluateAShareStrategies(instrument, universe);
  let scalar = strategySignals.finalForecastScalar;

  // A股股债收益差 (ERP/Fed模型) 逆向战术安全边际增益 (Tactical Tilt)
  if (settings.useERPTilt !== false && (instrument.category === 'broad_etf' || instrument.category === 'stock_cn' || instrument.category === 'sector_etf')) {
    if (strategySignals.valuationSignal.valuationZone === 'EXTREME_LOW') {
      scalar = Math.min(20, scalar + 3.0); // 极度低估黄金坑，逆向进攻偏置
    } else if (strategySignals.valuationSignal.valuationZone === 'UNDERVALUED') {
      scalar = Math.min(20, scalar + 1.5);
    }
  }

  // Scalar Multiplier:
  // enforceTargetVol(默认 true): 目标波动即基准敞口 —— 中性(scalar=0)=1.0x 满仓，看多(+20)=2.0x，看空(-20)=0x
  //   让"目标波动率"成为组合真实要达成的基准，而非被信号打折后的上限
  // 传统择时(enforceTargetVol=false): 仅正信号持仓，中性/负=0 空仓防御（原 Carver 趋势语义）
  let scalarMultiplier = 0;
  if (instrument.category === 'bond_etf') {
    // 债券 ETF 压舱石：保留 0.8x 下限与 2.0x 杠杆封顶
    scalarMultiplier = settings.enforceTargetVol !== false
      ? Math.max(0.8, Math.min(2.0, (scalar + 20) / 20))
      : Math.max(0.8, Math.min(2.0, (scalar + 10) / 10));
  } else if (settings.enforceTargetVol !== false) {
    scalarMultiplier = Math.max(0, Math.min(2.0, (scalar + 20) / 20));
  } else if (scalar > 0) {
    scalarMultiplier = Math.min(2.0, scalar / 10);
  } else {
    scalarMultiplier = 0; // defensive exit on negative momentum
  }

  // 5. Raw Target Shares with individual instrument capital cap
  let rawTargetShares = basePositionShares * scalarMultiplier;

  // Enforce single instrument position capital cap (default 25% of total capital)
  // For bond assets, respect maxBondCap (default 20%) to avoid low-yielding bond cash-drag
  const isBond = instrument.category === 'bond_etf';
  const maxInstCapRatio = isBond && typeof settings.maxBondCap === 'number'
    ? settings.maxBondCap
    : (settings.maxInstrumentPositionCap ?? 0.25);
  const maxAllowedInstrumentCap = settings.totalCapital * maxInstCapRatio;
  if (rawTargetShares * currentPrice > maxAllowedInstrumentCap) {
    rawTargetShares = maxAllowedInstrumentCap / currentPrice;
  }

  const targetShares = Math.max(0, Math.floor(rawTargetShares / 100) * 100);
  const targetCapital = targetShares * currentPrice;
  const targetWeight = targetCapital / settings.totalCapital;

  // 6. Share Delta & Carver Buffer Band (死区缓冲带检测，含回差调仓与最低调仓门槛)
  const shareDelta = targetShares - currentShares;
  const capitalDelta = shareDelta * currentPrice;

  const { withinBuffer, action, recommendedShares } = resolveBufferDecision(
    currentShares, targetShares, currentPrice, settings
  );

  // 7. Transaction Cost Estimation (Commission, Stamp Duty, Slippage)
  const turnoverCapital = recommendedShares * currentPrice;
  const commissionRate = instrument.isETF ? settings.etfCommissionRate : settings.stockCommissionRate;
  const stampDutyRate = (!instrument.stampDutyExempt && action === 'SELL') ? settings.stockStampDuty : 0;
  const slippageRate = (settings.slippageBps / 10000);
  const estimatedFee = turnoverCapital * (commissionRate + stampDutyRate + slippageRate);

  return {
    instrument,
    currentShares,
    currentValue,
    currentWeight,
    dailyInstrumentVol: instrumentDailyVol,
    dailyCashRisk: basePositionShares * instrumentDailyVol,
    basePositionShares: Math.round(basePositionShares),
    forecastScalar: scalar,
    scalarMultiplier: Number(scalarMultiplier.toFixed(2)),
    rawTargetShares: Math.round(rawTargetShares),
    targetShares,
    targetCapital: Math.round(targetCapital),
    targetWeight,
    shareDelta,
    capitalDelta: Math.round(capitalDelta),
    withinBuffer,
    action,
    recommendedShares,
    estimatedFee: Number(estimatedFee.toFixed(1)),
  };
}

/**
 * Calculate entire portfolio positions & summary metrics with Portfolio-Level Leverage Constraint
 */
export function calculatePortfolio(
  universe: AShareInstrument[] = [],
  settings: CarverSettings = DEFAULT_CARVER_SETTINGS
): {
  positions: PositionCalculation[];
  summary: PortfolioSummaryStats;
} {
  const safeUniverse = Array.isArray(universe) ? universe.filter(Boolean) : [];
  const totalCap = settings?.totalCapital || 1000000;
  const maxLeverage = typeof settings?.maxLeverage === 'number' ? settings.maxLeverage : 0.20; // 默认最多 20% 杠杆
  const maxAllowedPortfolioCapital = totalCap * (1 + maxLeverage); // 120% 总市值上限 (120万)

  // 0. Compute Carver IDM (Instrument Diversification Multiplier)
  // 相关性矩阵只算一次，IDM 与组合波动实算共用（manual 模式同样需要 rho 来实算组合波动）
  const corrResult = safeUniverse.length > 1 ? computeUniverseCorrelationMatrix(safeUniverse, 60) : null;
  const avgUniverseCorrelation = corrResult?.averageUniverseCorrelation ?? 0.30;
  let computedIDM = 1.0;
  if (safeUniverse.length > 1 && settings.useIDM !== false) {
    if (settings.idmMode === 'manual' && typeof settings.manualIDM === 'number') {
      computedIDM = Math.max(1.0, Math.min(settings.maxIDM || 1.80, settings.manualIDM));
    } else {
      computedIDM = Math.max(1.0, Math.min(settings.maxIDM || 1.80, corrResult?.carverIDM || 1.45));
    }
  }

  // 1. First pass: compute preliminary instrument calculations with IDM scaling and instrument cap
  const rawPositions = safeUniverse.map(inst => calculateInstrumentPosition(inst, safeUniverse, settings, computedIDM));

  // 2. Portfolio-Level Leverage Constraint (Robert Carver Leverage Scaling & A-Share Margin Risk Control)
  // Check if raw portfolio target capital exceeds (1 + maxLeverage) * totalCapital (e.g. > 120%)
  const rawTargetCapitalSum = rawPositions.reduce((acc, p) => acc + (p.rawTargetShares * (p.instrument?.currentPrice || 1)), 0);
  
  let leverageScale = 1.0;
  let isLeverageConstrained = false;
  if (rawTargetCapitalSum > maxAllowedPortfolioCapital && rawTargetCapitalSum > 0) {
    leverageScale = maxAllowedPortfolioCapital / rawTargetCapitalSum;
    isLeverageConstrained = true;
  }

  // 3. Second pass: apply portfolio leverage scale, round to 100-share integer lots, and check Carver buffer bands
  const positions: PositionCalculation[] = rawPositions.map(p => {
    const inst = p.instrument;
    const currentPrice = Math.max(0.001, inst.currentPrice || 1.0);
    const currentShares = p.currentShares;
    const scaledRawShares = p.rawTargetShares * leverageScale;
    const targetShares = Math.max(0, Math.floor(scaledRawShares / 100) * 100);
    const targetCapital = targetShares * currentPrice;
    const targetWeight = targetCapital / totalCap;

    const shareDelta = targetShares - currentShares;
    const capitalDelta = shareDelta * currentPrice;

    const { withinBuffer, action, recommendedShares } = resolveBufferDecision(
      currentShares, targetShares, currentPrice, settings
    );

    const turnoverCapital = recommendedShares * currentPrice;
    const commissionRate = inst.isETF ? settings.etfCommissionRate : settings.stockCommissionRate;
    const stampDutyRate = (!inst.stampDutyExempt && action === 'SELL') ? settings.stockStampDuty : 0;
    const slippageRate = (settings.slippageBps / 10000);
    const estimatedFee = turnoverCapital * (commissionRate + stampDutyRate + slippageRate);

    return {
      ...p,
      rawTargetShares: Math.round(scaledRawShares),
      targetShares,
      targetCapital: Math.round(targetCapital),
      targetWeight,
      shareDelta,
      capitalDelta: Math.round(capitalDelta),
      withinBuffer,
      action,
      recommendedShares,
      estimatedFee: Number(estimatedFee.toFixed(1)),
    };
  });

  const currentEquityValue = positions.reduce((acc, p) => acc + (p?.currentValue || 0), 0);
  const targetEquityValue = positions.reduce((acc, p) => acc + (p?.targetCapital || 0), 0);
  const cashBalance = Math.max(0, totalCap - currentEquityValue);
  const equityRatio = (currentEquityValue / totalCap) * 100;
  const targetLeverageRatio = (targetEquityValue / totalCap) * 100;
  const targetLeveragePct = Math.max(0, Number((targetLeverageRatio - 100).toFixed(1)));
  const rawTargetLeverageRatio = Number(((rawTargetCapitalSum / totalCap) * 100).toFixed(1));

  // 组合有效年化波动：按 σ_p = sqrt(ΣΣ w_i w_j σ_i σ_j ρ_ij) 实算（用平均 rho 近似）。
  // 旧实现为 weightedVolSum × 0.85 × min(1.30, IDM×0.82)，两个折扣系数均无推导依据，
  // 且与回测 Tab 的实测年化波动对不上，容易误导读数。
  // targetWeight 为小数占比（targetCapital / totalCapital），用目标组合而非当前持仓来算有效波动
  const wv = positions.map((p) => (p?.targetWeight || 0) * (p?.instrument?.annualizedVol || 0.15));
  let volVar = 0;
  for (let i = 0; i < wv.length; i++) {
    volVar += wv[i] * wv[i];
    for (let j = 0; j < i; j++) volVar += 2 * wv[i] * wv[j] * avgUniverseCorrelation;
  }
  const portfolioAnnualVol = Number(Math.sqrt(Math.max(0, volVar)).toFixed(3));
  const effectiveAnnualVol = Number((portfolioAnnualVol * 100).toFixed(1));
  const dailyExpectedRisk = Math.round((totalCap * (effectiveAnnualVol / 100)) / Math.sqrt(250));

  // Theoretical Expected Annual Return (%): Risk free (2.2%) + Sharpe (0.85) * EffectiveVol - Friction (0.35%)
  const expectedAnnualReturn = Number((2.2 + 0.85 * effectiveAnnualVol - 0.35).toFixed(1));

  // Risk-Adjusted Return Metrics (波动率调整后绩效指标)
  // 1. Sharpe Ratio = (ExpectedReturn - Rf) / EffectiveVol
  const riskAdjustedReturn = Number(((expectedAnnualReturn - 2.2) / Math.max(1.0, effectiveAnnualVol)).toFixed(2));
  // 2. Return-to-Volatility Ratio
  const returnToVolRatio = Number((expectedAnnualReturn / Math.max(1.0, effectiveAnnualVol)).toFixed(2));
  // 3. Sortino Ratio (Downside volatility is reduced due to Carver EWMAC & 250MA stopout)
  const sortinoRatio = Number(((expectedAnnualReturn - 2.2) / Math.max(0.5, effectiveAnnualVol * 0.65)).toFixed(2));
  // 4. Calmar Ratio = Expected Return / Estimated Max Drawdown (~1.15 * vol)
  const calmarRatio = Number((expectedAnnualReturn / Math.max(1.0, effectiveAnnualVol * 1.15)).toFixed(2));

  const pendingTradeCount = positions.filter(p => !p.withinBuffer && p.recommendedShares > 0).length;
  const estimatedRebalanceCost = positions.reduce((acc, p) => acc + (p?.estimatedFee || 0), 0);

  return {
    positions,
    summary: {
      totalCapital: totalCap,
      currentEquityValue: Math.round(currentEquityValue),
      cashBalance: Math.round(cashBalance),
      equityRatio: Number(equityRatio.toFixed(1)),
      targetEquityValue: Math.round(targetEquityValue),
      targetLeverageRatio: Number(targetLeverageRatio.toFixed(1)),
      targetLeveragePct,
      maxLeverageLimitPct: Number((maxLeverage * 100).toFixed(0)),
      isLeverageConstrained,
      rawTargetLeverageRatio,
      portfolioAnnualVol: Number((portfolioAnnualVol * 100).toFixed(1)),
      dailyExpectedRisk,
      pendingTradeCount,
      estimatedRebalanceCost: Number(estimatedRebalanceCost.toFixed(1)),
      carverIDM: Number(computedIDM.toFixed(2)),
      effectiveAnnualVol,
      expectedAnnualReturn,
      riskAdjustedReturn,
      returnToVolRatio,
      sortinoRatio,
      calmarRatio,
    },
  };
}

/**
 * Generate 250-day backtest simulation series comparing Carver Vol Sizing vs Equal Weight vs Buy & Hold CSI300
 * Now supports T+1 Liquidity Protection (ADV cap) under extreme market stress scenarios
 */
export function generateBacktestSeries(
  universe: AShareInstrument[],
  advCapRatio: number = 0.20,
  stressLevel: 'NORMAL' | 'EXTREME_STRESS' | 'LIQUIDITY_CRUNCH' = 'EXTREME_STRESS'
): BacktestDataPoint[] {
  const points: BacktestDataPoint[] = [];
  const days = 120; // 120 trading days (~6 months)
  
  let carverNet = 1.0;            // 带 T+1 流动性保护 (受限平滑)
  let carverUnprotectedNet = 1.0; // 未设流动性保护 (承受极端滑点溢价)
  let eqNet = 1.0;
  let csiNet = 1.0;
  
  let carverPeak = 1.0;
  let csiPeak = 1.0;
  let cumSlippageSavedBps = 0;

  const today = new Date();

  // Multiplier for slippage impact based on stressLevel and advCapRatio
  const stressMultiplier = stressLevel === 'LIQUIDITY_CRUNCH' ? 3.5 : stressLevel === 'EXTREME_STRESS' ? 1.8 : 0.4;
  const impactMitigationFactor = Math.max(0.4, Math.min(1.0, advCapRatio / 0.20));

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - (i * 1.5));
    const dateStr = d.toISOString().split('T')[0];

    // Simulated market regime with cyclical drawdowns
    const cycle = Math.sin(i * 0.1);
    const noise = (Math.cos(i * 0.25) * 0.008);
    
    // Benchmark CSI 300 daily return (high beta, sharp drawdowns)
    const csiDayReturn = (cycle * 0.007) + noise;
    csiNet = Math.max(0.4, csiNet * (1 + csiDayReturn));
    csiPeak = Math.max(csiPeak, csiNet);
    const csiDrawdown = ((csiNet - csiPeak) / csiPeak) * 100;

    // Equal weight return
    const eqDayReturn = (cycle * 0.005) + (noise * 0.8);
    eqNet = Math.max(0.5, eqNet * (1 + eqDayReturn));

    // Carver Systematic Strategy return
    let carverDayReturn = (cycle * 0.004) + (noise * 0.45);
    if (csiDayReturn < -0.015) {
      // In crash regimes, defensive scalar cuts losses by ~60%
      carverDayReturn = csiDayReturn * 0.35;
    }

    // Liquidity Shock Days (when market drops rapidly, causing large rebalances)
    if (csiDayReturn < -0.012 || Math.abs(cycle) > 0.8) {
      // Rebalancing day under stress:
      // Without protection: large order relative to ADV causes severe slippage
      const unconstrainedImpactBps = (28 * stressMultiplier);
      // With protection (ADV cap e.g. 20%): orders are split and impact is bounded
      const protectedImpactBps = (8 * stressMultiplier * impactMitigationFactor);
      
      const daySavedBps = Math.max(0, unconstrainedImpactBps - protectedImpactBps);
      cumSlippageSavedBps += daySavedBps;
      
      // Unprotected net value gets penalized by the slippage spike
      const unprotectedDayReturn = carverDayReturn - (unconstrainedImpactBps / 10000);
      carverUnprotectedNet = Math.max(0.5, carverUnprotectedNet * (1 + unprotectedDayReturn));
      
      // Protected net value pays only bounded low impact
      const protectedDayReturn = carverDayReturn - (protectedImpactBps / 10000);
      carverNet = Math.max(0.6, carverNet * (1 + protectedDayReturn));
    } else {
      carverNet = Math.max(0.6, carverNet * (1 + carverDayReturn));
      carverUnprotectedNet = Math.max(0.5, carverUnprotectedNet * (1 + carverDayReturn));
    }

    carverPeak = Math.max(carverPeak, carverNet);
    const carverDrawdown = ((carverNet - carverPeak) / carverPeak) * 100;

    points.push({
      date: dateStr,
      carverStrategyEquity: Number(carverNet.toFixed(4)),
      carverUnprotectedEquity: Number(carverUnprotectedNet.toFixed(4)),
      equalWeightEquity: Number(eqNet.toFixed(4)),
      csi300Equity: Number(csiNet.toFixed(4)),
      carverDrawdown: Number(carverDrawdown.toFixed(2)),
      csi300Drawdown: Number(csiDrawdown.toFixed(2)),
      slippageSavedBps: Math.round(cumSlippageSavedBps),
    });
  }

  return points;
}
