import { AShareInstrument } from '../types/ashare';

export interface CorrelationPair {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  targetId: string;
  targetCode: string;
  targetName: string;
  correlation: number; // -1.0 to 1.0
  lookbackDays: number;
}

export interface InstrumentCorrelationSummary {
  instrument: AShareInstrument;
  averageCorrelation: number; // 与宇宙内其他标的的平均相关性
  minCorrelation: {
    targetName: string;
    correlation: number;
  };
  maxCorrelation: {
    targetName: string;
    correlation: number;
  };
  diversificationBenefit: 'HIGH' | 'MEDIUM' | 'LOW'; // 互补收益评级
}

export interface UniverseCorrelationResult {
  instruments: AShareInstrument[];
  matrix: number[][]; // N x N 矩阵
  lookbackDays: number;
  dateRange: {
    startDate: string;
    endDate: string;
  };
  averageUniverseCorrelation: number; // 宇宙全局平均相关性
  carverIDM: number; // Carver 组合分散化乘数 (Instrument Diversification Multiplier)
  summaries: InstrumentCorrelationSummary[];
  pairsRanked: CorrelationPair[]; // 按照相关性从低到高排序的标的对（最互补的对子在前）
}

/**
 * 计算两个收益率序列的皮尔逊相关系数 (Pearson correlation coefficient)
 */
export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }

  const denominator = Math.sqrt(denomX * denomY);
  if (denominator === 0) return 0;

  const r = numerator / denominator;
  // 浮点数极值边界约束在 [-1, 1]
  return Math.max(-1, Math.min(1, Number(r.toFixed(4))));
}

/**
 * 提取标的在过去 lookbackDays 个交易日的对数日收益率序列
 */
export function extractDailyReturns(
  instrument: AShareInstrument,
  lookbackDays: number = 60
): { returns: number[]; dates: string[] } {
  const bars = instrument.bars || [];
  if (bars.length < 2) {
    return { returns: [], dates: [] };
  }

  // 取最近的 lookbackDays + 1 根日线以算出 lookbackDays 个单日收益
  const recentBars = bars.slice(-(lookbackDays + 1));
  const returns: number[] = [];
  const dates: string[] = [];

  for (let i = 1; i < recentBars.length; i++) {
    const prev = recentBars[i - 1].close;
    const curr = recentBars[i].close;
    if (prev > 0 && curr > 0) {
      // 连续对数收益率 ln(P_t / P_{t-1})，数学上更严谨，加和具有对称性
      const ret = Math.log(curr / prev);
      returns.push(ret);
      dates.push(recentBars[i].tradeDate);
    }
  }

  return { returns, dates };
}

/**
 * 根据罗伯特·卡弗 (Robert Carver)《系统化交易》第 9 章：
 * 根据标的个数 N 与标的间平均相关系数 rho，计算资产分散化乘数 IDM
 * 公式推导:
 * 设组合等风险分配，在平均相关系数 rho 下：
 * 组合总方差比例 = 1/N + (1 - 1/N) * rho
 * IDM (Instrument Diversification Multiplier) = 1 / sqrt( 1/N + (1 - 1/N) * rho )
 * Carver 上限设为 2.5 (防止杠杆无上限放大)，下限为 1.0 (完全正相关无分散收益)
 */
export function computeCarverIDM(n: number, avgCorrelation: number): number {
  if (n <= 1) return 1.0;
  const clampedRho = Math.max(-0.2, Math.min(1.0, avgCorrelation));
  const portfolioVarRatio = (1 / n) + (1 - 1 / n) * clampedRho;
  if (portfolioVarRatio <= 0) return 2.5;
  const rawIDM = 1 / Math.sqrt(portfolioVarRatio);
  return Math.max(1.0, Math.min(2.5, Number(rawIDM.toFixed(3))));
}

/**
 * 按交易日对齐后计算两组收益序列的相关性。
 * 旧实现直接按下标配对：任一标的停牌 / 缺日都会让两条序列错位，
 * 极端时会算出虚假的负相关，使 IDM 失真。这里先取日期交集再算。
 */
function correlationAlignedByDate(
  a: { date: string; ret: number }[],
  b: { date: string; ret: number }[],
): number {
  if (!a.length || !b.length) return 0;
  const mapB = new Map(b.map((x) => [x.date, x.ret]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of a) {
    const y = mapB.get(x.date);
    if (y !== undefined) {
      xs.push(x.ret);
      ys.push(y);
    }
  }
  return calculatePearsonCorrelation(xs, ys);
}

/**
 * 计算 Universe 内所有标的在过去 lookbackDays (默认 60 天) 的相关性矩阵及互补性优化指标
 */
export function computeUniverseCorrelationMatrix(
  universe: AShareInstrument[],
  lookbackDays: number = 60
): UniverseCorrelationResult {
  // 排除合成伪数据标的，避免假 K 线影响相关性与 IDM
  const safeUniverse = Array.isArray(universe)
    ? universe.filter(Boolean).filter((i) => !i.syntheticBars)
    : [];
  const n = safeUniverse.length;

  if (n === 0) {
    return {
      instruments: [],
      matrix: [],
      lookbackDays,
      dateRange: { startDate: '', endDate: '' },
      averageUniverseCorrelation: 0,
      carverIDM: 1.0,
      summaries: [],
      pairsRanked: []
    };
  }

  // 1. 提取所有标的过去 60 天对数收益序列（保留日期，供按交易日对齐）
  const seriesMap: { [id: string]: { date: string; ret: number }[] } = {};
  let commonDates: string[] = [];

  safeUniverse.forEach(inst => {
    const { returns, dates } = extractDailyReturns(inst, lookbackDays);
    seriesMap[inst.id] = returns.map((r, i) => ({ date: dates[i], ret: r }));
    if (dates.length > commonDates.length) {
      commonDates = dates;
    }
  });

  const startDate = commonDates[0] || '';
  const endDate = commonDates[commonDates.length - 1] || '';

  // 2. 构造 N x N 相关性矩阵
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(1));
  const allOffDiagonalCorrs: number[] = [];
  const pairsRanked: CorrelationPair[] = [];

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1.0;
      } else if (i < j) {
        const instI = safeUniverse[i];
        const instJ = safeUniverse[j];
        const r = correlationAlignedByDate(seriesMap[instI.id] || [], seriesMap[instJ.id] || []);
        matrix[i][j] = r;
        matrix[j][i] = r;
        allOffDiagonalCorrs.push(r);

        pairsRanked.push({
          sourceId: instI.id,
          sourceCode: instI.code,
          sourceName: instI.name,
          targetId: instJ.id,
          targetCode: instJ.code,
          targetName: instJ.name,
          correlation: r,
          lookbackDays
        });
      }
    }
  }

  // 3. 按照相关性从低到高排序（低相关或负相关排在最前面，互补性最佳）
  pairsRanked.sort((a, b) => a.correlation - b.correlation);

  // 4. 全局平均相关系数
  const avgUniverseCorr = allOffDiagonalCorrs.length > 0
    ? Number((allOffDiagonalCorrs.reduce((a, b) => a + b, 0) / allOffDiagonalCorrs.length).toFixed(4))
    : 1.0;

  // 5. 计算 Carver IDM
  const carverIDM = computeCarverIDM(n, avgUniverseCorr);

  // 6. 各标的独立相关性摘要
  const summaries: InstrumentCorrelationSummary[] = safeUniverse.map((inst, i) => {
    const othersCorrs: { targetName: string; corr: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        othersCorrs.push({
          targetName: safeUniverse[j].name,
          corr: matrix[i][j]
        });
      }
    }

    const avgCorr = othersCorrs.length > 0
      ? othersCorrs.reduce((acc, c) => acc + c.corr, 0) / othersCorrs.length
      : 1.0;

    othersCorrs.sort((a, b) => a.corr - b.corr);
    const minCorr = othersCorrs[0] || { targetName: '--', corr: 1 };
    const maxCorr = othersCorrs[othersCorrs.length - 1] || { targetName: '--', corr: 1 };

    let benefit: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    if (avgCorr < 0.25) benefit = 'HIGH';
    else if (avgCorr > 0.65) benefit = 'LOW';

    return {
      instrument: inst,
      averageCorrelation: Number(avgCorr.toFixed(3)),
      minCorrelation: {
        targetName: minCorr.targetName,
        correlation: Number(minCorr.corr.toFixed(3))
      },
      maxCorrelation: {
        targetName: maxCorr.targetName,
        correlation: Number(maxCorr.corr.toFixed(3))
      },
      diversificationBenefit: benefit
    };
  });

  return {
    instruments: safeUniverse,
    matrix,
    lookbackDays,
    dateRange: { startDate, endDate },
    averageUniverseCorrelation: avgUniverseCorr,
    carverIDM,
    summaries,
    pairsRanked
  };
}
