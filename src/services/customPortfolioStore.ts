import { AShareInstrument, CarverSettings, CustomPortfolio, CustomPortfolioItem, InstrumentBundle } from '../types/ashare';
import { calculateInstrumentPosition, DEFAULT_CARVER_SETTINGS } from './carverEngine';

export const PORTFOLIO_COLLECTION_STORAGE_KEY = 'carver_custom_portfolios_library_v2';
export const PORTFOLIO_SELECTED_SLOTS_KEY = 'carver_portfolio_slots_selection_v2';

// 官方内置预设基准（锁定官方标记）
/**
 * 预设快照的内容版本时间（tribunal Fc4）：必须是固定值，不能是模块加载时的 new Date()。
 * 旧版两个 42 万预设用 new Date().toISOString()——本地副本在 mergePortfolios 的
 * updatedAt 比较中永远「最新」，用户在别的设备/git 库里对这两个组合的编辑被永久
 * 影子覆盖，git 版本管理形同虚设。固定版本时间后：用户任何编辑（updatedAt=now）
 * 都能赢过预设，未编辑时与 git 库内容一致（打平无冲突）。
 */
const PRESET_SNAPSHOT_VERSION = '2026-10-13T00:00:00.000Z';

/** 现金占位 code（tribunal Fc7：旧版 sentinel 字面量散落 4 处，改语义时易漏） */
const CASH_CODE = 'CASH';

/**
 * 快速回测的按需 K 线拉取缓存（tribunal Ec3）：code -> Promise<bars>。
 * 缓存 Promise 本身而非结果——并发回测同一标的时自动合并请求；拉取失败即从缓存
 * 移除（不缓存失败，下次可重试）。会话级生命周期（页面刷新后自然失效）。
 */
const barsFetchCache = new Map<string, Promise<AShareInstrument['bars']>>();

export const OFFICIAL_PORTFOLIOS: CustomPortfolio[] = [
  {
    id: 'official_balanced9',
    name: '官方基准: 均衡 ETF 9 腿 (全天候)',
    description: '涵盖A股宽基、双创、红利、国债、黄金与海外QDII的标准全天候配置方案',
    totalCapital: 1000000,
    isOfficial: true,
    updatedAt: '2026-10-12T00:00:00.000Z',
    items: [
      { id: 'ob_1', code: '510300.SH', name: '沪深300ETF', category: 'broad_etf', amount: 150000, annualizedVol: 0.22, notes: '大盘核心资产' },
      { id: 'ob_2', code: '510500.SH', name: '中证500ETF', category: 'broad_etf', amount: 120000, annualizedVol: 0.25, notes: '中盘成长资产' },
      { id: 'ob_3', code: '588000.SH', name: '科创50ETF', category: 'broad_etf', amount: 80000, annualizedVol: 0.32, notes: '高贝塔科技' },
      { id: 'ob_4', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 150000, annualizedVol: 0.14, notes: '高股息防御资产' },
      { id: 'ob_5', code: '511010.SH', name: '国债ETF', category: 'bond_etf', amount: 200000, annualizedVol: 0.05, notes: '核心固定收益压舱石' },
      { id: 'ob_6', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 120000, annualizedVol: 0.18, notes: '大宗商品抗通胀' },
      { id: 'ob_7', code: '513100.SH', name: '纳指ETF (QDII)', category: 'qdii_etf', amount: 80000, annualizedVol: 0.23, notes: '全球科技分散' },
      { id: 'ob_8', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 50000, annualizedVol: 0.28, notes: '港股科技卫星' },
      { id: 'ob_9', code: '513520.SH', name: '日经225ETF (QDII)', category: 'qdii_etf', amount: 50000, annualizedVol: 0.24, notes: '海外分散配置' },
    ],
  },
  {
    id: 'user_actual_holdings',
    name: '实盘现状: 我的当前持仓 (42万)',
    description: '重仓恒生科技、航天与机器人，缺乏固收与现金备付垫的现状组合',
    totalCapital: 420000,
    isOfficial: false,
    updatedAt: PRESET_SNAPSHOT_VERSION,
    items: [
      { id: 'act_1', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 150000, profitRate: -24.0, profitAmount: -36000, annualizedVol: 0.28, notes: '单标的占比高达35.7%，严重超配高波' },
      { id: 'act_2', code: '562500.SH', name: '机器人ETF华夏', category: 'sector_etf', amount: 45000, profitRate: -13.3, profitAmount: -6000, annualizedVol: 0.35, notes: '高贝塔制造业赛道' },
      { id: 'act_3', code: '512660.SH', name: '军工/航天ETF', category: 'sector_etf', amount: 45000, profitRate: -13.3, profitAmount: -6000, annualizedVol: 0.35, notes: '与机器人高度正相关' },
      { id: 'act_4', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 50000, profitRate: 3.0, profitAmount: 1500, annualizedVol: 0.14, notes: '低波动稳健资产' },
      { id: 'act_5', code: '601288.SH', name: '农业银行 (低估银行)', category: 'stock_cn', amount: 50000, profitRate: 3.0, profitAmount: 1500, annualizedVol: 0.23, notes: '高股息防御资产' },
      { id: 'act_6', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 80000, profitRate: -3.7, profitAmount: -3000, annualizedVol: 0.21, notes: '大宗抗通胀避险资产' },
    ],
  },
  {
    id: 'user_optimized_carver',
    name: '拟定优化: Carver 风险平价平衡方案 (42万)',
    description: '恒科削减、机器人航天合并控仓、增补国债与现金垫的平衡组合',
    totalCapital: 420000,
    isOfficial: false,
    updatedAt: PRESET_SNAPSHOT_VERSION,
    items: [
      { id: 'opt_1', code: '513180.SH', name: '恒生科技ETF (QDII)', category: 'qdii_etf', amount: 75000, annualizedVol: 0.28, notes: '压降至18%合理风控区间，保留反弹弹性' },
      { id: 'opt_2', code: '562500.SH', name: '机器人/航天成长', category: 'sector_etf', amount: 45000, annualizedVol: 0.35, notes: '合并控仓在11%左右，作为进攻卫星' },
      { id: 'opt_3', code: '512890.SH', name: '红利低波ETF', category: 'broad_etf', amount: 60000, annualizedVol: 0.14, notes: '压舱底仓，高股息正现金流' },
      { id: 'opt_4', code: '601288.SH', name: '农业银行 (低估银行)', category: 'stock_cn', amount: 50000, annualizedVol: 0.23, notes: '高股息防御底仓' },
      { id: 'opt_5', code: '518880.SH', name: '黄金ETF', category: 'commodity_etf', amount: 80000, annualizedVol: 0.21, notes: '避险抗通胀资产' },
      { id: 'opt_6', code: '511010.SH', name: '国债ETF (压舱石)', category: 'bond_etf', amount: 60000, annualizedVol: 0.05, notes: '新增固收类，大幅平抑组合总波动' },
      { id: 'opt_7', code: 'CASH', name: '现金 / 货币基金 (安全垫)', category: 'bond_etf', amount: 50000, annualizedVol: 0.01, notes: '12%机动备付资金，消除回撤焦虑' },
    ],
  },
];

/**
 * 加载所有自选组合（内置官方基准 + 用户保存的自选组）
 */
export function loadAllPortfolios(): CustomPortfolio[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_COLLECTION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 保证官方预设不被彻底丢失
        const officialIds = new Set(OFFICIAL_PORTFOLIOS.filter(p => p.isOfficial).map(p => p.id));
        const merged = [...parsed];
        for (const off of OFFICIAL_PORTFOLIOS) {
          if (off.isOfficial && !merged.some(m => m.id === off.id)) {
            merged.unshift(off);
          }
        }
        return merged;
      }
    }
  } catch {
    /* ignore */
  }
  return OFFICIAL_PORTFOLIOS;
}

/**
 * 保存组合列表至本地持久化
 */
export function saveAllPortfolios(portfolios: CustomPortfolio[]): void {
  try {
    localStorage.setItem(PORTFOLIO_COLLECTION_STORAGE_KEY, JSON.stringify(portfolios));
  } catch {
    /* ignore */
  }
  // 双写服务端（data/portfolios/custom_portfolios.json，随 git 提交实现版本管理）。
  // 只持久化用户自选——官方预设是代码常量，loadAllPortfolios 会自动补齐。
  // fire-and-forget：失败不阻塞本地保存（下次保存重试）。
  try {
    const userPortfolios = portfolios.filter(p => !p.isOfficial);
    fetch('/api/ashare/portfolios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolios: userPortfolios }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {
      /* offline / server down：本地已保存，静默降级 */
    });
  } catch {
    /* ignore */
  }
}

/**
 * 只写 localStorage（不回 POST 服务端）——用于「合并服务端数据」这类本来就来自
 * 服务端的路径（2026-10-14，tribunal Ec1/i4）：回 POST 会造成无谓的项目内文件
 * 写入，且与编辑路径的双写交叠时 last-arrival-wins 可能吞掉一侧的修改。
 */
export function saveAllPortfoliosLocalOnly(portfolios: CustomPortfolio[]): void {
  try {
    localStorage.setItem(PORTFOLIO_COLLECTION_STORAGE_KEY, JSON.stringify(portfolios));
  } catch {
    /* ignore */
  }
}

/** 主页面外部导入 bundle 的固定槽位 id（多次导入覆盖，不新建） */
export const IMPORTED_BUNDLE_ID = 'imported';

export interface PortfolioImportResult {
  ok: boolean;
  /** 无数据标的清单（池外标的）——阻止导入的依据。CASH 不在此列：已被剔除并折算为现金垫（2026-10-13 语义修正） */
  missing: string[];
  bundle?: InstrumentBundle;
}

/**
 * 自选组合 -> 主页面 InstrumentBundle 转换（诊断面板「导入主页面」用）。
 *
 * 规则（2026-10-13 与用户确认；2026-10-14 CASH 语义修正，tribunal Ec4/i7）：
 * - 含池外无数据标的（不在官方 catalog）-> 阻止导入，返回 missing 清单
 *   （诚实性：无数据不降级、不静默剔除改变组合语义）；
 * - CASH 现金占位：剔除并折算为主页面「现金垫」，不阻止导入（纯 CASH 组合仍阻止）；
 * - 权重：全部条目显式设置了 riskBudgetWeight 则归一化使用；否则按 amount 占比归一
 *   （金额占比 ~= 风险贡献占比的合理近似）；
 * - 现持仓不回填（选项 C）：导入的是「理想仓位结构」，主页面 currentShares=0，
 *   只看目标仓位，由用户自行按比例调仓。
 */
export function portfolioToBundle(
  portfolio: CustomPortfolio,
  catalog: AShareInstrument[]
): PortfolioImportResult {
  const catalogKeys = new Set<string>();
  catalog.forEach(c => {
    catalogKeys.add(c.id);
    catalogKeys.add(c.code);
    catalogKeys.add(c.code.split('.')[0]);
  });

  const missing: string[] = [];
  // CASH 是现金占位而非标的：剔除并折算为主页面「现金垫」（总额-已配=现金），
  // 不阻止导入（2026-10-13 修正：此前 CASH 被归入缺失永久阻止，与组合含现金的正常语义矛盾）
  let cashAmount = 0;
  const valid = portfolio.items.filter(it => {
    if (it.code === CASH_CODE) {
      cashAmount += Math.max(0, it.amount);
      return false;
    }
    const bare = it.code.split('.')[0];
    if (!catalogKeys.has(it.code) && !catalogKeys.has(bare)) {
      missing.push(it.code + ' ' + it.name);
      return false;
    }
    return true;
  });

  if (!valid.length) {
    return { ok: false, missing: missing.length ? missing : ['组合中没有可导入的标的'] };
  }

  // 同 code 多行合并（tribunal Fc6）：自选组合允许同一标的占多行（不同买入批次/备注），
  // 旧版原样透传到 bundle items——resolveUniverse 解析出两条相同标的，该腿风险预算
  // 翻倍（静默超配）。按 code 合并：金额求和，显式权重求和（一方未设则退化为金额主导）。
  const mergedByCode = new Map<string, (typeof valid)[number]>();
  for (const it of valid) {
    const prev = mergedByCode.get(it.code);
    if (!prev) {
      mergedByCode.set(it.code, { ...it });
      continue;
    }
    mergedByCode.set(it.code, {
      ...prev,
      amount: prev.amount + it.amount,
      riskBudgetWeight:
        typeof prev.riskBudgetWeight === 'number' && typeof it.riskBudgetWeight === 'number'
          ? prev.riskBudgetWeight + it.riskBudgetWeight
          : undefined,
    });
  }
  const legs = [...mergedByCode.values()];
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  // 权重：全显式 -> 归一化显式值；否则按 amount 占比（legs 已按 code 去重合并）
  const allExplicit = legs.every(it => typeof it.riskBudgetWeight === 'number' && it.riskBudgetWeight > 0);
  let weights: number[];
  if (allExplicit) {
    const sum = legs.reduce((s, it) => s + (it.riskBudgetWeight || 0), 0);
    weights = sum > 0 ? legs.map(it => (it.riskBudgetWeight || 0) / sum) : legs.map(() => 1 / legs.length);
  } else {
    const totalAmount = legs.reduce((s, it) => s + Math.max(0, it.amount), 0);
    if (totalAmount <= 0) {
      return { ok: false, missing: ['组合内全部标的金额为 0，无法推导权重'] };
    }
    weights = legs.map(it => Math.max(0, it.amount) / totalAmount);
  }

  const bundle: InstrumentBundle = {
    id: IMPORTED_BUNDLE_ID,
    name: '导入: ' + portfolio.name,
    description:
      '自选组合「' + portfolio.name + '」导入（' + new Date().toISOString().slice(0, 10) +
      '）· 理想仓位结构，现持仓按 0 处理；多次导入覆盖本组合' +
      (cashAmount > 0
        ? // tribunal Fc6：诚实措辞——现金垫由主页面的全局资金口径折算（settings.totalCapital），
          // 不是组合自身资金。组合资金≠全局资金时，旧文案「对应主页面现金垫」数学失真。
          '；组合内现金 ¥' + cashAmount.toLocaleString() + ' 未入池（现金垫按主页面全局资金口径折算）'
        : ''),
    items: legs.map((it, i) => ({
      id: it.code.split('.')[0],
      riskBudgetWeight: Number(weights[i].toFixed(4)),
    })),
  };
  return { ok: true, missing: [], bundle };
}

/** 拉取服务端持久化的自选组合库（data/portfolios/custom_portfolios.json） */
export async function fetchServerPortfolios(): Promise<CustomPortfolio[]> {
  try {
    // 超时保护（2026-10-14，tribunal Fc3）：服务端挂起时旧版会让挂载 effect 永远等待
    const res = await fetch('/api/ashare/portfolios', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.portfolios) ? data.portfolios : [];
  } catch {
    return [];
  }
}

/**
 * 合并本地与服务端组合库：按 id 去重，updatedAt 较新者胜（单用户场景的简单时钟策略）。
 * 时间比较用 Date.parse 数值比较（2026-10-14 修正，tribunal Fc3）：旧版是
 * `String(a) > String(b)` 字典序比较——'...00.000Z' 与 '...00Z' 同刻却因 '.'(0x2E)<'Z'(0x5A)
 * 让更精确的时间戳输掉，手写/异格式时间戳比较结果任意，缺失 updatedAt 永不能胜出。
 * 解析失败按 0 计（最早），并在两侧都缺失时保留先到者（local 先 put）。
 */
export function mergePortfolios(local: CustomPortfolio[], server: CustomPortfolio[]): CustomPortfolio[] {
  const tsOf = (p: CustomPortfolio): number => {
    const t = Date.parse(p?.updatedAt || '');
    return Number.isFinite(t) ? t : 0;
  };
  const byId = new Map<string, CustomPortfolio>();
  const put = (p: CustomPortfolio) => {
    const existing = byId.get(p.id);
    if (!existing || tsOf(p) > tsOf(existing)) byId.set(p.id, p);
  };
  local.forEach(put);
  server.forEach(put);
  return [...byId.values()];
}

/**
 * 基于标的波动率，一键反比平准化自动计算各标的目标金额（满仓配平）。
 *
 * 修复记录（2026-10-13，修复 Gemini 初版三处缺陷）：
 * 1. CASH 现金占位项不得参与反比权重计算——其 vol=0.01 会让 invVol=100、
 *    权重爆炸至 ~70%（实测 42 万组合 CASH 吃 29.4 万、权益仅剩 30%），
 *    与「强行填满 100% 资金，不留现金」的按钮语义直接矛盾。现 CASH 一律清 0。
 * 2. 残差回收：此前每项独立四舍五入到千元，N 项累加后总和偏离 totalCapital
 *    （最多 ±500×N），并非精确满仓。现各项取整到百元、残差归 invVol 最大项。
 * 3. 按 item.id 而非 code 作 Map key——此前重复添加同一标的时后写覆盖前写，
 *    静默丢失一份资金分配。
 */
export function calculateRiskParityAllocation(
  items: Array<{ id: string; code: string; annualizedVol?: number }>,
  totalCapital: number
): Map<string, number> {
  const result = new Map<string, number>();
  // 入参校验（2026-10-14 修正，tribunal Fc2）：NaN/Infinity 资金直接早退并显式置 0——
  // NaN 曾穿过 `totalCapital<=0` 与 `sumInv<=0` 两道守卫（NaN 比较恒 false），
  // 使整张分配表静默变成 NaN，再被调用方 `?? it.amount` 洗成假成功。
  if (!items.length) return result;
  if (!Number.isFinite(totalCapital) || totalCapital <= 0) {
    items.forEach(it => result.set(it.id, 0));
    return result;
  }

  // 权重正比于 1 / Vol；CASH 现金占位不参与（清 0，语义=不留现金）。
  // vol 下限 0.05（国债ETF 实测水平）：防未知 vol/超低波项权重爆炸。
  // vol 校验（tribunal Fc2）：NaN/Infinity/负数/未定义一律落到 0.25 默认值——
  // Math.max(0.05, NaN)=NaN 会污染全表；负 vol 被 Math.max 压到 0.05 反而拿最大权重。
  const participable = items.filter(it => it.code !== CASH_CODE);
  if (!participable.length) {
    // 组合只有现金占位：无权益可配，全部置 0（调用方应提示用户先添加标的）
    items.forEach(it => result.set(it.id, 0));
    return result;
  }

  const invVols = participable.map(it => {
    const vol =
      Number.isFinite(it.annualizedVol) && (it.annualizedVol as number) > 0
        ? Math.max(0.05, it.annualizedVol as number)
        : 0.25;
    return { id: it.id, invVol: 1 / vol };
  });

  const sumInv = invVols.reduce((s, x) => s + x.invVol, 0);
  if (sumInv <= 0) {
    items.forEach(it => result.set(it.id, 0));
    return result;
  }

  // 各项按权重取整到百元；残差归 invVol 最大项，保证 sum === totalCapital 精确满仓
  let allocated = 0;
  let maxInvVol = -Infinity;
  let maxInvVolId = invVols[0].id;
  invVols.forEach(x => {
    if (x.invVol > maxInvVol) {
      maxInvVol = x.invVol;
      maxInvVolId = x.id;
    }
    const amt = Math.round((x.invVol / sumInv) * totalCapital / 100) * 100;
    result.set(x.id, amt);
    allocated += amt;
  });
  const residual = totalCapital - allocated;
  result.set(maxInvVolId, (result.get(maxInvVolId) ?? 0) + residual);

  // CASH 占位项显式清 0（非缺席，调用方 get(it.id) 一定命中）
  items.forEach(it => {
    if (it.code === CASH_CODE) result.set(it.id, 0);
  });

  return result;
}

export interface CarverAllocationResult {
  items: CustomPortfolioItem[];
  allocatedCapital: number;
  cashReserve: number;
  message: string;
}

/**
 * 🎯 真正的 Carver 系统化动态定仓：
 * 基于标的历史行情、年线 MA250 趋势、EWMAC 动量标量、估值双守门与单标的 25% 封顶风控。
 * 绝不强行填满 100% 资金！动量差/左侧阴跌的标的自动压缩仓位，未配置资金自动沉淀为现金安全垫。
 */
export function calculateCarverDynamicAllocation(
  portfolio: CustomPortfolio,
  catalog: AShareInstrument[],
  customSettings?: CarverSettings
): CarverAllocationResult {
  const settings: CarverSettings = {
    ...DEFAULT_CARVER_SETTINGS,
    ...customSettings,
    totalCapital: portfolio.totalCapital,
  };

  const catalogMap = new Map<string, AShareInstrument>();
  catalog.forEach(c => {
    catalogMap.set(c.code, c);
    catalogMap.set(c.code.split('.')[0], c);
  });

  // 1. 过滤有效交易标的（剔除已有的现金占位，稍后由系统根据余量自动精确生成）
  const tradableItems = portfolio.items.filter(it => it.code !== CASH_CODE);
  if (tradableItems.length === 0) {
    return {
      items: [
        {
          id: `cash_${Date.now()}`,
          code: CASH_CODE,
          name: '现金 / 货币基金 (安全垫)',
          category: 'bond_etf',
          amount: portfolio.totalCapital,
          annualizedVol: 0.01,
          notes: '组合未持有标的，100% 现金避险',
        },
      ],
      allocatedCapital: 0,
      cashReserve: portfolio.totalCapital,
      message: '组合中无可用交易标的，全部保留现金。',
    };
  }

  // 构建临时 universe 用于传给 calculateInstrumentPosition
  const tempUniverse: AShareInstrument[] = tradableItems.map(it => {
    const fromCat = catalogMap.get(it.code) || catalogMap.get(it.code.split('.')[0]);
    if (fromCat) {
      return {
        ...fromCat,
        riskBudgetWeight: 1.0 / tradableItems.length,
      };
    }
    // 池外自选标的：构造合法对象
    const p = it.currentPrice && it.currentPrice > 0 ? it.currentPrice : 1.0;
    const vol = it.annualizedVol ?? 0.25;
    return {
      id: it.code.split('.')[0],
      code: it.code,
      name: it.name,
      category: it.category,
      isETF: it.category.includes('etf'),
      isT0: it.category === 'bond_etf' || it.category === 'commodity_etf' || it.category === 'qdii_etf',
      stampDutyExempt: it.category.includes('etf'),
      currentPrice: p,
      preClose: p,
      changePct: 0,
      dailyATR: Number((p * (vol / 15.8)).toFixed(4)),
      annualizedVol: vol,
      riskBudgetWeight: 1.0 / tradableItems.length,
      currentShares: Math.floor((it.amount / p) / 100) * 100,
      bars: [],
    };
  });

  let totalAllocated = 0;
  const updatedItems: CustomPortfolioItem[] = [];

  tradableItems.forEach((it, idx) => {
    const inst = tempUniverse[idx];
    const pos = calculateInstrumentPosition(inst, tempUniverse, settings);
    const p = Math.max(0.01, inst.currentPrice);
    
    // 目标金额 = 目标股数 * 最新市价 (必须遵守向下整手 100 股)
    let targetAmt = Math.round((pos.targetShares * p) / 100) * 100;

    // 单标的硬风控上限 (默认不超过 25%)——cap 的是持仓金额，应使用 PositionCap 字段
    // （与 carverEngine 内部 cap 同源；RiskCap 是风险权重口径，两者语义不同）
    const maxCap = Math.round(portfolio.totalCapital * (settings.maxInstrumentPositionCap ?? 0.25));
    if (targetAmt > maxCap) targetAmt = maxCap;

    totalAllocated += targetAmt;

    // 诚实性：池外自选标的（catalog 未收录）无 bars，EWMAC/年线信号缺席，
    // forecastScalar 恒 0 → 乘数 1.0x。这是「数据缺失下的中性降级」而非真实中性信号，
    // notes 不得谎报「中性震荡区间」（与 mock 假分位同类问题）。
    const hasRealBars = Array.isArray(inst.bars) && inst.bars.length >= 60;
    let note = hasRealBars
      ? `标量 ${pos.forecastScalar > 0 ? '+' : ''}${pos.forecastScalar.toFixed(1)} (乘数 ${pos.scalarMultiplier.toFixed(2)}x)`
      : `无行情数据（池外自选，未接入 parquet），信号缺席，按中性 1.0x 配置——建议以官方池标的替代`;
    if (!hasRealBars) {
      // 已含说明，不再追加信号解读
    } else if (pos.forecastScalar <= -5) {
      note += '；跌破均线/负动量，Carver 强制压降仓位防守';
    } else if (pos.forecastScalar >= 5) {
      note += '；站上年线/正动量，释放进攻仓位';
    } else {
      note += '；中性震荡区间';
    }

    updatedItems.push({
      ...it,
      amount: targetAmt,
      currentPrice: p,
      annualizedVol: inst.annualizedVol,
      notes: note,
    });
  });

  // 剩余未用尽的流动性资金，按量化纪律沉淀为现金安全垫
  const cashReserve = Math.max(0, portfolio.totalCapital - totalAllocated);
  if (cashReserve >= 500) {
    updatedItems.push({
      id: `cash_${Date.now()}`,
      code: 'CASH',
      name: '现金 / 货币基金 (安全垫)',
      category: 'bond_etf',
      amount: cashReserve,
      annualizedVol: 0.01,
      notes: `Carver 动态风控沉淀: 当前非满仓状态，留有 ${( (cashReserve / portfolio.totalCapital) * 100 ).toFixed(1)}% 现金消除焦虑`,
    });
  }

  const equityRatio = ((totalAllocated / portfolio.totalCapital) * 100).toFixed(1);
  return {
    items: updatedItems,
    allocatedCapital: totalAllocated,
    cashReserve,
    message: `Carver 动态策略计算完毕: 权益配置仓位 ${equityRatio}% (¥${totalAllocated.toLocaleString()})，保留现金安全垫 ¥${cashReserve.toLocaleString()}`,
  };
}

export interface QuickBacktestResult {
  ok: boolean;
  message?: string;
  totalPoints: number;
  startDate: string;
  endDate: string;
  cagrPct: number;
  annVolPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  calmar: number;
  tradableCount: number;
}

/** 快速回测失败返回（tribunal Fc7：旧版同一 11 字段对象手抄 3 份，措辞已漂移） */
function quickBacktestFailure(message: string): QuickBacktestResult {
  return {
    ok: false,
    message,
    totalPoints: 0,
    startDate: '',
    endDate: '',
    cagrPct: 0,
    annVolPct: 0,
    sharpe: 0,
    maxDrawdownPct: 0,
    calmar: 0,
    tradableCount: 0,
  };
}


/**
 * 📈 为自选组合快速计算历史回测业绩指标
 */
export async function runQuickPortfolioBacktest(
  portfolio: CustomPortfolio,
  catalog: AShareInstrument[],
  settings: CarverSettings
): Promise<QuickBacktestResult> {
  const { runRealBacktest } = await import('./backtestEngine');
  const { resolveUniverse } = await import('./bundles');

  const bundleRes = portfolioToBundle(portfolio, catalog);
  if (!bundleRes.ok || !bundleRes.bundle) {
    return quickBacktestFailure(bundleRes.missing.length ? `缺少标的行情: ${bundleRes.missing.join(', ')}` : '无法解析组合');
  }

  const resolved = resolveUniverse(catalog, bundleRes.bundle);
  if (!resolved.length) {
    return quickBacktestFailure('有效标的为空');
  }

  // /api/ashare/instruments 已 strip bars 瘦身（17MB → 200KB）：catalog 里的 bars
  // 为空或伪随机合成线（syntheticBars），直接跑回测会得到空 series。
  // 真实 K 线经 /api/ashare/bars/:code 按需拉取补齐（与回测沙盘/风险贡献图同款链路）。
  // 模块级 Promise 缓存（tribunal Ec3）：旧版每次回测都对每腿重新拉一遍——
  // 同一会话内切 A/B 槽位或重复点回测时全量重拉。缓存 Promise 本身（防并发重入），
  // 不设 TTL（parquet 日更，会话级缓存足够；数据更新后刷新页面即自然失效）。
  const { AShareDataService } = await import('./apiClient');
  const withBars: AShareInstrument[] = [];
  for (const inst of resolved) {
    const hasReal = Array.isArray(inst.bars) && inst.bars.length >= 20 && !inst.syntheticBars;
    if (hasReal) {
      withBars.push(inst);
      continue;
    }
    let inflight = barsFetchCache.get(inst.code);
    if (!inflight) {
      inflight = AShareDataService.fetchInstrumentBars(inst.code).catch((e) => {
        barsFetchCache.delete(inst.code); // 失败不缓存，下次可重试
        throw e;
      });
      barsFetchCache.set(inst.code, inflight);
    }
    const bars = await inflight.catch(() => [] as AShareInstrument['bars']);
    withBars.push({ ...inst, bars, syntheticBars: bars.length >= 20 ? false : true });
  }
  const tradable = withBars.filter(
    (i) => Array.isArray(i.bars) && i.bars.length >= 20 && !i.syntheticBars,
  ).length;
  if (!tradable) {
    return quickBacktestFailure('所有标的的真实 K 线均拉取失败（/api/ashare/bars），无法回测');
  }

  // 用组合自身的资金跑回测（2026-10-14 修正，tribunal Fc1/V24）：此前直接透传调用方
  // 全局 settings（默认 totalCapital=100 万），42 万的组合按 100 万账户口径回测——
  // maxInstrumentPositionCap/minTradeAmount/整手取整/ADV 参与率全部错位，指标却不是
  // 这个组合的。与 calculateCarverDynamicAllocation 同款覆盖范式。
  const engineSettings: CarverSettings = {
    ...DEFAULT_CARVER_SETTINGS,
    ...settings,
    totalCapital: portfolio.totalCapital,
  };

  const res = runRealBacktest(withBars, engineSettings);
  const m = res.metrics.carver;
  // 样本量闸门（2026-10-14 修正，tribunal Fc5）：bars>=20 曾让 20~251 根的退化样本
  // 通过出口检查，computeMetrics 在空/坍缩净值轴上返回全 0，函数却报 ok:true——
  // UI 把「样本不足」渲染成绿色的「CAGR +0.00%」。回测引擎默认需要 252 根历史，
  // 这里要求至少 60 个交易日净值点才承认指标可信，否则明确失败。
  if (res.series.length < 60) {
    return quickBacktestFailure(`样本不足：仅 ${res.series.length} 个交易日净值点（回测引擎需 252 根历史/标），指标不可信，未展示`);
  }
  return {
    ok: true,
    totalPoints: res.series.length,
    startDate: res.metrics.startDate,
    endDate: res.metrics.endDate,
    cagrPct: m.cagrPct,
    annVolPct: m.annVolPct,
    sharpe: m.sharpe,
    maxDrawdownPct: m.maxDrawdownPct,
    calmar: m.calmar,
    tradableCount: tradable,
  };
}

