/**
 * A/B 回测：enforceTargetVol 两种语义 + 趋势门（2026-11-18）
 *
 * 背景：自选组合里恒生科技四个月近腰斩（真熊市），当前语义（目标波动=基准敞口，
 * 乘数=(标量+20)/20，中性=1.0x 满仓）下看空腿仍持有 0.42x 基础仓；传统择时语义
 * （乘数=标量/10，负标量清仓）则直接归零。哪个更好——让 walk-forward 回测裁决，
 * 不拍脑袋。恒科 2026-07~11 的下跌段是现成的压力测试样本。
 *
 * 三个变体：
 *   A. enforceTargetVol=true                    （现状：基准敞口 ± 倾斜）
 *   B. enforceTargetVol=false                   （传统 Carver 趋势：负标量清仓、正标量 s/10）
 *   C. enforceTargetVol=true + useTrendGate     （现状 + 年线下方禁左侧加仓）
 *
 * 口径说明：
 * - runRealBacktest 是 walk-forward 月频调仓、含佣金/印花税/滑点/流动性冲击（EXTREME_STRESS）；
 *   buildSnapshot 的 currentPrice 取 hfq 收盘 —— 回测内 MA250 门槛天然同口径，
 *   因此本 A/B 隔离的正是乘数语义本身，与 2026-11-18 部署态口径修复无关。
 * - 「科技熊市窗口」= 2026-07-01 起（恒科主跌段）至最后交易日；持仓从全程回测的
 *   状态延续进窗口，指标在窗口内重新计算（收益/波动/回撤/夏普）。
 *
 * 用法: npx tsx scripts/backtest_ab_semantics.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { runRealBacktest } from '../src/services/backtestEngine';
import { DEFAULT_BUNDLES, POORLAB11_ID, resolveUniverse } from '../src/services/bundles';
import { AShareInstrument } from '../src/types/ashare';

const WINDOW_START = '2026-07-01'; // 恒科主跌段起点

const baseSettings: any = {
  totalCapital: 1_000_000, targetAnnualVol: 0.18, bufferThreshold: 0.12,
  maxInstrumentRiskCap: 0.25, maxLeverage: 0.20, maxInstrumentPositionCap: 0.25, maxBondCap: 0.20,
  useIDM: true, idmMode: 'auto', maxIDM: 1.80,
  useERPTilt: false, useQualityGate: false,
  stockCommissionRate: 0.00025, etfCommissionRate: 0.0001, stockStampDuty: 0.0005, slippageBps: 5,
};

// 自选 6 腿（中港 · 股债金）—— 风险预算按用户真实持仓金额占比（CASH 不入池）
const WATCH_AMOUNTS: Record<string, number> = {
  '513180': 17200, '562500': 10200, '512890': 105000, '601288': 60300, '518880': 36400, '511010': 70500,
};
const amountSum = Object.values(WATCH_AMOUNTS).reduce((a, b) => a + b, 0);

function build6Legs(catalog: AShareInstrument[]): AShareInstrument[] {
  return Object.entries(WATCH_AMOUNTS).map(([id, amt]) => {
    const inst = catalog.find((c) => c.id === id);
    if (!inst) throw new Error(`catalog 缺少 ${id}`);
    return { ...inst, riskBudgetWeight: amt / amountSum };
  });
}

interface SliceMetrics { ret: number; vol: number; sharpe: number; maxDD: number; }

function metricsOf(equity: number[], rfPct = 2.2): SliceMetrics {
  if (equity.length < 2) return { ret: 0, vol: 0, sharpe: 0, maxDD: 0 };
  const ret = (equity[equity.length - 1] / equity[0] - 1) * 100;
  const daily: number[] = [];
  for (let i = 1; i < equity.length; i++) daily.push(equity[i] / equity[i - 1] - 1);
  const m = daily.reduce((a, b) => a + b, 0) / daily.length;
  const vol = Math.sqrt(daily.reduce((a, r) => a + (r - m) * (r - m), 0) / daily.length) * Math.sqrt(250) * 100;
  const annRet = Math.pow(equity[equity.length - 1] / equity[0], 250 / daily.length) * 100 - 100;
  const sharpe = vol > 0 ? (annRet - rfPct) / vol : 0;
  let peak = equity[0], dd = 0;
  for (const e of equity) { if (e > peak) peak = e; dd = Math.min(dd, e / peak - 1); }
  return { ret, vol, sharpe, maxDD: dd * 100 };
}

function fmt(x: number, digits = 1) { return (x >= 0 ? '+' : '') + x.toFixed(digits); }

async function main() {
  const catalog = await loadRealUniverse();
  for (const i of catalog as any[]) if (i.vwapPrice && i.vwapPrice > 0) i.currentPrice = i.vwapPrice; // 与部署态同口径

  const portfolios: { name: string; legs: AShareInstrument[] }[] = [
    { name: '自选 6 腿（中港·股债金，按真实持仓金额占比）', legs: build6Legs(catalog) },
    { name: 'poorlab11（11 只个股等权）', legs: resolveUniverse(catalog, DEFAULT_BUNDLES.find((b) => b.id === POORLAB11_ID)!) },
  ];

  const variants = [
    { tag: 'A. 现状：目标波动=基准敞口 (enforceTargetVol=true)', patch: { enforceTargetVol: true, useTrendGate: false } },
    { tag: 'B. 传统择时：负标量清仓 (enforceTargetVol=false)', patch: { enforceTargetVol: false, useTrendGate: false } },
    // 注：不单列 useTrendGate 变体 —— 引擎里趋势门只作用于 ERP 低估加成（useERPTilt 开启时才生效），
    // ERP 关闭时它与 A 逐点相同（实测确认），单独开启没有任何效果。
  ];

  for (const pf of portfolios) {
    console.log(`\n${'═'.repeat(72)}\n【${pf.name}】${pf.legs.length} 腿\n${'═'.repeat(72)}`);

    // 恒科买入持有（窗口内）作参照 —— 6 腿组合才有
    const hst = pf.legs.find((l) => l.id === '513180');
    if (hst) {
      const win = hst.bars.filter((b) => b.tradeDate >= WINDOW_START);
      if (win.length > 1) {
        console.log(`参照：恒生科技 买入持有（${WINDOW_START} 起 ${win.length - 1} 个交易日）：${fmt((win[win.length - 1].close / win[0].close - 1) * 100)}%`);
      }
    }

    for (const v of variants) {
      const settings = { ...baseSettings, ...v.patch };
      const { series, metrics } = runRealBacktest(pf.legs, settings, { stressLevel: 'EXTREME_STRESS' });
      const win = series.filter((p) => p.date >= WINDOW_START);
      const w = metricsOf(win.map((p) => p.carverStrategyEquity));
      const wEq = metricsOf(win.map((p) => p.equalWeightEquity));
      const full = metrics.carver;
      console.log(`\n  ${v.tag}`);
      console.log(`    科技熊市窗口(${WINDOW_START}~${series[series.length - 1]?.date})：` +
        `收益 ${fmt(w.ret)}%  年化波动 ${w.vol.toFixed(1)}%  夏普 ${w.sharpe.toFixed(2)}  最大回撤 ${w.maxDD.toFixed(1)}%` +
        `  [等权参照 ${fmt(wEq.ret)}% / 回撤 ${wEq.maxDD.toFixed(1)}%]`);
      console.log(`    全程(${metrics.startDate}~${metrics.endDate}，调仓 ${metrics.rebalanceCount} 次)：` +
        `累计 ${fmt(full.totalReturnPct)}%  年化 ${fmt(full.cagrPct)}%  波动 ${full.annVolPct.toFixed(1)}%  ` +
        `夏普 ${full.sharpe}  回撤 ${full.maxDrawdownPct.toFixed(1)}%  卡玛 ${full.calmar}`);
    }
  }
  console.log('\n（调仓为月频 + 缓冲带 12%；含佣金/印花税/滑点 5bp/流动性冲击 EXTREME_STRESS；估值倾斜关闭，纯趋势口径）');
}

main().catch((e) => { console.error(e); process.exit(1); });
