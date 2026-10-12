import { AShareInstrument, BacktestDataPoint, CarverSettings } from '../types/ashare';
import { calculatePortfolio } from './carverEngine';
import { loadValuationSeries, getAsOfValuation, ETF_INDEX_MAP } from './valuationStore';

export interface BacktestMetrics {
  carver: StrategyMetrics;
  equalWeight: StrategyMetrics;
  csi300: StrategyMetrics;
  startDate: string;
  endDate: string;
  rebalanceCount: number;
  stressLevel: string;
  advCapRatio: number;
}

export interface StrategyMetrics {
  totalReturnPct: number;   // 累计收益 (%)
  cagrPct: number;          // 年化 (%)
  annVolPct: number;        // 年化波动 (%)
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;   // 负数，例如 -18.3
  calmar: number;
  finalEquity: number;      // 期末净值 (起始=1.0)
}

export interface RunBacktestOptions {
  advCapRatio?: number;     // 5日ADV单日调仓上限比例 (默认 0.20)
  stressLevel?: 'NORMAL' | 'EXTREME_STRESS' | 'LIQUIDITY_CRUNCH';
  minHistoryBars?: number;  // 标的进入回测所需最少历史根数 (默认 252)
}

const TRADING_DAYS = 250;
const RISK_FREE = 0.022; // 无风险利率 2.2%

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
}

function logReturns(closes: number[], window?: number): number[] {
  const slice = window ? closes.slice(-(window + 1)) : closes;
  const out: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const p = slice[i - 1];
    const c = slice[i];
    if (p > 0 && c > 0) out.push(Math.log(c / p));
  }
  return out;
}

/**
 * 构建某个交易日 t（union 索引 idx）的单标的"历史快照"：
 * - bars = 截至该日的所有真实日线（供 EWMAC / MA250 / 相关性计算）
 * - currentPrice / preClose / changePct 取真实收盘价
 * - annualizedVol / dailyATR 用截至该日的 trailing 窗口计算
 * - 估值字段留空 -> 估值战术偏置在回测中保持中性（无未来基本面数据，避免前视偏差）
 */
function buildSnapshot(inst: AShareInstrument, prefix: AShareInstrument['bars']): AShareInstrument {
  const last = prefix[prefix.length - 1];
  const prev = prefix.length >= 2 ? prefix[prefix.length - 2] : last;
  const closes = prefix.map(b => b.close);
  const volRets = logReturns(closes, 120); // 120日窗口估计波动率，稳定性优于20/60日
  const annVol = std(volRets) * Math.sqrt(TRADING_DAYS);
  const atrWindow = prefix.slice(-20).map(b => b.atr20 ?? (b.high - b.low));
  const atr = atrWindow.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / Math.max(1, atrWindow.length);

  return {
    ...inst,
    bars: prefix,
    currentPrice: last.close,
    preClose: prev.close,
    changePct: prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
    annualizedVol: Math.max(0.05, annVol),
    dailyATR: Math.max(0.001, atr),
    peTTM: undefined,
    pb: undefined,
    pePercentile: undefined,
    pbPercentile: undefined,
    premiumDiscountRate: undefined,
    // 透传真实基本面质量属性
    roe: inst.roe,
    netProfitGrowthYoy: inst.netProfitGrowthYoy,
    revenueGrowthYoy: inst.revenueGrowthYoy,
    fundamentalQualityScore: inst.fundamentalQualityScore,
    valueTrapRisk: inst.valueTrapRisk,
  };
}

function computeMetrics(equity: number[]): StrategyMetrics {
  if (equity.length < 2) {
    return { totalReturnPct: 0, cagrPct: 0, annVolPct: 0, sharpe: 0, sortino: 0, maxDrawdownPct: 0, calmar: 0, finalEquity: 1 };
  }
  const start = equity[0];
  const end = equity[equity.length - 1];
  const totalReturnPct = (end / start - 1) * 100;
  const n = equity.length - 1;
  const daily = [];
  for (let i = 1; i < equity.length; i++) daily.push(equity[i] / equity[i - 1] - 1);
  const meanDaily = daily.reduce((a, b) => a + b, 0) / daily.length;
  const annVol = std(daily) * Math.sqrt(TRADING_DAYS);
  const cagr = Math.pow(end / start, TRADING_DAYS / n) - 1;

  // 回撤
  let peak = equity[0];
  let maxDD = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (e - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  // 下行标准差：标准半方差 sqrt( Σ min(r,0)^2 / N )，分母用全部样本数 N。
  // 旧实现取「负收益子集的 std」：等幅下跌时该子集 std=0 → Sortino=0，完全失真。
  const downsideSq = daily.reduce((a, r) => a + Math.min(0, r) ** 2, 0);
  const downStd = daily.length > 0 ? Math.sqrt(downsideSq / daily.length) * Math.sqrt(TRADING_DAYS) : 0;

  const annRetPct = cagr * 100;
  const sharpe = annVol > 0 ? (annRetPct - RISK_FREE * 100) / (annVol * 100) : 0;
  const sortino = downStd > 0 ? (annRetPct - RISK_FREE * 100) / (downStd * 100) : 0;
  const calmar = maxDD < 0 ? annRetPct / (Math.abs(maxDD) * 100) : 0;

  return {
    totalReturnPct: Number(totalReturnPct.toFixed(2)),
    cagrPct: Number((cagr * 100).toFixed(2)),
    annVolPct: Number((annVol * 100).toFixed(2)),
    sharpe: Number(sharpe.toFixed(2)),
    sortino: Number(sortino.toFixed(2)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    calmar: Number(calmar.toFixed(2)),
    finalEquity: Number(end.toFixed(4)),
  };
}

interface ImpactResult { protBps: number; unprotBps: number; }

/**
 * 平方根市场冲击模型 + 危机价差走阔：
 * - baseSpread：危机时买卖价差走阔（常态 3bps / 极端 18bps / 流动性枯竭 90bps），对所有成交征收，
 *   使压力场景真实压低收益（如实反映 2020-03 式流动性事件）。
 * - 参与率冲击：未保护随 sqrt(participation) 上升；受保护（T+1 流动性保护，单日参与率封顶 advCapRatio）
 *   将冲击限制在低位。对流动性充裕的旗舰 ETF，参与率极小，故两者差距本就微小——这正是该机制的诚实结论。
 */
function impactBps(participation: number, advCapRatio: number, stressLevel: 'NORMAL' | 'EXTREME_STRESS' | 'LIQUIDITY_CRUNCH'): ImpactResult {
  const coeff = 45; // participation=1 时约 45 bps 的参与率冲击
  const baseSpread = stressLevel === 'LIQUIDITY_CRUNCH' ? 90 : stressLevel === 'EXTREME_STRESS' ? 18 : 3;
  const protPart = Math.min(Math.max(0, participation), advCapRatio);
  const unprotPart = Math.max(0, participation);
  const protBps = baseSpread + coeff * Math.sqrt(protPart);
  const unprotBps = baseSpread + coeff * Math.sqrt(unprotPart);
  return { protBps, unprotBps };
}

/**
 * 真实 parquet 数据的 walk-forward 回测：
 * 月度再平衡，复用 canver-quant 既有的 calculatePortfolio（波动率定仓 + IDM + 杠杆硬顶 + 缓冲带），
 * 对截至每个再平衡日的"历史快照"计算目标持仓，按真实价成交并扣除 ADV 市场冲击成本。
 * 输出四组净值：卡弗(受流动性保护) / 卡弗(未保护) / 等权重月度再平衡 / 沪深300买入持有，
 * 以及各策略绩效指标。
 */
export function runRealBacktest(
  universe: AShareInstrument[],
  settings: CarverSettings,
  options: RunBacktestOptions = {}
): { series: BacktestDataPoint[]; metrics: BacktestMetrics; valuationTiltTriggers: number } {
  // 排除合成伪数据标的：其 bars 是前端生成的伪随机 K 线，不能参与回测结论
  const safeUniverse = (Array.isArray(universe) ? universe : [])
    .filter(Boolean)
    .filter((i) => !i.syntheticBars);
  const advCapRatio = options.advCapRatio ?? 0.20;
  const stressLevel = options.stressLevel ?? 'EXTREME_STRESS';
  const minHist = options.minHistoryBars ?? 252;
  const points: BacktestDataPoint[] = [];
  if (safeUniverse.length === 0) {
    return { series: points, metrics: emptyMetrics(stressLevel, advCapRatio), valuationTiltTriggers: 0 };
  }

  // 1. 构建 union 交易日轴 + 每只标的在每个 union 日的可用 bars 数量（two-pointer）
  const dateSet = new Set<string>();
  for (const inst of safeUniverse) for (const b of inst.bars) dateSet.add(b.tradeDate);
  const unionDates = Array.from(dateSet).sort();

  const prefixLen: number[][] = []; // prefixLen[instIdx][unionIdx]
  safeUniverse.forEach((inst) => {
    const arr = new Array(unionDates.length).fill(0);
    let p = 0;
    const bars = inst.bars;
    for (let i = 0; i < unionDates.length; i++) {
      while (p < bars.length && bars[p].tradeDate <= unionDates[i]) p++;
      arr[i] = p;
    }
    prefixLen.push(arr);
  });

  // 2. 每只标的在 union 轴上"激活"的起始索引（达到 minHist 根历史）
  const activeFrom: number[] = safeUniverse.map((inst, k) => {
    const need = Math.min(minHist, inst.bars.length);
    if (need <= 0) return unionDates.length;
    const targetDate = inst.bars[need - 1].tradeDate;
    return unionDates.indexOf(targetDate);
  });
  // 渐进入池：从最早有足够历史的标的处开始回测，其余标的达到 minHist 后自动加入。
  // 旧实现取 max(activeFrom)，导致最晚上市的标的（如 513180 恒生科技）把回测起点整体拖后，
  // 早期标的（如 510300 自 2013 起）的历史被白白丢弃，样本期被无谓截断。
  const startIdx = Math.max(0, Math.min(...activeFrom));
  if (startIdx < 0 || startIdx >= unionDates.length - 1) {
    return { series: points, metrics: emptyMetrics(stressLevel, advCapRatio), valuationTiltTriggers: 0 };
  }

  // 3. 初始资金与状态
  const totalCap = settings?.totalCapital || 1000000;
  // 估值历史（闸门④）：指数 pe/pb 月频回补 + 每日快照，用于 as-of 分位注入
  const valuationSeriesMap = loadValuationSeries();
  let valuationTiltTriggers = 0;
  const csiInst = safeUniverse.find(i => i.code.startsWith('510300')) || safeUniverse.find(i => i.category === 'broad_etf') || safeUniverse[0];
  const csiIdx = safeUniverse.indexOf(csiInst);
  // 渐进入池后 startIdx 可能早于基准标的自身的激活点，需避免下标为 -1
  const csiLen = prefixLen[csiIdx][startIdx] || 0;
  const csiStartPrice =
    csiLen > 0
      ? csiInst.bars[csiLen - 1]?.close || csiInst.currentPrice
      : csiInst.bars[0]?.close || csiInst.currentPrice;

  // 持仓（股数）
  const heldCarver = new Map<string, number>();
  const heldEw = new Map<string, number>();
  const heldCsi = Math.floor((totalCap / csiStartPrice) / 100) * 100;
  // 现金
  let cashCarverProt = totalCap;
  let cashCarverUnprot = totalCap;
  let cashEw = totalCap;
  const cashCsi = totalCap - heldCsi * csiStartPrice;

  // 累计规避滑点（货币 & 成交额）
  let savedCum = 0;
  let turnoverCum = 0;
  let rebalanceCount = 0;

  const navOf = (cash: number, held: Map<string, number>, prices: Map<string, number>) => {
    let v = cash;
    held.forEach((sh, code) => { v += sh * (prices.get(code) || 0); });
    return v;
  };

  const commissionRate = (inst: AShareInstrument) => inst.isETF ? settings.etfCommissionRate : settings.stockCommissionRate;
  const stampRate = (inst: AShareInstrument, action: 'BUY' | 'SELL') =>
    (!inst.stampDutyExempt && action === 'SELL') ? settings.stockStampDuty : 0;

  // 运行期累计最高净值（用于 O(1) 增量计算回撤，避免每日全表扫描 O(N^2) 导致界面卡顿）
  let maxCarverPeak = 1.0;
  let maxCsiPeak = 1.0;

  // 4. 主循环
  for (let i = startIdx; i < unionDates.length; i++) {
    const date = unionDates[i];
    const isFirst = i === startIdx;
    const isRebalance = isFirst || (new Date(date).getMonth() !== new Date(unionDates[i - 1]).getMonth());

    // 当日价格表
    const prices = new Map<string, number>();
    const advMap = new Map<string, number>(); // 5日ADV（元）
    safeUniverse.forEach((inst, k) => {
      const len = prefixLen[k][i];
      if (len > 0) {
        const bar = inst.bars[len - 1];
        prices.set(inst.code, bar.close);
        const recent = inst.bars.slice(Math.max(0, len - 5), len);
        // ADV 用真实成交额 (元)：优先 bar.amount，缺失才退回 turnover(万元)×10000。
        // 旧实现直接用合成并取整的 turnover×10000，早期小成交额样本会得到 0
        // → participation=1 → 恒定 45bps 冲击，使流动性保护结论失真。
        const adv = recent.reduce(
          (a, b) => a + (Number(b.amount) > 0 ? Number(b.amount) : (b.turnover || 0) * 10000),
          0,
        ) / Math.max(1, recent.length);
        advMap.set(inst.code, adv);
      }
    });

    if (isRebalance) {
      rebalanceCount++;
      // 构建快照 universe（仅已激活标的）
      const snapshot: AShareInstrument[] = [];
      const snapshotHeld = new Map<string, number>();
      safeUniverse.forEach((inst, k) => {
        if (prefixLen[k][i] >= minHist) {
          const prefix = inst.bars.slice(0, prefixLen[k][i]);
          const snap = buildSnapshot(inst, prefix);
          snap.currentShares = heldCarver.get(inst.code) || 0;
          snapshot.push(snap);
          snapshotHeld.set(inst.code, heldCarver.get(inst.code) || 0);
        }
      });

      // 闸门④：注入 as-of 估值分位（point-in-time，仅用再平衡日之前的数据，无未来函数）。
      // 宽基 ETF 映射指数（pe+pb 分位均真实才放行 hasValuation 闸门）；个股无历史 PE → 不给信号（诚实冷启动）。
      let tiltTriggeredThisRebalance = false;
      snapshot.forEach(snap => {
        const six = snap.code.split('.')[0];
        const key = snap.isETF !== false ? ETF_INDEX_MAP[six] : six;
        if (!key) return;
        const av = getAsOfValuation(valuationSeriesMap, key, date);
        if (av.pePercentile !== undefined) snap.pePercentile = av.pePercentile;
        if (av.pbPercentile !== undefined) snap.pbPercentile = av.pbPercentile;
        if (snap.isETF !== false) {
          // ETF：以映射指数的 as-of 值充当（自身无 PE/PB）
          snap.peTTM = av.pePercentile !== undefined && av.pe && av.pe > 0 ? av.pe : undefined;
          snap.pb = av.pbPercentile !== undefined && av.pb && av.pb > 0 ? av.pb : undefined;
        } else {
          // 个股：历史估值来自百度周频回补，as-of 值真实（亏损期 PE 缺失则该分位段自然缩短）
          snap.peTTM = av.pePercentile !== undefined && av.pe && av.pe > 0 ? av.pe : undefined;
          snap.pb = av.pbPercentile !== undefined && av.pb && av.pb > 0 ? av.pb : undefined;
        }
        if (
          settings.useERPTilt !== false &&
          snap.pePercentile != null && snap.pbPercentile != null &&
          (snap.category === 'broad_etf' || snap.category === 'stock_cn' || snap.category === 'sector_etf')
        ) {
          const comp = Math.round(snap.pePercentile * 0.55 + snap.pbPercentile * 0.45);
          if (comp < 40) tiltTriggeredThisRebalance = true; // EXTREME_LOW(<20) +3.0 / UNDERVALUED(<40) +1.5
        }
      });
      if (tiltTriggeredThisRebalance) valuationTiltTriggers++;

      // --- 卡弗策略目标持仓 ---
      const { positions } = calculatePortfolio(snapshot, settings);
      const targetCarver = new Map<string, number>();
      // 缓冲带（12% 死区）必须在回测中生效：落在死区内则维持当前持仓、不调仓。
      // 旧实现直接取 targetShares，导致每次再平衡都全量换仓，
      // 系统性放大换手与成本，且与 UI「建议执行股数」口径不一致。
      positions.forEach(p =>
        targetCarver.set(
          p.instrument.code,
          p.withinBuffer ? (p.currentShares || 0) : p.targetShares,
        ),
      );

      // --- 等权重目标持仓（仅在已激活标的中均分）---
      const nActive = snapshot.length;
      const ewNav = cashEw + navOf(0, heldEw, prices); // 当前 ew 组合净值（现金 + 持仓市值）
      const ewTarget = new Map<string, number>();
      if (nActive > 0) {
        const weight = 1 / nActive;
        snapshot.forEach(inst => {
          const price = prices.get(inst.code) || inst.currentPrice;
          const targetCap = ewNav * weight;
          ewTarget.set(inst.code, Math.max(0, Math.floor((targetCap / price) / 100) * 100));
        });
      }

      // 成交 + 成本（卡弗 protect/unprotect 两条；ew protect）
      const applyTrades = (
        held: Map<string, number>,
        target: Map<string, number>,
        cashRef: { cash: number },
        protectedCost: boolean
      ) => {
        target.forEach((tgtShares, code) => {
          const cur = held.get(code) || 0;
          const delta = tgtShares - cur;
          if (delta === 0) return;
          const inst = safeUniverse.find(x => x.code === code)!;
          const price = prices.get(code) || inst.currentPrice;
          const turnover = Math.abs(delta) * price;
          const adv = advMap.get(code) || 0;
          const participation = adv > 0 ? turnover / adv : 1;
          const { protBps, unprotBps } = impactBps(participation, advCapRatio, stressLevel);
          const slipBps = protectedCost ? protBps : unprotBps;
          const rate = commissionRate(inst) + stampRate(inst, delta > 0 ? 'BUY' : 'SELL') + slipBps / 10000;
          const cost = turnover * rate;
          if (delta > 0) cashRef.cash -= (turnover + cost);
          else cashRef.cash += (turnover - cost);
          held.set(code, tgtShares);
        });
      };

      // 卡弗受保护：以交易前持仓为基准计算成交，并写入 heldCarver
      const preHeldCarver = new Map(heldCarver); // 交易前持仓快照
      applyTrades(heldCarver, targetCarver, { get cash() { return cashCarverProt; }, set cash(v) { cashCarverProt = v; } }, true);

      // 卡弗未保护：同一目标持仓，但用【交易前】持仓算 delta 并支付更高冲击成本
      const unprotRef = { get cash() { return cashCarverUnprot; }, set cash(v) { cashCarverUnprot = v; } };
      targetCarver.forEach((tgtShares, code) => {
        const cur = preHeldCarver.get(code) || 0; // 关键：必须是交易前持仓，否则 delta≈0 不成交
        const delta = tgtShares - cur;
        if (delta === 0) return;
        const inst = safeUniverse.find(x => x.code === code)!;
        const price = prices.get(code) || inst.currentPrice;
        const turnover = Math.abs(delta) * price;
        const adv = advMap.get(code) || 0;
        const participation = adv > 0 ? turnover / adv : 1;
        const { protBps, unprotBps } = impactBps(participation, advCapRatio, stressLevel);
        const rate = commissionRate(inst) + stampRate(inst, delta > 0 ? 'BUY' : 'SELL') + unprotBps / 10000;
        const cost = turnover * rate;
        if (delta > 0) unprotRef.cash -= (turnover + cost);
        else unprotRef.cash += (turnover - cost);
        // 累计规避滑点（受保护相对未保护少付的冲击成本）
        savedCum += (unprotBps - protBps) / 10000 * turnover;
        turnoverCum += turnover;
      });
      // 等权重
      applyTrades(heldEw, ewTarget, { get cash() { return cashEw; }, set cash(v) { cashEw = v; } }, true);
    }

    // 5. 当日净值
    const navProt = navOf(cashCarverProt, heldCarver, prices);
    const navUnprot = navOf(cashCarverUnprot, heldCarver, prices);
    const navEw = navOf(cashEw, heldEw, prices);
    const navCsi = cashCsi + heldCsi * (prices.get(csiInst.code) || csiStartPrice);

    const eqProt = navProt / totalCap;
    const eqUnprot = navUnprot / totalCap;
    const eqEw = navEw / totalCap;
    const eqCsi = navCsi / totalCap;

    // 回撤（基于截至今日的峰值，O(1) 增量更新）
    if (eqProt > maxCarverPeak) maxCarverPeak = eqProt;
    if (eqCsi > maxCsiPeak) maxCsiPeak = eqCsi;
    const carverPeak = maxCarverPeak;
    const csiPeak = maxCsiPeak;

    points.push({
      date,
      carverStrategyEquity: Number(eqProt.toFixed(4)),
      carverUnprotectedEquity: Number(eqUnprot.toFixed(4)),
      equalWeightEquity: Number(eqEw.toFixed(4)),
      csi300Equity: Number(eqCsi.toFixed(4)),
      carverDrawdown: Number(((eqProt - carverPeak) / carverPeak * 100).toFixed(2)),
      csi300Drawdown: Number(((eqCsi - csiPeak) / csiPeak * 100).toFixed(2)),
      slippageSavedBps: Number((turnoverCum > 0 ? (savedCum / turnoverCum * 10000) : 0).toFixed(1)),
    });
  }

  const equitySeries = (key: keyof BacktestDataPoint) => points.map(p => p[key] as number);
  const metrics: BacktestMetrics = {
    carver: computeMetrics(equitySeries('carverStrategyEquity')),
    equalWeight: computeMetrics(equitySeries('equalWeightEquity')),
    csi300: computeMetrics(equitySeries('csi300Equity')),
    startDate: points[0]?.date || '',
    endDate: points[points.length - 1]?.date || '',
    rebalanceCount,
    stressLevel,
    advCapRatio,
  };

  return { series: points, metrics, valuationTiltTriggers };
}

function emptyMetrics(stressLevel: string, advCapRatio: number): BacktestMetrics {
  const z: StrategyMetrics = { totalReturnPct: 0, cagrPct: 0, annVolPct: 0, sharpe: 0, sortino: 0, maxDrawdownPct: 0, calmar: 0, finalEquity: 1 };
  return { carver: z, equalWeight: z, csi300: z, startDate: '', endDate: '', rebalanceCount: 0, stressLevel, advCapRatio };
}
