/**
 * 数值验证：portfolioToBundle 转换规则（池外阻止 / 权重 / 覆盖语义）。
 * 运行：npx tsx scripts/test_portfolio_import.ts
 */
import { portfolioToBundle, IMPORTED_BUNDLE_ID } from '../src/services/customPortfolioStore';
import type { AShareInstrument, CustomPortfolio, CustomPortfolioItem } from '../src/types/ashare';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    pass++;
    console.log('PASS', name);
  } else {
    fail++;
    console.log('FAIL', name, detail ?? '');
  }
};

// 模拟 catalog（后缀 code 与裸码两种形态都有——tribunal B1c4：旧注释声称覆盖裸码
// 但 fixture 全是 .SH 后缀，注释与事实不符；现在补上真裸码条目）
const catalog: AShareInstrument[] = [
  { id: '510300', code: '510300.SH', name: '沪深300ETF' },
  { id: '511010', code: '511010.SH', name: '国债ETF' },
  { id: '518880', code: '518880.SH', name: '黄金ETF' },
  { id: '562500', code: '562500', name: '机器人ETF（裸码 catalog 条目）' }, // 无后缀形态
].map((c) => ({ ...c, bars: [] })) as unknown as AShareInstrument[];

const mkPortfolio = (items: Partial<CustomPortfolioItem>[], over: Partial<CustomPortfolio> = {}): CustomPortfolio =>
  ({
    id: 'test_p',
    name: '测试组合',
    description: '',
    totalCapital: 100000,
    updatedAt: new Date().toISOString(),
    items: items.map((it, i) => ({
      id: 'it' + i,
      code: '510300.SH',
      name: 'x',
      category: 'broad_etf',
      amount: 10000,
      ...it,
    })) as CustomPortfolioItem[],
    ...over,
  }) as CustomPortfolio;

// 1. 正常导入：amount 占比归一 + id 固定 imported + code 裸码化
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 60000 },
    { code: '511010.SH', amount: 40000 },
  ]);
  const r = portfolioToBundle(p, catalog);
  check('正常导入 ok', r.ok && !!r.bundle);
  check('bundle.id 固定 imported（覆盖语义）', r.bundle?.id === IMPORTED_BUNDLE_ID, String(r.bundle?.id));
  check('amount 占比权重 0.6/0.4', r.bundle?.items[0].riskBudgetWeight === 0.6 && r.bundle?.items[1].riskBudgetWeight === 0.4, JSON.stringify(r.bundle?.items));
  check('bundle item id 裸码化', r.bundle?.items[0].id === '510300');
}

// 2. 显式 riskBudgetWeight 优先并归一化
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 10000, riskBudgetWeight: 0.3 },
    { code: '511010.SH', amount: 10000, riskBudgetWeight: 0.1 },
  ]);
  const r = portfolioToBundle(p, catalog);
  check('显式权重优先（0.3/0.1 → 0.75/0.25）', r.bundle?.items[0].riskBudgetWeight === 0.75 && r.bundle?.items[1].riskBudgetWeight === 0.25, JSON.stringify(r.bundle?.items));
}

// 2b. 混合显式/未设权重 → 整体退化为 amount 占比（tribunal B1c2：旧版只测全显式 happy path）
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 80000, riskBudgetWeight: 0.9 },
    { code: '511010.SH', amount: 20000 }, // 未设 → allExplicit=false → 走 amount 占比
  ]);
  const r = portfolioToBundle(p, catalog);
  check(
    '混合显式/未设退化为 amount 占比（0.8/0.2，而非 0.9 显式值）',
    r.bundle?.items[0].riskBudgetWeight === 0.8 && r.bundle?.items[1].riskBudgetWeight === 0.2,
    JSON.stringify(r.bundle?.items),
  );
}

// 2c. 显式权重为零值 → 同样退化 amount 占比（every(>0) 门禁的另一半）
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 50000, riskBudgetWeight: 0 },
    { code: '511010.SH', amount: 50000, riskBudgetWeight: 0 },
  ]);
  const r = portfolioToBundle(p, catalog);
  check(
    '显式权重全 0 退化为 amount 占比（0.5/0.5）',
    r.bundle?.items[0].riskBudgetWeight === 0.5 && r.bundle?.items[1].riskBudgetWeight === 0.5,
    JSON.stringify(r.bundle?.items),
  );
}

// 3. 池外标的阻止导入
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 50000 },
    { code: '512660.SH', amount: 50000, name: '军工ETF' }, // 不在 catalog（562500 已在 5b 用例入 catalog）
  ]);
  const r = portfolioToBundle(p, catalog);
  check('池外标的阻止导入', !r.ok && r.missing.length === 1 && r.missing[0].includes('512660'), JSON.stringify(r.missing));
}

// 4. CASH 剔除折算为现金垫（不再阻止导入；纯 CASH 组合才阻止）
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 80000 },
    { code: 'CASH', amount: 20000 },
  ]);
  const r = portfolioToBundle(p, catalog);
  check('含 CASH 正常导入（CASH 剔除折算现金垫）', r.ok && r.bundle?.items.length === 1 && r.bundle.items[0].id === '510300', JSON.stringify(r));
  // tribunal B1c1：语义断言而非 toLocaleString 化妆（'20,000' 在 de_DE 下是 '20.000'，
  // 断言格式化字符串等于测试 locale 而非契约）
  check(
    'CASH 现金垫语义注入描述（措辞+币种符号，不绑千分位格式）',
    Boolean(r.bundle?.description?.includes('未入池') && r.bundle?.description?.includes('现金垫按主页面全局资金口径折算') && /¥\s?\d/.test(r.bundle?.description || '')),
    r.bundle?.description,
  );

  const pureCash = mkPortfolio([
    { code: 'CASH', amount: 20000 },
  ]);
  const rPure = portfolioToBundle(pureCash, catalog);
  // tribunal B1c3：钉住具体 reason 与 bundle===undefined——旧版 `!ok && missing.length>0`
  // 对任何失败都成立（近乎不可伪造）
  check(
    '纯 CASH 组合阻止导入（具体 reason + bundle undefined）',
    !rPure.ok && rPure.bundle === undefined && rPure.missing[0] === '组合中没有可导入的标的',
    JSON.stringify(rPure),
  );
}

// 4b. 同 code 多行合并（tribunal Fc6：旧版原样透传，resolveUniverse 解析出重复腿→风险预算翻倍）
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 60000 },
    { code: '510300.SH', amount: 40000 }, // 同标的第二行（不同买入批次）
    { code: '511010.SH', amount: 50000 },
  ]);
  const r = portfolioToBundle(p, catalog);
  const ids = (r.bundle?.items || []).map((it) => it.id);
  check('同 code 多行合并为单条（无重复腿）', ids.length === 2 && ids.filter((x) => x === '510300').length === 1, JSON.stringify(r.bundle?.items));
  check('合并后金额求和参与占比（510300: 6万+4万=10万 vs 511010: 5万 → 0.667/0.333）', r.bundle?.items[0].riskBudgetWeight === 0.6667 && r.bundle?.items[1].riskBudgetWeight === 0.3333, JSON.stringify(r.bundle?.items));
}

// 5. 权重和恒为 1
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 33333 },
    { code: '511010.SH', amount: 33333 },
    { code: '518880.SH', amount: 33334 },
  ]);
  const r = portfolioToBundle(p, catalog);
  const sum = r.bundle?.items.reduce((s, it) => s + it.riskBudgetWeight, 0) ?? 0;
  check('三项权重和 ≈ 1（四舍五入容差）', Math.abs(sum - 1) < 0.001, 'sum=' + sum);
}

// 5b. 裸码 catalog 条目匹配（tribunal B1c4：fixture 现在真有裸码形态，注释不再撒谎）
{
  const p = mkPortfolio([
    { code: '562500', amount: 100000, name: '机器人ETF' }, // catalog 中该条目 code 无后缀
  ]);
  const r = portfolioToBundle(p, catalog);
  check('裸码 catalog 条目可匹配导入', r.ok && r.bundle?.items.length === 1 && r.bundle.items[0].id === '562500', JSON.stringify(r));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
