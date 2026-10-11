import { AShareInstrument, InstrumentBundle } from '../types/ashare';

export type { InstrumentBundle, BundleItem } from '../types/ashare';

/**
 * 组合（bundle）定义：把若干标的 + 各自风险预算权重打包成「一组可切换的测试宇宙」。
 * 引擎层完全感知不到 bundle —— 它只接收 AShareInstrument[]（resolveUniverse 的产物），
 * 因此「换组合测试」在引擎侧只是换一个传入数组，零改动。
 */

export const BALANCED9_ID = 'balanced9';
export const POORLAB11_ID = 'poorlab11';

export const DEFAULT_BUNDLES: InstrumentBundle[] = [
  {
    id: BALANCED9_ID,
    name: '均衡 ETF 9 腿',
    description: '原默认池：宽基/红利/国债/黄金/纳指/恒科，沿用各自风险预算',
    items: [
      { id: '510300', riskBudgetWeight: 0.15 },
      { id: '510500', riskBudgetWeight: 0.15 },
      { id: '588000', riskBudgetWeight: 0.10 },
      { id: '512890', riskBudgetWeight: 0.15 },
      { id: '601857', riskBudgetWeight: 0.10 },
      { id: '511010', riskBudgetWeight: 0.15 },
      { id: '518880', riskBudgetWeight: 0.10 },
      { id: '513100', riskBudgetWeight: 0.10 },
      { id: '513180', riskBudgetWeight: 0.10 },
    ],
  },
  {
    id: POORLAB11_ID,
    name: 'poorlab 11 腿（个股）',
    description: '上一级 pool-lab 定稿生产名单，等权 9.09%/腿，目标 σ_T≈18–22%',
    items: [
      { id: '601288', riskBudgetWeight: 1 / 11 }, // 农业银行
      { id: '601318', riskBudgetWeight: 1 / 11 }, // 中国平安
      { id: '601857', riskBudgetWeight: 1 / 11 }, // 中国石油（与均衡池共用）
      { id: '600886', riskBudgetWeight: 1 / 11 }, // 国投电力
      { id: '601088', riskBudgetWeight: 1 / 11 }, // 中国神华
      { id: '601919', riskBudgetWeight: 1 / 11 }, // 中远海控
      { id: '601899', riskBudgetWeight: 1 / 11 }, // 紫金矿业
      { id: '000333', riskBudgetWeight: 1 / 11 }, // 美的集团
      { id: '600660', riskBudgetWeight: 1 / 11 }, // 福耀玻璃
      { id: '002714', riskBudgetWeight: 1 / 11 }, // 牧原股份
      { id: '002223', riskBudgetWeight: 1 / 11 }, // 鱼跃医疗
    ],
  },
];

/**
 * 按组合把 catalog 过滤 + 套用组合内权重，得到当前测试宇宙。
 * 顺序跟随组合定义，便于 UI 稳定展示。组合引用了 catalog 中不存在的标的则跳过。
 */
export function resolveUniverse(
  catalog: AShareInstrument[],
  bundle?: InstrumentBundle | null,
): AShareInstrument[] {
  if (!bundle || bundle.items.length === 0) return catalog;
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const out: AShareInstrument[] = [];
  for (const it of bundle.items) {
    const inst = byId.get(it.id);
    if (!inst) continue;
    out.push({ ...inst, riskBudgetWeight: it.riskBudgetWeight });
  }
  return out;
}
