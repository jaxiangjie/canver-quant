/**
 * 组合净值曲线（按共同交易日对齐）——唯一实现（2026-11-18 tribunal）。
 *
 * 背景：此前同一算法在 PortfolioRiskContributionChart、verify_nav_curve_fix.ts、
 * check_nav_synthetic.ts 三处逐行手抄，组件一改脚本就静默在验证一个不存在的算法
 *（test_risk_parity 的血泪教训：「不再复刻副本——副本曾让等权变异体全过」）。
 * 组件与诊断脚本一律 import 本函数。
 *
 * 算法语义（2026-10-15 修正版）：
 * - 取各腿**共同交易日**（日期交集）按日期查表取 close，绝不做数组下标对齐
 *   （各腿历史长度差异极大，同一下标落在完全不同的日期上）；
 * - 权重 = 当前持仓市值占比（市价口径 currentPrice 仅用于权重，收益用 hfq close 序列）；
 * - 基准优先沪深300（benchCode 命中的腿）；组合里没有基准时回退第一条腿并如实标注，
 *   绝不冒充沪深300。
 */
export interface NAVLegInput {
  code: string;             // 全码，如 510300.SH
  name?: string;            // 展示名（基准回退标注用）
  shares: number;           // 当前持股（0 = 不参与）
  price: number;            // 市价口径现价（仅用于权重）
  bars: { tradeDate: string; close: number }[];  // 真实 K 线（hfq 口径收益）
}

export interface NAVPoint {
  date: string;             // MM-DD
  fullDate: string;         // YYYY-MM-DD
  portfolioNAV: number;
  csi300NAV: number;
  portfolioReturnPct: number;
  csiReturnPct: number;
  benchLabel?: string;
}

export function computeAlignedNAV(
  legs: NAVLegInput[],
  opts: { lookback: number; benchCode: string },
): NAVPoint[] {
  // 只保留真正有持仓、且真实 bars 足够的腿：无持仓腿既不该进组合收益，也不该决定共同日期窗口
  const valid = legs.filter((l) => l && l.shares > 0 && Array.isArray(l.bars) && l.bars.length > 30);
  if (valid.length === 0) return [];

  const totalEquity = valid.reduce((acc, l) => acc + l.shares * (l.price || 1), 0);

  // 每腿建立「交易日 → close」索引（按日期对齐的唯一依据）
  const seriesList = valid.map((l) => {
    const byDate = new Map<string, number>();
    for (const b of l.bars) {
      if (b?.tradeDate && b.close > 0) byDate.set(b.tradeDate, b.close);
    }
    const mv = l.shares * (l.price || 1);
    return {
      code: l.code,
      name: l.name || l.code,
      weight: totalEquity > 0 ? mv / totalEquity : 1 / valid.length,
      byDate,
    };
  });

  // 共同交易日 = 各腿都有数据的日期交集（升序）
  const allDateLists = seriesList.map((s) => [...s.byDate.keys()]);
  const [firstList, ...others] = allDateLists;
  const othersSets = others.map((l) => new Set(l));
  const commonDates = firstList.filter((d) => othersSets.every((s) => s.has(d))).sort();
  if (commonDates.length < 2) return [];
  // +1 根起点用于计算首日收益 → 正好产出 lookback 个交易日
  const window = commonDates.slice(-(opts.lookback + 1));

  // 基准：优先 benchCode（沪深300）；组合里没有时回退第一条腿，标注真实身份
  const bench = seriesList.find((s) => s.code === opts.benchCode) ?? seriesList[0];
  const benchLabel =
    bench.code === opts.benchCode
      ? '沪深300 买入持有'
      : `${bench.name} 买入持有 (${String(bench.code).split('.')[0]})`;

  let portAccum = 1.0;
  let benchAccum = 1.0;
  const points: NAVPoint[] = [];
  for (let i = 0; i < window.length; i++) {
    const date = window[i];
    if (i > 0) {
      const prevDate = window[i - 1];
      let dayReturn = 0;
      for (const s of seriesList) {
        const prev = s.byDate.get(prevDate);
        const curr = s.byDate.get(date);
        if (prev && curr && prev > 0 && curr > 0) dayReturn += (curr / prev - 1) * s.weight;
      }
      portAccum *= 1 + dayReturn;
      const bp = bench.byDate.get(prevDate);
      const bc = bench.byDate.get(date);
      benchAccum *= 1 + (bp && bc && bp > 0 && bc > 0 ? bc / bp - 1 : 0);
    }
    points.push({
      date: date.slice(5), // MM-DD（保持原显示风格）
      fullDate: date,
      portfolioNAV: Number(portAccum.toFixed(4)),
      csi300NAV: Number(benchAccum.toFixed(4)),
      portfolioReturnPct: Number(((portAccum - 1) * 100).toFixed(2)),
      csiReturnPct: Number(((benchAccum - 1) * 100).toFixed(2)),
      benchLabel,
    });
  }

  return points;
}
