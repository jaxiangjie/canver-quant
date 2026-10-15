// calculateRiskParityAllocation 数值验证（2026-10-14 重写，tribunal V3）
// 直接测生产函数（不再复刻副本——副本曾让等权变异体全过，保护的是复印件不是生产代码）。
import { calculateRiskParityAllocation } from '../src/services/customPortfolioStore';

interface TestItem {
  id: string;
  code: string;
  annualizedVol?: number;
}

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, detail);
  }
};

// 场景1：含 CASH 的 42 万组合（用户遭遇的场景，官方预设 user_optimized_carver 同构）
// 1/vol 手算期望值（vol 下限 0.05 生效）：
//   a=1/0.28=3.5714, b=1/0.35=2.8571, c=1/0.14=7.1429, d=1/0.23=4.3478,
//   e=1/0.21=4.7619, f=1/0.05=20, sumInv=42.6812 → 金额（百元取整+残差归 f）
const s1: TestItem[] = [
  { id: 'a', code: '513180.SH', annualizedVol: 0.28 },
  { id: 'b', code: '562500.SH', annualizedVol: 0.35 },
  { id: 'c', code: '512890.SH', annualizedVol: 0.14 },
  { id: 'd', code: '601288.SH', annualizedVol: 0.23 },
  { id: 'e', code: '518880.SH', annualizedVol: 0.21 },
  { id: 'f', code: '511010.SH', annualizedVol: 0.05 },
  { id: 'g', code: 'CASH', annualizedVol: 0.01 },
];
const r1 = calculateRiskParityAllocation(s1, 420000);
const sum1 = [...r1.values()].reduce((a, b) => a + b, 0);
check('含CASH: 精确满仓 420000', sum1 === 420000, 'got ' + sum1);
check('含CASH: CASH 清零', r1.get('g') === 0, 'got ' + r1.get('g'));
check('含CASH: 7 项全部有显式分配', r1.size === 7, 'got ' + r1.size);
// 核心契约：权重 ∝ 1/vol（等权变异体必须在此挂掉）
const expectS1: Record<string, number> = { a: 35100, b: 28100, c: 70300, d: 42800, e: 46900, f: 196800, g: 0 };
for (const [id, expect] of Object.entries(expectS1)) {
  check(`含CASH: ${id} 分到 ${expect}（1/vol 契约）`, r1.get(id) === expect, 'got ' + r1.get(id));
}
// 残差归 invVol 最大项 f（1/0.05=20）
check('含CASH: 残差吸收者是 f（最大 invVol）', r1.get('f') === 196800, 'got ' + r1.get('f'));
console.log(
  '  权重分布:',
  s1.map(it => it.code + '=' + (((r1.get(it.id) || 0) / 4200)).toFixed(1) + '%').join(', ')
);

// 场景2：无 CASH 的 9 腿 100 万（官方基准 balanced9 同构）
const s2: TestItem[] = [0.22, 0.25, 0.32, 0.14, 0.05, 0.18, 0.23, 0.28, 0.24].map((v, i) => ({
  id: 'p' + i,
  code: 'c' + i,
  annualizedVol: v,
}));
const r2 = calculateRiskParityAllocation(s2, 1000000);
const sum2 = [...r2.values()].reduce((a, b) => a + b, 0);
check('无CASH 9腿: 精确满仓 1000000', sum2 === 1000000, 'got ' + sum2);
// 比例性抽查：invVol 之比 ≈ 金额之比（±100 容整百取整）
const invOf = (v: number) => 1 / Math.max(0.05, v);
const sumInv2 = s2.reduce((s, it) => s + invOf(it.annualizedVol!), 0);
let propOk = true;
for (const it of s2) {
  const expect = Math.round((invOf(it.annualizedVol!) / sumInv2) * 1000000 / 100) * 100;
  if (Math.abs((r2.get(it.id) ?? -1) - expect) > 100) propOk = false;
}
check('无CASH 9腿: 各项金额 ∝ 1/vol（±100 容差）', propOk);

// 场景3：重复添加同一 code（同 code 覆盖 bug 回归——按 item.id 分配，两条都拿到钱）
const s3: TestItem[] = [
  { id: 'x1', code: '510300.SH', annualizedVol: 0.22 },
  { id: 'x2', code: '510300.SH', annualizedVol: 0.22 },
  { id: 'x3', code: '511010.SH', annualizedVol: 0.05 },
];
const r3 = calculateRiskParityAllocation(s3, 300000);
const sum3 = [...r3.values()].reduce((a, b) => a + b, 0);
check('重复code: 3项都有非零分配', (r3.get('x1') ?? 0) > 0 && (r3.get('x2') ?? 0) > 0 && (r3.get('x3') ?? 0) > 0, JSON.stringify([...r3]));
check('重复code: 精确满仓 300000', sum3 === 300000, 'got ' + sum3);

// 场景4：非整资金 + 非等 vol——残差必须归 invVol 最大项（q3: 1/0.1=10）
const s4: TestItem[] = [
  { id: 'q0', code: 'd0', annualizedVol: 0.25 },
  { id: 'q1', code: 'd1', annualizedVol: 0.25 },
  { id: 'q2', code: 'd2', annualizedVol: 0.2 },
  { id: 'q3', code: 'd3', annualizedVol: 0.1 },
];
const r4 = calculateRiskParityAllocation(s4, 123457);
const sum4 = [...r4.values()].reduce((a, b) => a + b, 0);
check('非整资金 123457: 精确满仓', sum4 === 123457, 'got ' + sum4);
// 残差吸收者验证：把残差从 q3 拿走后会不满仓（证明残差确实归了 q3 而非第一项）
const withoutQ3Residual = sum4 - (r4.get('q3') ?? 0);
check('非整资金: 残差归最大 invVol 项 q3', withoutQ3Residual !== 123457 && (r4.get('q3') ?? 0) > 30000, 'q3=' + r4.get('q3'));

// 场景5（tribunal B2c4 补）：纯 CASH 组合 → 全部显式 0
const s5: TestItem[] = [{ id: 'c0', code: 'CASH', annualizedVol: 0.01 }];
const r5 = calculateRiskParityAllocation(s5, 420000);
check('纯CASH: 全部置 0 且显式存在', r5.get('c0') === 0 && r5.size === 1, JSON.stringify([...r5]));

// 场景6（tribunal B2c4 补）：空组合 / 零资金 / NaN 资金 → 不产 NaN、不假成功
const r6a = calculateRiskParityAllocation([], 420000);
check('空组合: 返回空 map', r6a.size === 0);
const r6b = calculateRiskParityAllocation(s2, 0);
check('零资金: 每项显式 0（无 NaN）', r6b.size === 9 && [...r6b.values()].every(v => v === 0));
const r6c = calculateRiskParityAllocation(s2, NaN);
check('NaN 资金: 每项显式 0（不静默 NaN）', r6c.size === 9 && [...r6c.values()].every(v => Number.isFinite(v)));

// 场景7（tribunal B2c4 补）：NaN/负/未定义 vol → 落 0.25 默认，不污染、不爆炸
const s7: TestItem[] = [
  { id: 'n0', code: 'e0', annualizedVol: NaN },
  { id: 'n1', code: 'e1', annualizedVol: -0.5 },
  { id: 'n2', code: 'e2', annualizedVol: undefined },
  { id: 'n3', code: 'e3', annualizedVol: 0.25 },
];
const r7 = calculateRiskParityAllocation(s7, 400000);
const sum7 = [...r7.values()].reduce((a, b) => a + b, 0);
check('脏vol: 无 NaN 且精确满仓', sum7 === 400000 && [...r7.values()].every(v => Number.isFinite(v)), 'sum=' + sum7);
// 三个脏 vol 都按 0.25 计（invVol=4），与 n3 相同 → 四项均分
check('脏vol: 均按 0.25 默认（四项各 10 万）', (r7.get('n0') ?? 0) === 100000 && (r7.get('n1') ?? 0) === 100000 && (r7.get('n2') ?? 0) === 100000 && (r7.get('n3') ?? 0) === 100000, JSON.stringify([...r7]));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
