/**
 * 复权断裂检测 + VWAP 甄别重标定验证（2026-10-14 重构）
 *
 * tribunal G2c1/G2c3 前的旧版整文件是生产逻辑的手抄复刻（与 stagingData.ts 第三份副本
 * 已漂移：还留着"假设当日收益 0"兜底、close-only 缩放），且关键 fixture 是恒等式
 * （vwap≡close×0.97 → 比值恒 1 → 任何阈值都能过）——测试保护的是复印件。
 *
 * 本版直接 import 生产真身 detectAndFixBreaks（stagingData.ts，与 realData.ts 的
 * 内联实现同源同阈值——两处必须在改动时同步，这是已知的债务，见 MEMORY.md）。
 * fixture 全部带真实 VWAP 噪声（涨停日成交低于收盘的典型形态），比值平稳但不恒等。
 *
 * 运行：npx tsx scripts/test_break_detection.ts
 */
import { detectAndFixBreaks } from '../src/services/stagingData';
import type { StagingBar } from '../src/services/stagingData';

/** 严格递增的伪交易日历（自然日推进，检测逻辑只比较日期字符串顺序） */
function tradingDates(n: number, startISO = '2026-08-03'): string[] {
  const out: string[] = [];
  const d = new Date(startISO + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * 由 close 序列反推带真实噪声的 amount：vwap = close × (0.97 + 0.004·sin(i))
 * ——涨停形态下成交价低于收盘（比值 0.966~0.974 波动），窗口内比值平稳（drift<15%）
 * 但绝不恒等（旧版恒等 fixture 的病：比值恒 1.0309 → 阈值不可测）。
 */
function barsFromCloses(closes: number[], dates: string[], volume = 1000): StagingBar[] {
  return closes.map((c, i) => {
    const vwap = c * (0.97 + 0.004 * Math.sin(i * 1.7));
    return {
      tradeDate: dates[i],
      open: c,
      high: c,
      low: c,
      close: c,
      volume,
      amount: vwap * volume,
    };
  });
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  PASS ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

// ---- 1) 合成复权断裂：平滑序列 ×3.25 单日放大 → 必须检出并重标定 ----
// 建模要点（ tribunal G2c1 的债）：复权断裂的本质是 **close 跳而复权无关的 VWAP 不跳**
// （VWAP=amount/volume 是原始成交数据，不经复权）——所以断裂后 close×3.25 而 amount
// 保持原水平，close/vwap 比值漂移。若 fixture 让 vwap 与 close 成比例（比值不变），
// 就是在测一个恒等式，任何阈值都能过。
{
  const dates = tradingDates(60);
  const rows: StagingBar[] = [];
  for (let i = 0; i < 30; i++) {
    const c = 10 * (1 + 0.005 * i);
    rows.push({ tradeDate: dates[i], open: c, high: c, low: c, close: c, volume: 1000, amount: c * 0.97 * 1000 });
  }
  for (let i = 30; i < 60; i++) {
    const c = 10 * (1 + 0.005 * i) * 3.25; // 复权基准切换：close 跳 3.25 倍
    rows.push({ tradeDate: dates[i], open: c, high: c, low: c, close: c, volume: 1000, amount: c * 0.97 * 1000 / 3.25 }); // VWAP 保持原口径
  }
  const { bars, findings, rescaledCount } = detectAndFixBreaks(rows);
  check('合成×3.25断裂被检出（1 处候选）', findings.length === 1, `got ${JSON.stringify(findings)}`);
  check('合成断裂被重标定 1 次', rescaledCount === 1, `got ${rescaledCount}`);
  check('断裂候选分类为 rescaled', findings[0]?.action === 'rescaled', `got ${findings[0]?.action}`);
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) rets.push(Math.abs((bars[i].close - bars[i - 1].close) / bars[i - 1].close));
  check('重标定后单日最大|收益|<5%（假跳变被消除）', Math.max(...rets) < 0.05, `got ${(Math.max(...rets) * 100).toFixed(1)}%`);
  // 边界语义：平滑趋势 0.5%/日 + ×3.25 → 断裂日实际收益≈226%，pct 记录应落在 200%~250%
  check('断裂幅度记录在 200%~250% 区间', findings[0] && findings[0].pct > 200 && findings[0].pct < 250, `got ${findings[0]?.pct}`);
}

// ---- 2) 合法连续涨跌停（20% 涨停 + 10% 跌停，VWAP 带噪声）→ 候选但不改数据 ----
{
  const closes: number[] = [10];
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 1.2); // 连续 20% 涨停
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 0.9); // 连续 10% 跌停
  const dates = tradingDates(closes.length);
  const originals = barsFromCloses(closes, dates);
  const { bars, findings, rescaledCount } = detectAndFixBreaks(barsFromCloses(closes, dates));
  check('连续涨跌停进入候选筛（合法但超 12% 阈值）', findings.length >= 1, `got ${findings.length}`);
  check('连续涨跌停零重标定（VWAP 同向平稳=合法行情）', rescaledCount === 0, `got ${rescaledCount}`);
  const changed = bars.some((b, i) => Math.abs(b.close - originals[i].close) > 1e-9);
  check('连续涨跌停序列一根 K 线都不被改', !changed, '序列被误改');
  check('全部候选分类为 warn-only', findings.every((f) => f.action === 'warn-only'), `got ${JSON.stringify(findings.map((f) => f.action))}`);
}

// ---- 3) 复刻 510500 事故：hfq 基准切换（close 跳 3.25 倍而 VWAP 平稳）→ 必须重标定 ----
{
  // 前 30 日 close≈10、VWAP≈32.6（hfq 比值 0.307）；第 30 日上游把复权基准切到市价
  // 体系（close≈VWAP≈32.6，比值≈1.0）——比值跳变远超 15% 漂移阈值。
  const rows: StagingBar[] = [];
  const dates = tradingDates(60);
  for (let i = 0; i < 30; i++) rows.push({ tradeDate: dates[i], open: 10, high: 10, low: 10, close: 10, volume: 1000, amount: 32600 });
  for (let i = 30; i < 60; i++) rows.push({ tradeDate: dates[i], open: 32.6, high: 32.6, low: 32.6, close: 32.6, volume: 1000, amount: 32600 });
  const { bars, findings, rescaledCount } = detectAndFixBreaks(rows);
  check('510500 式事故检出 1 处断裂', findings.length === 1, `got ${JSON.stringify(findings)}`);
  check('510500 式事故重标定 1 次', rescaledCount === 1, `got ${rescaledCount}`);
  // factor = ratioBefore/ratioAfter = 0.307/1.0 ≈ 0.307 → 断裂后价格 ×0.307 → 32.6×0.307≈10.0
  check('重标定后价格回到断裂前基准（≈10）', Math.abs(bars[bars.length - 1].close - 10) < 0.5, `got ${bars[bars.length - 1].close.toFixed(3)}`);
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) rets.push(Math.abs((bars[i].close - bars[i - 1].close) / bars[i - 1].close));
  check('重标定后单日最大|收益|<5%', Math.max(...rets) < 0.05, `got ${(Math.max(...rets) * 100).toFixed(1)}%`);
}

// ---- 4) 1990s 无涨跌停制度：超界跳变不得检测/重标定（日期下限） ----
{
  const closes: number[] = [10];
  for (let i = 1; i < 30; i++) closes.push(closes[i - 1] * 1.4); // 1994 式连续暴涨
  const dates = tradingDates(30, '1994-08-01');
  const { findings, rescaledCount } = detectAndFixBreaks(barsFromCloses(closes, dates));
  check('1990s 超界跳变零候选（涨跌停制度前不检测）', findings.length === 0, `got ${JSON.stringify(findings)}`);
  check('1990s 超界跳变零重标定', rescaledCount === 0, `got ${rescaledCount}`);
}

// ---- 5) 复刻 510300 事故：ETF 分红除权（-21.7%、VWAP 平稳、factor≈1.244）→ 必须重标定 ----
{
  // 前 30 日 close≈5.64、VWAP≈4.53（hfq 比值 1.244）；第 30 日切换复权基准
  // （close≈4.42、VWAP≈4.43，比值≈1.0）。三旧阈值（30% 收益/30% 漂移/1.5 guard）全漏报。
  const rows: StagingBar[] = [];
  const dates = tradingDates(60);
  for (let i = 0; i < 30; i++) rows.push({ tradeDate: dates[i], open: 5.64, high: 5.64, low: 5.64, close: 5.64, volume: 10000, amount: 45300 });
  for (let i = 30; i < 60; i++) rows.push({ tradeDate: dates[i], open: 4.42, high: 4.42, low: 4.42, close: 4.42, volume: 10000, amount: 44300 });
  const { bars, findings, rescaledCount } = detectAndFixBreaks(rows);
  check('510300 式温和断裂检出 1 处', findings.length === 1, `got ${JSON.stringify(findings)}`);
  check('510300 式温和断裂重标定 1 次', rescaledCount === 1, `got ${rescaledCount}`);
  // 精确断言（ tribunal G2c5：旧版 ±0.3 容差是残差 2.4 倍的模糊带）：
  // factor = ratioBefore/ratioAfter = (5.64/4.53)/(4.42/4.43) ≈ 1.2476，断裂后价格 ×factor
  // → 4.42×1.2476 = 5.5145（语义是缩回断裂前的 close/vwap 比值基准，非"回到 5.64"）
  const expected = 4.42 * (5.64 / 4.53) / (4.42 / 4.43);
  check(
    '重标定后末值=精确计算值 5.5145（±0.01）',
    Math.abs(bars[bars.length - 1].close - expected) < 0.01,
    `got ${bars[bars.length - 1].close.toFixed(4)} expected ${expected.toFixed(4)}`,
  );
  const rets: number[] = [];
  for (let i = 1; i < bars.length; i++) rets.push(Math.abs((bars[i].close - bars[i - 1].close) / bars[i - 1].close));
  check('重标定后单日最大|收益|<5%', Math.max(...rets) < 0.05, `got ${(Math.max(...rets) * 100).toFixed(1)}%`);
}

// ---- 6) VWAP 数据缺失（volume=0）→ 诚实跳过，绝不捏造"当日收益 0"重标定 ----
{
  // tribunal V5：旧兜底分支在 VWAP 窗口为空时假设断裂日真实收益≈0（factor=pc/close），
  // guard 收紧后合法 +20% 涨停会被重标定 −16.7%。新语义：VWAP 缺失一律不动作。
  const closes: number[] = [10];
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 1.2); // 合法连续涨停
  const dates = tradingDates(closes.length);
  const rows: StagingBar[] = closes.map((c, i) => ({
    tradeDate: dates[i], open: c, high: c, low: c, close: c, volume: 0, amount: 0, // 无成交数据
  }));
  const { bars, findings, rescaledCount } = detectAndFixBreaks(rows);
  check('VWAP 缺失时零重标定（不捏造收益 0）', rescaledCount === 0, `got ${rescaledCount}`);
  check('VWAP 缺失时候选分类为 warn-only', findings.every((f) => f.action === 'warn-only'), `got ${JSON.stringify(findings.map((f) => f.action))}`);
  const changed = bars.some((b, i) => Math.abs(b.close - closes[i]) > 1e-9);
  check('VWAP 缺失时序列一根 K 线都不被改', !changed, '序列被误改');
}

// ---- 7) 阈值边界：12% 附近的候选筛行为（留浮点余量，不测 12.0% 整——float 表示误差） ----
{
  const mk = (mult: number): StagingBar[] => {
    const closes = [10, 10 * mult];
    while (closes.length < 25) closes.push(closes[closes.length - 1] * 1.001); // 拖尾满足窗口
    return barsFromCloses(closes, tradingDates(closes.length));
  };
  check('单日 +11.9%（阈值内）不进候选', detectAndFixBreaks(mk(1.119)).findings.length === 0);
  check('单日 +13%（阈值外）进候选', detectAndFixBreaks(mk(1.13)).findings.length === 1);
  check('单日 −13%（阈值外）进候选', detectAndFixBreaks(mk(0.87)).findings.length === 1);
  check('单日 −11.9%（阈值内）不进候选', detectAndFixBreaks(mk(0.881)).findings.length === 0);
}

// ---- 8) amount 单位同向变化的 mask 风险 → 记录当前行为（已知限制，非正确性断言） ----
{
  // ⚠️ 已知限制：VWAP=amount/volume 直算，无单位甄别。若上游换源同时把 close 口径和
  // amount 单位同倍改变（close×3.25 且 amount×3.25），close/vwap 比值不变 → 复权断裂
  // 被 mask 成 warn-only 漏报。腾讯源单位稳定，暂不加防护；此用例钉住该风险行为，
  // 将来若加单位/口径交叉校验需同步改这里。
  const dates = tradingDates(60);
  const rows: StagingBar[] = [];
  for (let i = 0; i < 30; i++) rows.push({ tradeDate: dates[i], open: 10, high: 10, low: 10, close: 10, volume: 1000, amount: 10000 });
  for (let i = 30; i < 60; i++) rows.push({ tradeDate: dates[i], open: 32.5, high: 32.5, low: 32.5, close: 32.5, volume: 1000, amount: 32500 }); // 同向×3.25
  const { findings, rescaledCount } = detectAndFixBreaks(rows);
  check('close 与 amount 同向×3.25 进候选（close 跳变可见）', findings.length === 1, `got ${JSON.stringify(findings)}`);
  check('同向变化 mask 掉断裂：零重标定（已知限制行为基线）', rescaledCount === 0, `got ${rescaledCount}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
