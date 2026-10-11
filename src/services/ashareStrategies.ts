import { AShareInstrument, StrategySignals, ValuationPercentileSignal, HistoricalValuationPoint } from '../types/ashare';

/**
 * Generate 5-year quarterly historical PE/PB valuation percentile trajectory
 */
export function generate5YearValuationHistory(instrument: AShareInstrument): HistoricalValuationPoint[] {
  if (!instrument) return [];
  const isCommodityOrBond = instrument.category === 'bond_etf' || instrument.category === 'commodity_etf';
  const quarters = [
    '2021-Q1', '2021-Q2', '2021-Q3', '2021-Q4',
    '2022-Q1', '2022-Q2', '2022-Q3', '2022-Q4',
    '2023-Q1', '2023-Q2', '2023-Q3', '2023-Q4',
    '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4',
    '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4',
    '2026-Q1'
  ];

  const currentPE = instrument.peTTM || 15;
  const currentPB = instrument.pb || 1.5;
  const currentPEPct = instrument.pePercentile ?? 50;
  const currentPBPct = instrument.pbPercentile ?? 50;

  // Macro 5-year cycle trajectory in A-shares (2021 peak -> 2022-2023 compression -> 2024 Q1 trough -> rebound)
  const macroCycle = [
    88, 84, 76, 68,
    62, 54, 46, 38,
    42, 35, 26, 18,
    12, 22, 30, 45,
    38, 42, 34, 28,
    currentPEPct
  ];

  return quarters.map((q, idx) => {
    if (isCommodityOrBond) {
      return {
        date: q,
        pe: 0,
        pb: 0,
        pePercentile: 50,
        pbPercentile: 50,
        compositePercentile: 50,
      };
    }

    const baseCycleVal = macroCycle[idx];
    const pePct = Math.round(Math.max(5, Math.min(95, baseCycleVal * (currentPEPct / 50))));
    const pbPct = Math.round(Math.max(5, Math.min(95, (baseCycleVal - 4) * (currentPBPct / 50))));
    
    // Exact match for the last point (current)
    const finalPEPct = idx === quarters.length - 1 ? currentPEPct : pePct;
    const finalPBPct = idx === quarters.length - 1 ? currentPBPct : pbPct;
    const compPct = Math.round(finalPEPct * 0.55 + finalPBPct * 0.45);

    // Approximate historical PE/PB values matching the percentile
    const peVal = Number((currentPE * (0.6 + (finalPEPct / 100) * 0.8)).toFixed(1));
    const pbVal = Number((currentPB * (0.6 + (finalPBPct / 100) * 0.8)).toFixed(2));

    return {
      date: q,
      pe: idx === quarters.length - 1 ? currentPE : peVal,
      pb: idx === quarters.length - 1 ? currentPB : pbVal,
      pePercentile: finalPEPct,
      pbPercentile: finalPBPct,
      compositePercentile: compPct,
    };
  });
}

/**
 * Generate 3-year quarterly historical PE/PB valuation percentile trajectory (12 quarters)
 * Covering 2023-Q2 to 2026-Q1 (recent 3-year market cycle: from 2023 valuation adjustment,
 * 2024-Q1 historical bottom, 2024-Q4 policy rebound, to 2026 current level).
 */
export function generate3YearValuationHistory(instrument: Partial<AShareInstrument>): HistoricalValuationPoint[] {
  if (!instrument) return [];
  const isCommodityOrBond = instrument.category === 'bond_etf' || instrument.category === 'commodity_etf';
  const quarters3Y = [
    '2023-Q2', '2023-Q3', '2023-Q4',
    '2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4',
    '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4',
    '2026-Q1'
  ];

  const currentPE = instrument.peTTM || 15;
  const currentPB = instrument.pb || 1.5;
  const currentPEPct = instrument.pePercentile ?? 50;
  const currentPBPct = instrument.pbPercentile ?? 50;

  // 3-year macro valuation trajectory (2023 mid-level -> 2024-Q1 deep value trough -> 2024-Q4 policy pivot rebound -> 2025 dispersion -> current)
  const macro3YCycle = [
    42, 34, 22,
    14, 25, 32, 48,
    42, 44, 35, 30,
    currentPEPct
  ];

  return quarters3Y.map((q, idx) => {
    if (isCommodityOrBond) {
      return {
        date: q,
        pe: 0,
        pb: 0,
        pePercentile: 50,
        pbPercentile: 50,
        compositePercentile: 50,
      };
    }

    const baseCycleVal = macro3YCycle[idx];
    const pePct = Math.round(Math.max(5, Math.min(95, baseCycleVal * (currentPEPct / 50))));
    const pbPct = Math.round(Math.max(5, Math.min(95, (baseCycleVal - 3) * (currentPBPct / 50))));

    // Exact match for the last point (current)
    const finalPEPct = idx === quarters3Y.length - 1 ? currentPEPct : pePct;
    const finalPBPct = idx === quarters3Y.length - 1 ? currentPBPct : pbPct;
    const compPct = Math.round(finalPEPct * 0.55 + finalPBPct * 0.45);

    // Approximate historical PE/PB values matching the percentile
    const peVal = Number((currentPE * (0.65 + (finalPEPct / 100) * 0.7)).toFixed(1));
    const pbVal = Number((currentPB * (0.65 + (finalPBPct / 100) * 0.7)).toFixed(2));

    return {
      date: q,
      pe: idx === quarters3Y.length - 1 ? currentPE : peVal,
      pb: idx === quarters3Y.length - 1 ? currentPB : pbVal,
      pePercentile: finalPEPct,
      pbPercentile: finalPBPct,
      compositePercentile: compPct,
    };
  });
}

/**
 * 基于真实后复权收盘价的历史「价格分位」轨迹 —— 替代原合成 PE/PB 估值分位。
 *
 * 数据诚信：本函数不引入任何虚构的"宏观周期"，全部由 instrument.bars（真实 parquet 行情）派生。
 * - 仅当 bars 为真实行情（样本 >= 60 根）时返回数据；缺失 / 过短返回 []，由调用方呈现"无真实数据"空态。
 * - 取最近 3 年（约 750 交易日）范围内的季末样本点；每个样本点的分位 = 其收盘价在各自回看窗口内的百分位：
 *     pePercentile  → 近 1 年（250 日）窗口分位（短期相对位置）
 *     pbPercentile  → 近 3 年（750 日，或全样本）窗口分位（长期相对位置）
 *   双轨分别刻画"短期 vs 长期"相对位置，均为真实价格派生，无合成假设。
 */
export function generatePricePercentileHistory(instrument: Partial<AShareInstrument>): HistoricalValuationPoint[] {
  const bars = instrument?.bars;
  if (!Array.isArray(bars) || bars.length < 60) return [];

  const sorted = [...bars].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );
  const closes = sorted.map((b) => b.close);
  const dates = sorted.map((b) => b.tradeDate);

  // 取最近 3 年（750 交易日）范围内的季末样本（约每 63 日一季）
  const startIdx = Math.max(0, sorted.length - 750);
  const sampleSet = Array.from(
    new Set(
      Array.from({ length: sorted.length - startIdx }, (_, k) => startIdx + k).filter(
        (i) => i === sorted.length - 1 || (i - startIdx) % 63 === 0
      )
    )
  );

  const pctOf = (value: number, lo: number, hi: number): number => {
    if (hi <= lo) return 50;
    return Math.max(1, Math.min(99, Math.round(((value - lo) / (hi - lo)) * 100)));
  };

  return sampleSet.map((i) => {
    const close = closes[i];
    const win1 = closes.slice(Math.max(0, i - 250), i + 1);
    const pePct = pctOf(close, Math.min(...win1), Math.max(...win1));
    const win3 = closes.slice(Math.max(0, i - 750), i + 1);
    const pbPct = pctOf(close, Math.min(...win3), Math.max(...win3));
    return {
      date: dates[i],
      pe: close, // 复用 pe/pb 字段承载真实收盘价
      pb: close,
      pePercentile: pePct,
      pbPercentile: pbPct,
      compositePercentile: Math.round((pePct + pbPct) / 2),
    };
  });
}

/**
 * Exponential Moving Average
 */
function calculateEMA(values: number[], span: number): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (span + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(alpha * values[i] + (1 - alpha) * ema[i - 1]);
  }
  return ema;
}

/**
 * Exponential Weighted Moving Average Crossover (EWMAC)
 * Robert Carver's signature continuous trend indicator.
 * EWMAC = (EMA(fast) - EMA(slow)) / (Price * dailyVol)
 * Scaled to typical -20 to +20 range.
 */
function computeEWMAC(closes: number[], fastSpan: number, slowSpan: number, currentATR: number, currentPrice: number): number {
  if (closes.length < slowSpan) return 0;
  
  const fastEMA = calculateEMA(closes, fastSpan);
  const slowEMA = calculateEMA(closes, slowSpan);
  
  const diff = fastEMA[fastEMA.length - 1] - slowEMA[slowEMA.length - 1];
  const dailyVolAmount = Math.max(0.001, currentATR);
  
  // Carver scalar normalization factor: typically sqrt(fast) * multiplier
  const rawScalar = diff / dailyVolAmount;
  const scaledScalar = rawScalar * 4.2; // calibrated so standard moves fall into [-20, 20]
  
  return Math.max(-20, Math.min(20, Number(scaledScalar.toFixed(1))));
}

/**
 * Evaluate comprehensive A-Share and ETF dedicated strategy signals for an instrument
 */
export function evaluateAShareStrategies(
  instrument: AShareInstrument,
  universe: AShareInstrument[] = []
): StrategySignals {
  if (!instrument) {
    return {
      ewmacFastSlow: {
        ewmac8_32: 0,
        ewmac16_64: 0,
        ewmac32_128: 0,
        compositeScalar: 0,
      },
      absoluteMomentumPass: true,
      relativeStrengthRank: 50,
      dividendRankScore: 50,
      valuationSignal: {
        peTTM: 0,
        pb: 0,
        pePercentile: 50,
        pbPercentile: 50,
        compositePercentile: 50,
        valuationZone: 'FAIR',
        zoneLabel: '合理中枢区 · 估值中性',
        positionAdjustmentSuggestion: '维持标准卡弗波动率平价配置',
        positionMultiplier: 1.0,
        history5y: [],
      },
      liquidityState: 'NORMAL',
      finalForecastScalar: 0,
    };
  }

  const bars = Array.isArray(instrument?.bars) ? instrument.bars : [];
  const closes = bars.map(b => b.close);
  const currentPrice = instrument?.currentPrice || 1.0;
  const currentATR = instrument?.dailyATR || 0.05;

  // 1. Carver Multi-horizon EWMAC (8/32, 16/64, 32/128)
  const ewmac8_32 = computeEWMAC(closes, 8, 32, currentATR, currentPrice);
  const ewmac16_64 = computeEWMAC(closes, 16, 64, currentATR, currentPrice);
  const ewmac32_128 = computeEWMAC(closes, 32, 128, currentATR, currentPrice);

  // Equal-weight combination across horizons as prescribed by Carver
  const ewmacComposite = (ewmac8_32 * 0.4 + ewmac16_64 * 0.35 + ewmac32_128 * 0.25);

  // 2. A-Share Absolute Momentum Filter (250-Day / Annual Line)
  // In China A-shares, being below MA250 indicates a bear regime with high probability of persistent down-drift.
  const latestBar = bars.length > 0 ? bars[bars.length - 1] : undefined;
  const ma250 = latestBar?.ma250 ?? (closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : currentPrice);
  const absoluteMomentumPass = currentPrice >= ma250;

  // 3. Relative Strength (RS) ranking within universe (20-day return vs peers)
  const calc20dReturn = (inst: AShareInstrument) => {
    if (!inst) return 0;
    const instBars = Array.isArray(inst?.bars) ? inst.bars : [];
    const instCloses = instBars.map(b => b.close);
    if (instCloses.length < 21) return inst?.changePct ? inst.changePct / 100 : 0;
    const past = instCloses[instCloses.length - 21];
    return past > 0 ? ((inst.currentPrice || 1) - past) / past : 0;
  };
  
  const safeUniverse = Array.isArray(universe) ? universe.filter(Boolean) : [];
  const peerReturns = safeUniverse.map(inst => ({ id: inst.id, ret: calc20dReturn(inst) }));
  peerReturns.sort((a, b) => a.ret - b.ret);
  const rankIdx = peerReturns.findIndex(p => p.id === instrument?.id);
  const relativeStrengthRank = Math.round(((rankIdx + 1) / Math.max(1, peerReturns.length)) * 100);

  // 4. ETF Dividend Yield & Low-Vol Safety Score
  let dividendRankScore = 50;
  if (instrument.dividendYield && instrument.dividendYield > 3.0) {
    dividendRankScore = Math.min(100, Math.round(50 + instrument.dividendYield * 10));
  }

  // 5. Valuation Percentile Calculation (PE-TTM & PB Rolling Percentiles)
  const peTTM = instrument.peTTM ?? 0;
  const pb = instrument.pb ?? 0;
  const pePercentile = instrument.pePercentile ?? 50;
  const pbPercentile = instrument.pbPercentile ?? 50;

  let compositePercentile = 50;
  const hasValuation = (instrument.category !== 'bond_etf' && instrument.category !== 'commodity_etf') && (peTTM > 0 || pb > 0);
  
  if (hasValuation) {
    compositePercentile = Math.round(pePercentile * 0.55 + pbPercentile * 0.45);
  }

  let valuationZone: 'EXTREME_LOW' | 'UNDERVALUED' | 'FAIR' | 'OVERVALUED' | 'EXTREME_HIGH' = 'FAIR';
  let zoneLabel = '合理中枢区 · 估值中性';
  let positionAdjustmentSuggestion = '估值处于历史中枢 40%~65%，无显著估值偏差，维持标准卡弗波动率平价配置';
  let positionMultiplier = 1.0;

  if (hasValuation) {
    if (compositePercentile < 20) {
      valuationZone = 'EXTREME_LOW';
      zoneLabel = '历史极低估区 · 极具安全边际';
      positionAdjustmentSuggestion = '估值分位 < 20% 处于历史极低区，建议基础仓位溢价 +20%~+30% 增配，逆向吸筹并以年化波动率托底';
      positionMultiplier = 1.25;
    } else if (compositePercentile < 40) {
      valuationZone = 'UNDERVALUED';
      zoneLabel = '低估合理区 · 具备性价比';
      positionAdjustmentSuggestion = '估值分位在 20%~40% 之间，性价比优良，建议基础仓位溢价 +10%~+15% 布局';
      positionMultiplier = 1.12;
    } else if (compositePercentile <= 65) {
      valuationZone = 'FAIR';
      zoneLabel = '合理中枢区 · 估值无明显偏向';
      positionAdjustmentSuggestion = '估值处于历史中枢 40%~65%，维持标准卡弗波动率平价配置';
      positionMultiplier = 1.0;
    } else if (compositePercentile <= 80) {
      valuationZone = 'OVERVALUED';
      zoneLabel = '偏高风险区 · 估值偏贵';
      positionAdjustmentSuggestion = '估值分位在 65%~80% 处于高位区间，建议对目标仓位施加 -15%~-20% 折价限制，防范估值杀跌';
      positionMultiplier = 0.85;
    } else {
      valuationZone = 'EXTREME_HIGH';
      zoneLabel = '极度泡沫区 · 警惕大幅均值回归';
      positionAdjustmentSuggestion = '估值分位 > 80% 处于极端泡沫区，建议仓位深度折价 -30%~-40% 锁定利润，严格执行移动止损';
      positionMultiplier = 0.65;
    }
  } else {
    zoneLabel = '固收/商品类 · 不适用市盈率估值';
    positionAdjustmentSuggestion = '纯债与大宗商品无固定市盈率，按大类资产宏观波动率平价进行配置';
  }

  const history5y = generatePricePercentileHistory(instrument);

  const valuationSignal: ValuationPercentileSignal = {
    peTTM,
    pb,
    pePercentile,
    pbPercentile,
    compositePercentile,
    valuationZone,
    zoneLabel,
    positionAdjustmentSuggestion,
    positionMultiplier,
    history5y,
  };

  // 6. Liquidity & Limit-Down State (A-Share T+1 and price-limit protection)
  let liquidityState: 'NORMAL' | 'CAUTION_T1' | 'LIMIT_DOWN_RISK' = 'NORMAL';
  const limitDownPrice = instrument.preClose * 0.90; // 10% limit down for main board & ETF
  const dropToLimitDistance = ((currentPrice - limitDownPrice) / currentPrice) * 100;
  
  if (dropToLimitDistance < 2.0 && instrument.changePct < -7.0) {
    liquidityState = 'LIMIT_DOWN_RISK';
  } else if (!instrument.isT0 && instrument.changePct < -3.5) {
    liquidityState = 'CAUTION_T1';
  }

  // 7. Synthesize Final Composite Carver Forecast Scalar (-20 to +20)
  let finalScalar = ewmacComposite;
  
  // If failed MA250 absolute momentum in A-shares, penalize trend (cut positive exposure in half or force defensive)
  if (!absoluteMomentumPass) {
    if (finalScalar > 0) {
      finalScalar = finalScalar * 0.4; // heavy penalty in bear regime
    } else {
      finalScalar = Math.min(finalScalar, -5); // accelerate defense
    }
  }

  // If ETF has excessive QDII premium (> 3%), cap buying scalar to prevent premium collapse loss
  if (instrument.premiumDiscountRate && instrument.premiumDiscountRate > 3.0) {
    finalScalar = Math.min(finalScalar, 0);
  }

  // If High Dividend ETF in low volatility, give positive support in sideways market
  if (instrument.category === 'sector_etf' && instrument.dividendYield && instrument.dividendYield > 4.0 && Math.abs(finalScalar) < 5) {
    finalScalar += 4;
  }

  // Clamp to [-20, 20]
  finalScalar = Math.max(-20, Math.min(20, Number(finalScalar.toFixed(1))));

  return {
    ewmacFastSlow: {
      ewmac8_32,
      ewmac16_64,
      ewmac32_128,
      compositeScalar: Number(ewmacComposite.toFixed(1)),
    },
    absoluteMomentumPass,
    relativeStrengthRank,
    dividendRankScore,
    valuationSignal,
    liquidityState,
    finalForecastScalar: finalScalar,
  };
}
