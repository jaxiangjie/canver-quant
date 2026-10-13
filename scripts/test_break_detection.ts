/**
 * 复权断裂检测验证（对齐 quant-lab code/quant_rules/tests/test_carver.py 的合成断裂测试）：
 * 1) 平滑序列 ×3.25 单日放大 → 必须检出
 * 2) volume/amount 单位变化（×100）致 VWAP 跳变 → 不得误报为收益断裂
 * 3) 真实 20% 涨停（双创）→ 不得误报
 * 运行：npx tsx scripts/test_break_detection.ts
 */

/** 与 realData.ts 相同的检测逻辑（复刻，供单测隔离验证） */
function detectBreaks(closes: number[]): string[] {
  const BREAK_THRESHOLD = 0.12;
  const out: string[] = [];
  for (let i = 1; i < closes.length; i++) {
    const pc = closes[i - 1];
    if (pc > 0) {
      const r = (closes[i] - pc) / pc;
      if (Math.abs(r) > BREAK_THRESHOLD) out.push(`day${i}(${(r * 100).toFixed(0)}%)`);
    }
  }
  return out;
}

/** 复刻 realData.ts 的 VWAP 甄别 + 重标定（返回修复后的 closes） */
function rescaleBreaks(
  rows: { close: number; amount: number; volume: number }[],
  dates: string[],
): { closes: number[]; rescaled: number } {
  const BREAK_THRESHOLD = 0.12;
  const LIMIT_UP_ERA_START = '1996-12-16';
  const RATIO_DRIFT = 0.15;
  const W = 10;
  const closes = rows.map((r) => r.close);
  const vwapAt = rows.map((r) => (r.volume > 0 && r.amount > 0 ? r.amount / r.volume : 0));
  const medianOf = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  let rescaled = 0;
  for (let i = 1; i < closes.length; i++) {
    const pc = closes[i - 1];
    if (pc <= 0) continue;
    if (dates[i] < LIMIT_UP_ERA_START) continue;
    const r = (closes[i] - pc) / pc;
    if (Math.abs(r) <= BREAK_THRESHOLD) continue;
    const before: number[] = [];
    for (let j = Math.max(0, i - W); j < i; j++) if (vwapAt[j] > 0) before.push(closes[j] / vwapAt[j]);
    const after: number[] = [];
    for (let j = i; j < Math.min(closes.length, i + W); j++) if (vwapAt[j] > 0) after.push(closes[j] / vwapAt[j]);
    const ratioBefore = medianOf(before);
    const ratioAfter = medianOf(after);
    let factor = 0;
    if (ratioBefore > 0 && ratioAfter > 0 && Math.abs(ratioAfter / ratioBefore - 1) > RATIO_DRIFT) {
      factor = ratioBefore / ratioAfter;
    } else if (before.length === 0 || after.length === 0) {
      factor = pc / closes[i];
    }
    if (factor > 0 && (factor < 0.95 || factor > 1.05)) {
      for (let j = i; j < closes.length; j++) closes[j] *= factor;
      rescaled++;
    }
  }
  return { closes, rescaled };
}

/** 与 realData.ts 相同的 VWAP 稳定化逻辑（防 volume/amount 单位变化误报） */
function stableVwap(rows: { amount: number; volume: number }[]): number {
  const vwapSeries: number[] = [];
  for (const r of rows) {
    if (r.volume > 0 && r.amount > 0) vwapSeries.push(r.amount / r.volume);
  }
  if (!vwapSeries.length) return 0;
  const recent = vwapSeries.slice(-60);
  const sorted = [...recent].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const stable = recent.filter((v) => v > med * 0.5 && v < med * 2);
  return stable.length ? stable[stable.length - 1] : med;
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

// ---- 1) 合成复权断裂：平滑上涨序列中单日 ×3.25 ----
{
  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(10 * (1 + 0.005 * i));
  const breakAt = 30;
  for (let i = breakAt; i < closes.length; i++) closes[i] *= 3.25; // 复权因子断裂
  const breaks = detectBreaks(closes);
  check('合成×3.25断裂被检出', breaks.length === 1, `got ${JSON.stringify(breaks)}`);
  // 序列自带 0.5%/日趋势，×3.25 的实际单日收益≈226%（区间断言，非精确值）
  check(
    '断裂幅度在 220%~230% 区间',
    breaks.length === 1 && /\(2[12]\d%\)/.test(breaks[0]),
    `got ${JSON.stringify(breaks)}`,
  );
}

// ---- 2) volume/amount 单位变化（手→股 ×100）：VWAP 不得误报，且稳定值应回归真实水平 ----
{
  // 前 40 日 amount 单位是"元"、后 20 日 amount 单位×100（模拟数据源单位变更）
  const rows: { amount: number; volume: number }[] = [];
  for (let i = 0; i < 40; i++) rows.push({ amount: 1000 * 10, volume: 1000 }); // vwap=10
  for (let i = 0; i < 20; i++) rows.push({ amount: 1000 * 10 * 100, volume: 1000 * 100 }); // vwap 仍=10
  const v = stableVwap(rows);
  check('单位变化后 VWAP 仍≈10（无跳变）', Math.abs(v - 10) < 0.01, `got ${v}`);
}
{
  // 单位变化只改 amount 不改 volume（真跳变场景）：稳定化应剔除离群、回到中位水平
  const rows: { amount: number; volume: number }[] = [];
  for (let i = 0; i < 40; i++) rows.push({ amount: 1000 * 10, volume: 1000 }); // vwap=10
  for (let i = 0; i < 20; i++) rows.push({ amount: 1000 * 10 * 100, volume: 1000 }); // vwap=1000（坏数据）
  const v = stableVwap(rows);
  check('amount 单边×100 被中位数稳定化（≈10 而非 1000）', Math.abs(v - 10) < 0.01, `got ${v}`);
}

// ---- 3) 合法极端日不得误改数据：双创 20% 涨停 / 普通 10% 涨停 / 连续涨跌停 ----
// 语义分层：detectBreaks 是「候选筛」（12% 阈值下 20% 涨停会进候选，允许）；
// 真正的判定在 rescaleBreaks 的 VWAP 连续性甄别——连续涨停日 VWAP 与 close 同向变动，
// close/vwap 比值平稳，不得重标定（只 warn 不误改数据）。
{
  const closes: number[] = [10];
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 1.2); // 连续 20% 涨停
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 0.9); // 连续 10% 跌停
  // 构造与 close 同向的 VWAP（涨停日收盘接近最高价，vwap≈close×0.97，比值平稳）
  const dates = closes.map((_, i) => `2026-08-${String((i % 28) + 1).padStart(2, '0')}`);
  const rows = closes.map((c, i) => ({ close: c, amount: c * 0.97 * 1000, volume: 1000 }));
  const { closes: fixed, rescaled } = rescaleBreaks(rows, dates);
  check('连续20%涨停+10%跌停不重标定（VWAP 同向，合法行情）', rescaled === 0, `got ${rescaled}`);
  const changed = fixed.some((c, i) => Math.abs(c - closes[i]) > 1e-9);
  check('连续涨跌停序列一根 K 线都不被改', !changed, '序列被误改');
}

// ---- 4) 复刻 510500 事故：hfq 基准切换（close 跳 3.25 倍而 VWAP 平稳）→ 必须重标定 ----
{
  // 60 个交易日：前 30 日 close≈10、VWAP≈32.6（比值 0.307）；第 30 日数据源把 hfq 基准
  // 换成市价水平（close≈VWAP≈32.6），之后保持。模拟 510500 2026-09-01 事故。
  const rows: { close: number; amount: number; volume: number }[] = [];
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ close: 10, amount: 32600, volume: 1000 });
    dates.push(`2026-08-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  for (let i = 0; i < 30; i++) {
    rows.push({ close: 32.6, amount: 32600, volume: 1000 });
    dates.push(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  const before = detectBreaks(rows.map((r) => r.close));
  check('事故序列检出 1 处断裂', before.length === 1, `got ${JSON.stringify(before)}`);
  const { closes, rescaled } = rescaleBreaks(rows, dates);
  check('重标定执行 1 次', rescaled === 1, `got ${rescaled}`);
  const after = detectBreaks(closes);
  check('重标定后断裂清零', after.length === 0, `got ${JSON.stringify(after)}`);
  // 重标定后最后值应回到断裂前水平（≈10），而非 32.6
  check(
    '重标定后价格回到断裂前基准（≈10）',
    Math.abs(closes[closes.length - 1] - 10) < 0.5,
    `got ${closes[closes.length - 1].toFixed(2)}`,
  );
  // 收益率序列恢复连续：重标定后 120 日等窗口的 std 不再被单日假跳变撑爆
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const maxAbs = Math.max(...rets.map(Math.abs));
  check('重标定后单日最大|收益|<5%', maxAbs < 0.05, `got ${(maxAbs * 100).toFixed(1)}%`);
}

// ---- 5) 1990s 无涨跌停：超界跳变不得被检测/重标定（日期下限） ----
{
  const closes: number[] = [10];
  for (let i = 1; i < 30; i++) closes.push(closes[i - 1] * 1.4); // 1994 式连续暴涨
  const dates = closes.map((_, i) => (i < 10 ? `1994-08-${String(i + 1).padStart(2, '0')}` : `1994-09-${String(i - 9).padStart(2, '0')}`));
  const { closes: fixed, rescaled } = rescaleBreaks(
    closes.map((c) => ({ close: c, amount: c * 100, volume: 100 })),
    dates,
  );
  check('1990s 超界跳变不重标定（涨跌停制度前）', rescaled === 0, `got ${rescaled}`);
}

// ---- 6) 复刻 510300 事故：ETF 分红除权（close -21.7%、VWAP 平稳、factor≈1.25）→ 必须重标定 ----
{
  // 60 个交易日：前 30 日 close≈5.64、VWAP≈4.53（比值 1.244，hfq 体系）；
  // 第 30 日上游切换复权基准到近市价体系（close≈4.42、VWAP≈4.43，比值≈1.0）。
  // 关键：收益 -21.7% 低于旧的 30% 阈值、比值跳变 19.9% 低于旧的 30% 漂移阈值、factor 1.25
  // 低于旧的 1.5 倍 guard——三旧阈值全部漏报，新阈值（12%/15%/1.05）必须抓住。
  const rows: { close: number; amount: number; volume: number }[] = [];
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) {
    rows.push({ close: 5.64, amount: 45300, volume: 10000 });
    dates.push(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  for (let i = 0; i < 30; i++) {
    rows.push({ close: 4.42, amount: 44300, volume: 10000 });
    dates.push(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`);
  }
  const { closes, rescaled } = rescaleBreaks(rows, dates);
  check('510300 式温和断裂被重标定', rescaled === 1, `got ${rescaled}`);
  const after = detectBreaks(closes);
  check('重标定后断裂清零', after.length === 0, `got ${JSON.stringify(after)}`);
  // 重标定后价格应回到断裂前 hfq 基准（≈5.64），而非 4.42
  check(
    '重标定后回到断裂前基准（≈5.64）',
    Math.abs(closes[closes.length - 1] - 5.64) < 0.3,
    `got ${closes[closes.length - 1].toFixed(3)}`,
  );
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const maxAbs = Math.max(...rets.map(Math.abs));
  check('重标定后单日最大|收益|<5%', maxAbs < 0.05, `got ${(maxAbs * 100).toFixed(1)}%`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
