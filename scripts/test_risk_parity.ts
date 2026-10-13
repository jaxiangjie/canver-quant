// 复刻修复后的 calculateRiskParityAllocation 逻辑做数值验证（与 customPortfolioStore.ts 同步维护）
interface TestItem {
  id: string;
  code: string;
  annualizedVol?: number;
}
function alloc(items: TestItem[], totalCapital: number): Map<string, number> {
  const result = new Map();
  if (!items.length || totalCapital <= 0) return result;
  const participable = items.filter(it => it.code !== 'CASH');
  if (!participable.length) {
    items.forEach(it => result.set(it.id, 0));
    return result;
  }
  const invVols = participable.map(it => ({ id: it.id, invVol: 1 / Math.max(0.05, it.annualizedVol ?? 0.25) }));
  const sumInv = invVols.reduce((s, x) => s + x.invVol, 0);
  if (sumInv <= 0) {
    items.forEach(it => result.set(it.id, 0));
    return result;
  }
  let allocated = 0;
  let maxInvVolId = invVols[0].id;
  invVols.forEach(x => {
    if (x.invVol > (invVols.find(v => v.id === maxInvVolId)?.invVol ?? 0)) maxInvVolId = x.id;
    const amt = Math.round((x.invVol / sumInv) * totalCapital / 100) * 100;
    result.set(x.id, amt);
    allocated += amt;
  });
  result.set(maxInvVolId, (result.get(maxInvVolId) ?? 0) + (totalCapital - allocated));
  items.forEach(it => {
    if (it.code === 'CASH') result.set(it.id, 0);
  });
  return result;
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
const s1 = [
  { id: 'a', code: '513180.SH', annualizedVol: 0.28 },
  { id: 'b', code: '562500.SH', annualizedVol: 0.35 },
  { id: 'c', code: '512890.SH', annualizedVol: 0.14 },
  { id: 'd', code: '601288.SH', annualizedVol: 0.23 },
  { id: 'e', code: '518880.SH', annualizedVol: 0.21 },
  { id: 'f', code: '511010.SH', annualizedVol: 0.05 },
  { id: 'g', code: 'CASH', annualizedVol: 0.01 },
];
const r1 = alloc(s1, 420000);
const sum1 = [...r1.values()].reduce((a, b) => a + b, 0);
check('含CASH: 精确满仓 420000', sum1 === 420000, 'got ' + sum1);
check('含CASH: CASH 清零', r1.get('g') === 0, 'got ' + r1.get('g'));
check('含CASH: 全部7项都有分配(无code覆盖丢失)', [...r1.values()].filter(v => v !== undefined).length === 7);
console.log(
  '  权重分布:',
  s1.map(it => it.code + '=' + (((r1.get(it.id) || 0) / 4200)).toFixed(1) + '%').join(', ')
);

// 场景2：无 CASH 的 9 腿 100 万（官方基准 balanced9 同构）
const s2 = [0.22, 0.25, 0.32, 0.14, 0.05, 0.18, 0.23, 0.28, 0.24].map((v, i) => ({
  id: 'p' + i,
  code: 'c' + i,
  annualizedVol: v,
}));
const r2 = alloc(s2, 1000000);
const sum2 = [...r2.values()].reduce((a, b) => a + b, 0);
check('无CASH 9腿: 精确满仓 1000000', sum2 === 1000000, 'got ' + sum2);

// 场景3：重复添加同一 code（同 code 覆盖 bug 回归）
const s3 = [
  { id: 'x1', code: '510300.SH', annualizedVol: 0.22 },
  { id: 'x2', code: '510300.SH', annualizedVol: 0.22 },
  { id: 'x3', code: '511010.SH', annualizedVol: 0.05 },
];
const r3 = alloc(s3, 300000);
const sum3 = [...r3.values()].reduce((a, b) => a + b, 0);
check('重复code: 3项都有非零分配', (r3.get('x1') ?? 0) > 0 && (r3.get('x2') ?? 0) > 0, JSON.stringify([...r3]));
check('重复code: 精确满仓 300000', sum3 === 300000, 'got ' + sum3);

// 场景4：非整资金额也能精确满仓
const s4 = [0.25, 0.25, 0.25, 0.25].map((v, i) => ({ id: 'q' + i, code: 'd' + i, annualizedVol: v }));
const r4 = alloc(s4, 123457);
const sum4 = [...r4.values()].reduce((a, b) => a + b, 0);
check('非整资金 123457: 精确满仓', sum4 === 123457, 'got ' + sum4);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
