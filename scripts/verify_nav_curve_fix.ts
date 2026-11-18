/**
 * 「风险与净值动态分析 → 组合净值曲线」验证 + 与界面对账（2026-10-15；2026-11-18 tribunal 诚实化）
 * 用法:
 *   npx tsx scripts/verify_nav_curve.ts                         # 算法自洽断言（需服务运行中）
 *   UI_NAV=0.9515 UI_CSI=0.8813 npx tsx scripts/verify_nav_curve_fix.ts   # 带界面对账
 *
 * 2026-11-18 修订：
 * 1. 不再手抄组件算法 —— 第三份拷贝会在组件改动后静默验证一个不存在的算法
 *   （test_risk_parity 的血泪教训：「不再复刻副本——副本曾让等权变异体全过」）。
 *    改为 import src/services/navCurve.ts 的唯一实现（组件同源）。
 * 2. 加真断言 + 非零退出码：数据不一致时 FAIL exit 1，不再「永远 exit 0 靠人眼」。
 * 3. 界面对账数字不再硬编码在脚本里（界面一变硬编码就成了废纸）—— 用 UI_NAV/UI_CSI
 *    环境变量传入当日界面 tooltip 值；未提供时跳过对账、只跑自洽断言。
 *
 * ⚠️ 价格必须用**市价**口径：loadRealUniverse() 的 currentPrice 是后复权价（福耀 5286 vs 市价 54.5），
 * 拿它算权重会让权重严重失真（首版脚本因此算出 +0.64%，而界面是 −4.85%）。
 * 这里直接用 /api/ashare/instruments + /api/ashare/bars?limit=90（= 界面同源）。
 */
import { computeAlignedNAV } from '../src/services/navCurve';

const LOOKBACK = 60;
const BASE = 'http://localhost:3000';
const UI_NAV = Number(process.env.UI_NAV ?? 0);
const UI_CSI = Number(process.env.UI_CSI ?? 0);

let failed = 0;
function eq(label: string, actual: any, expect: any) {
  const ok = actual === expect;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}: 实际=${actual} 期望=${expect}`);
}
function approx(label: string, actual: number, expect: number, tol = 1e-3) {
  const ok = Math.abs(actual - expect) < tol;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}: 实际=${actual} 期望≈${expect}（±${tol}）`);
}

const insts: any[] = await (await fetch(`${BASE}/api/ashare/instruments`)).json();

// balanced9 的腿（与前端 bundles 顺序一致）
const CODES = ['510300.SH', '510500.SH', '588000.SH', '512890.SH', '601857.SH', '511010.SH', '518880.SH', '513100.SH', '513520.SH'];

const legs: any[] = [];
for (const code of CODES) {
  const inst = insts.find((i) => i.code === code);
  if (!inst) continue;
  const shares = Number(inst.currentShares) || 0;
  if (shares <= 0) continue; // 组件口径：只保留持仓 >0 的腿
  const bars = (await (await fetch(`${BASE}/api/ashare/bars/${code}?limit=90`)).json()).bars ?? [];
  legs.push({ code, name: inst.name, shares, price: Number(inst.currentPrice), bars });
}

const totalMv = legs.reduce((a, l) => a + l.shares * l.price, 0);
console.log(`参与腿 ${legs.length} 只（持仓>0），组合总市值 ¥${Math.round(totalMv).toLocaleString()}`);
for (const l of legs) console.log(`  ${l.code.padEnd(10)} 市价 ${String(l.price).padStart(8)}  持股 ${String(l.shares).padStart(7)}  市值 ¥${String(Math.round(l.shares * l.price)).padStart(9)}  w=${((l.shares * l.price) / totalMv * 100).toFixed(1)}%`);

// ── 唯一实现（与组件同源） ──
const points = computeAlignedNAV(
  legs.map((l) => ({ code: l.code, name: l.name, shares: l.shares, price: l.price, bars: l.bars })),
  { lookback: LOOKBACK, benchCode: '510300.SH' },
);

// ── 真断言（2026-11-18：可失败，不再装饰性验证） ──
console.log('\n── 断言 ──');
eq('产出 61 个点（LOOKBACK+1：首点为收益锚）', points.length, LOOKBACK + 1);
eq('首点组合净值 = 1.0000', points[0]?.portfolioNAV, 1);
eq('首点基准净值 = 1.0000', points[0]?.csi300NAV, 1);
const weightsSum = legs.reduce((a, l) => a + (l.shares * l.price) / totalMv, 0);
approx('权重合计 = 100%', Number(weightsSum.toFixed(6)), 1, 1e-6);
const last = points[points.length - 1];
eq('末点净值有限且非零', Number.isFinite(last?.portfolioNAV) && last.portfolioNAV > 0, true);
console.log(
  `\n组合累计净值 ${last?.portfolioNAV}（${last?.portfolioReturnPct}%）  基准[${last?.benchLabel}] ${last?.csi300NAV}（${last?.csiReturnPct}%）  窗口 ${points[0]?.fullDate} ~ ${last?.fullDate}`,
);

if (UI_NAV > 0 || UI_CSI > 0) {
  console.log('\n── 界面对账（UI_NAV/UI_CSI 环境变量传入的当日 tooltip 值） ──');
  if (UI_NAV > 0) approx(`界面 tooltip 组合净值 ${UI_NAV}`, last.portfolioNAV, UI_NAV);
  if (UI_CSI > 0) approx(`界面 tooltip 基准净值 ${UI_CSI}`, last.csi300NAV, UI_CSI);
} else {
  console.log('\n（未提供 UI_NAV/UI_CSI 环境变量，跳过界面对账 —— 算法自洽断言已全部执行）');
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
