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

// 模拟 catalog（含带后缀 code 与裸码两种形态）
const catalog: AShareInstrument[] = [
  { id: '510300', code: '510300.SH', name: '沪深300ETF' },
  { id: '511010', code: '511010.SH', name: '国债ETF' },
  { id: '518880', code: '518880.SH', name: '黄金ETF' },
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

// 3. 池外标的阻止导入
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 50000 },
    { code: '562500.SH', amount: 50000, name: '机器人ETF' },
  ]);
  const r = portfolioToBundle(p, catalog);
  check('池外标的阻止导入', !r.ok && r.missing.length === 1 && r.missing[0].includes('562500'), JSON.stringify(r.missing));
}

// 4. CASH 剔除折算为现金垫（不再阻止导入；纯 CASH 组合才阻止）
{
  const p = mkPortfolio([
    { code: '510300.SH', amount: 80000 },
    { code: 'CASH', amount: 20000 },
  ]);
  const r = portfolioToBundle(p, catalog);
  check('含 CASH 正常导入（CASH 剔除折算现金垫）', r.ok && r.bundle?.items.length === 1 && r.bundle.items[0].id === '510300', JSON.stringify(r));
  check('CASH 现金垫语义注入描述', Boolean(r.bundle?.description?.includes('20,000')), r.bundle?.description);

  const pureCash = mkPortfolio([
    { code: 'CASH', amount: 20000 },
  ]);
  const rPure = portfolioToBundle(pureCash, catalog);
  check('纯 CASH 组合阻止导入', !rPure.ok && rPure.missing.length > 0, JSON.stringify(rPure.missing));
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

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
