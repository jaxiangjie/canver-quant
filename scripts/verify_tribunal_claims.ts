// 复刻测试文件的 rescaleBreaks
function rescaleBreaks(rows: { close: number; amount: number; volume: number }[], dates: string[],
  BREAK_THRESHOLD = 0.12, RATIO_DRIFT = 0.15) {
  const W = 10;
  const closes = rows.map((r) => r.close);
  const vwapAt = rows.map((r) => (r.volume > 0 && r.amount > 0 ? r.amount / r.volume : 0));
  const medianOf = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  let rescaled = 0;
  for (let i = 1; i < closes.length; i++) {
    const pc = closes[i - 1];
    if (pc <= 0) continue;
    if (dates[i] < '1996-12-16') continue;
    const r = (closes[i] - pc) / pc;
    if (Math.abs(r) <= BREAK_THRESHOLD) continue;
    const before: number[] = []; for (let j = Math.max(0, i - W); j < i; j++) if (vwapAt[j] > 0) before.push(closes[j] / vwapAt[j]);
    const after: number[] = []; for (let j = i; j < Math.min(closes.length, i + W); j++) if (vwapAt[j] > 0) after.push(closes[j] / vwapAt[j]);
    const ratioBefore = medianOf(before), ratioAfter = medianOf(after);
    let factor = 0;
    if (ratioBefore > 0 && ratioAfter > 0 && Math.abs(ratioAfter / ratioBefore - 1) > RATIO_DRIFT) factor = ratioBefore / ratioAfter;
    else if (before.length === 0 || after.length === 0) factor = pc / closes[i];
    if (factor > 0 && (factor < 0.95 || factor > 1.05)) { for (let j = i; j < closes.length; j++) closes[j] *= factor; rescaled++; }
  }
  return { closes, rescaled };
}

// c1: test3 夹具 —— vwap ≡ close*0.97，比值恒定
{
  const closes: number[] = [10];
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 1.2);
  for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1] * 0.9);
  const dates = closes.map((_, i) => `2026-08-${String((i % 28) + 1).padStart(2, '0')}`);
  const rows = closes.map((c) => ({ close: c, amount: c * 0.97 * 1000, volume: 1000 }));
  const ratios = rows.map((r) => r.close / (r.amount / r.volume));
  console.log('c1 close/vwap 比值(应恒为 1/0.97=1.03093):', ratios[0].toFixed(6), '全部相同:', new Set(ratios.map((x) => x.toFixed(9))).size === 1);
  let counter = 0;
  for (const bt of [0.001, 0.12, 0.19, 0.5]) for (const rd of [0.001, 0.15, 5]) {
    const { rescaled } = rescaleBreaks(rows.map((r) => ({ ...r })), dates, bt, rd);
    if (rescaled !== 0) { console.log(`c1 反例: bt=${bt} rd=${rd} rescaled=${rescaled}`); counter++; }
  }
  console.log(`c1 穷举 ${counter === 0 ? '无' : '有'}反例 → rescaled 对任何 (BREAK_THRESHOLD, RATIO_DRIFT) 恒为 0`);
}

// c2: fallback 分支 —— 前 10 日 volume=0(VWAP 缺失) + 合法 +20% 涨停
{
  const rows: { close: number; amount: number; volume: number }[] = [];
  const dates: string[] = [];
  for (let i = 0; i < 10; i++) { rows.push({ close: 10, amount: 0, volume: 0 }); dates.push(`2026-08-${String(i + 1).padStart(2, '0')}`); }
  for (let i = 0; i < 10; i++) { rows.push({ close: 12, amount: 12000, volume: 1000 }); dates.push(`2026-09-${String(i + 1).padStart(2, '0')}`); }
  const { closes, rescaled } = rescaleBreaks(rows, dates);
  console.log(`c2 fallback+20%涨停: factor=${(closes[10] / 12).toFixed(4)} (=1/1.2=${(1 / 1.2).toFixed(4)}), rescaled=${rescaled}, 末值=${closes[closes.length - 1].toFixed(3)}(原12→缩${((1 - closes[closes.length - 1] / 12) * 100).toFixed(1)}%)`);
  const oldGuard = (factor: number) => factor < 1 / 1.5 || factor > 1.5;
  console.log(`c2 旧 guard [1/1.5,1.5] 对 factor=0.8333: ${oldGuard(1 / 1.2) ? '触发重标定' : '不触发(no-op)'}；新 guard [0.95,1.05]: ${(1 / 1.2 < 0.95 || 1 / 1.2 > 1.05) ? '触发重标定' : '不触发'}`);
}

// c5: test6 真实修复值
{
  const rows: { close: number; amount: number; volume: number }[] = [];
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) { rows.push({ close: 5.64, amount: 45300, volume: 10000 }); dates.push(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`); }
  for (let i = 0; i < 30; i++) { rows.push({ close: 4.42, amount: 44300, volume: 10000 }); dates.push(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`); }
  const rb = 5.64 / 4.53, ra = 4.42 / 4.43, drift = Math.abs(ra / rb - 1), factor = rb / ra;
  console.log(`c5 ratioBefore=${rb.toFixed(6)} ratioAfter=${ra.toFixed(6)} drift=${(drift * 100).toFixed(2)}% factor=${factor.toFixed(6)}`);
  const { closes, rescaled } = rescaleBreaks(rows, dates);
  const rets: number[] = []; for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  console.log(`c5 rescaled=${rescaled} 修复后末值=${closes[closes.length - 1].toFixed(4)} (声称≈5.64, 残差${((5.64 - closes[closes.length - 1]) / 5.64 * 100).toFixed(2)}%) 最大|收益|=${(Math.max(...rets.map(Math.abs)) * 100).toFixed(2)}% (<5% 检查放行)`);
  console.log(`c5 断言窗口 ±0.3 = ±${(0.3 / 5.64 * 100).toFixed(2)}%, 是残差的 ${((0.3 / 5.64) / ((5.64 - closes[closes.length - 1]) / 5.64)).toFixed(2)}×`);
}

// c4: test6 日期单调性
{
  const dates: string[] = [];
  for (let i = 0; i < 30; i++) dates.push(`2026-09-${String((i % 28) + 1).padStart(2, '0')}`);
  for (let i = 0; i < 30; i++) dates.push(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`);
  let bad = 0;
  for (let i = 1; i < dates.length; i++) if (dates[i] < dates[i - 1]) { if (bad < 3) console.log(`c4 非单调: idx${i - 1}=${dates[i - 1]} → idx${i}=${dates[i]}`); bad++; }
  console.log(`c4 非单调点数: ${bad}`);
}
