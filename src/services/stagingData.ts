/**
 * 三级数据架构（2026-10-13 与用户定案）：
 *   统一池（data/parquet + valuation + registry，git 管理）— 主页面全部机制的数据源
 *   缓存区（data/cache/staging，gitignore）— 池外标的「拉取→人工确认→晋升」的候选区
 *   按需分析区（data/cache/analysis，gitignore）— 深度分析临时数据，看完即弃可重拉
 *
 * 数据源决策（讨论定案①）：新入池标的统一走腾讯 hfq 日线（Node 单源自洽，无需 Python）。
 * ⚠️ 腾讯 hfq 与 AKShare 底座复权基准不同（600660 同日 2492 vs 5248，≈2.1x 因子差）——
 * hfq 是相对序列，基准常数不影响收益率/波动率/回测正确性；规则是「一个标的数据源
 * 一旦确定就终身用一个」（入池即全历史重建 + 之后增量同源），两种基准池内并存安全。
 *
 * 腾讯日线无成交额字段 → amount = volume(手)×100×close(hfq)（伪成交额）。
 * 推论：① VWAP 甄别对该类数据退化为「只告警不重标定」（close/vwap 恒 1）；
 *       ② VWAP=hfq close ≠ 市价——用快照市价/hfq 最后收盘的 factor 换算修正
 *          （存 registry，realData 加载时对 registry 标的应用，保住「VWAP 兜底市价」机制）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { AShareInstrument } from '../types/ashare';
import { codeToTencentSymbol } from './liveMarketSync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(process.cwd(), 'data', 'cache');
const STAGING_DIR = path.join(CACHE_DIR, 'staging');
const ANALYSIS_DIR = path.join(CACHE_DIR, 'analysis');
const REGISTRY_PATH = path.resolve(process.cwd(), 'data', 'pool_registry.json');

export type StagingTarget = 'staging' | 'analysis';

export interface StagingBar {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // 股
  amount: number; // 元（伪成交额=股数×hfq close）
}

export interface PoolRegistryEntry {
  code: string;        // 裸码 6 位
  name: string;
  category: string;
  isETF: boolean;
  riskBudgetWeight: number;
  /** 快照市价 / hfq 最后收盘——realData 加载时用它把 hfq 绝对值换算回市价口径 */
  hfqToMarketFactor: number;
  addedAt: string;
  source: 'tencent_hfq';
}

export interface StagingQualityReport {
  code: string;
  name: string;
  target: StagingTarget;
  barCount: number;
  firstDate: string;
  lastDate: string;
  coverageYears: number;
  annualizedVol: number;
  /** 疑似复权断裂（超界单日跳变）——已按 VWAP 甄别分类 */
  suspiciousBreaks: { date: string; pct: number; action: 'rescaled' | 'warn-only' }[];
  rescaledCount: number;
  /** 快照市价（拉取时刻）与 hfq→市价换算因子 */
  marketPrice: number;
  hfqToMarketFactor: number;
  peTTM: number;
  pb: number;
  warnings: string[];
  storedAt: string;
}

function ensureDirs(target: StagingTarget): string {
  const dir = target === 'staging' ? STAGING_DIR : ANALYSIS_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 腾讯 hfq 日线分页拉取（每页 640 根，按 end_date 向历史回溯），返回按日期升序的全历史。
 *
 * 协议（2026-10-14 修正，tribunal V2）：`param={symbol},day,<start>,,<count>,hfq`
 * ——第三槽是 start、第四槽才是 end。此前把回溯游标 endDate 放进 start 槽，第 2 页
 * 请求的是「从 earliest 起向后 640 根」即已拉过的窗口，自带熔断立刻触发，任何
 * >640 根的股票最多 2 次请求只拿到 ~640 根（"全历史"是装饰）。现在游标放第四槽，
 * 并断言第 2 页起必须引入严格更早的新日期，否则抛错——协议错配必须炸响。
 */
export async function fetchTencentHfqDaily(
  code: string,
  maxBars = 12000,
): Promise<StagingBar[]> {
  const symbol = codeToTencentSymbol(code);
  const collected = new Map<string, StagingBar>();
  let endDate = '';
  const PAGE = 640;

  for (let page = 0; page < Math.ceil(maxBars / PAGE); page++) {
    // start 槽留空；endDate 为空时 end 槽也空（= 最新 PAGE 根）
    const url =
      'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' +
      `${symbol},day,,${endDate},${PAGE},hfq`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      throw new Error(`tencent hfq 第 ${page + 1} 页网络失败（已收集 ${collected.size} 根）: ${e?.message || e}`);
    }
    if (!res.ok) throw new Error(`tencent hfq http ${res.status}`);
    const j: any = await res.json();
    const data = j?.data?.[symbol];
    if (!data) throw new Error('tencent hfq response missing data');
    const arr: any[] = data.hfqday || data.day || [];
    if (!arr.length) break;

    const before = collected.size;
    for (const row of arr) {
      // 行格式 [date, open, close, high, low, volume(手), ...]
      const d = String(row[0]).slice(0, 10);
      if (collected.has(d)) continue;
      const close = Number(row[2]);
      const open = Number(row[1]);
      const high = Number(row[3]);
      const low = Number(row[4]);
      const volHand = Number(row[5]); // 手
      const volShares = volHand * 100;
      if (!(close > 0) || !(volShares > 0)) continue;
      collected.set(d, {
        tradeDate: d,
        open,
        high,
        low,
        close,
        volume: volShares,
        amount: volShares * close, // 伪成交额（见文件头注）
      });
    }

    const dates = arr.map((r) => String(r[0]).slice(0, 10)).sort();
    const earliest = dates[0];
    // 回溯页（page>=1）必须引入严格更早的新日期；否则说明游标协议错配，炸响而不是静默截断
    if (page >= 1 && endDate) {
      if (earliest >= endDate) {
        throw new Error(
          `tencent hfq 分页协议异常：第 ${page + 1} 页 earliest=${earliest} 未早于游标 ${endDate}，` +
            '游标槽位或接口行为已变化，拒绝静默截断',
        );
      }
      if (collected.size === before) {
        throw new Error(
          `tencent hfq 分页协议异常：第 ${page + 1} 页未引入任何新日期（earliest=${earliest}），` +
            '疑似拿到已拉过的窗口',
        );
      }
    }
    if (arr.length < PAGE) break;
    endDate = earliest; // 向更早回溯
    // 页间礼貌间隔，降低被腾讯限流的概率
    if (page < Math.ceil(maxBars / PAGE) - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (!collected.size) throw new Error('tencent hfq 拉取为空（接口限流或代码无效）');
  return [...collected.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

export interface TencentQuote {
  name: string;
  currentPrice: number;
  preClose: number;
  tradeDate: string;
  peTTM: number;
  pb: number;
}

/** 腾讯实时快照（GBK），取市价/昨收/名称/PE/PB——与 liveMarketSync 同源同口径 */
export async function fetchTencentQuote(code: string): Promise<TencentQuote> {
  const symbol = codeToTencentSymbol(code);
  const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const buf = await res.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  const m = text.match(/v_[a-z0-9]+="([^"]+)"/i);
  if (!m) throw new Error('tencent quote 解析失败');
  const p = m[1].split('~');
  const num = (i: number) => Number(p[i]) || 0;
  // p[30] 形如 '20261009150000'——须插横线成 '2026-10-09'（2026-10-14 修正：此前 slice(0,10) 得 '2026100915' 非日期）
  const timeStr = p[30] || '';
  const tradeDate =
    timeStr.length >= 8
      ? `${timeStr.slice(0, 4)}-${timeStr.slice(4, 6)}-${timeStr.slice(6, 8)}`
      : new Date().toISOString().slice(0, 10);
  return {
    name: p[1] || code,
    currentPrice: num(3),
    preClose: num(4),
    tradeDate,
    peTTM: num(39),
    pb: num(46),
  };
}

export interface BreakFinding {
  date: string;
  pct: number;
  action: 'rescaled' | 'warn-only';
}

/**
 * 复权断裂检测 + VWAP 甄别重标定——阈值与 realData.ts 一致（12%/15%/guard 0.95-1.05）。
 * 注意（2026-10-14 修正，tribunal V5/V6）：staging 源的 amount 是伪成交额（volShares×close），
 * vwapOf≡close、close/vwap 比值恒为 1，VWAP 甄别在数学上不可用——本函数对 staging 数据
 * 只做候选检测 + warn-only，不捏造 factor。上游若换源提供真实 amount，甄别自动恢复。
 */
export function detectAndFixBreaks(bars: StagingBar[]): {
  bars: StagingBar[];
  findings: BreakFinding[];
  rescaledCount: number;
} {
  const BREAK_THRESHOLD = 0.12;
  const LIMIT_UP_ERA_START = '1996-12-16';
  const RATIO_DRIFT = 0.15;
  const RATIO_WINDOW = 10;
  const findings: BreakFinding[] = [];
  let rescaledCount = 0;

  const medianOf = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  for (let i = 1; i < bars.length; i++) {
    const pc = bars[i - 1].close;
    if (pc <= 0) continue;
    if (bars[i].tradeDate < LIMIT_UP_ERA_START) continue;
    const r = (bars[i].close - pc) / pc;
    if (Math.abs(r) <= BREAK_THRESHOLD) continue;

    const vwapOf = (b: StagingBar) => (b.volume > 0 && b.amount > 0 ? b.amount / b.volume : 0);
    const before: number[] = [];
    for (let j = Math.max(0, i - RATIO_WINDOW); j < i; j++) {
      if (vwapOf(bars[j]) > 0) before.push(bars[j].close / vwapOf(bars[j]));
    }
    const after: number[] = [];
    for (let j = i; j < Math.min(bars.length, i + RATIO_WINDOW); j++) {
      if (vwapOf(bars[j]) > 0) after.push(bars[j].close / vwapOf(bars[j]));
    }
    const ratioBefore = medianOf(before);
    const ratioAfter = medianOf(after);
    let factor = 0;
    if (ratioBefore > 0 && ratioAfter > 0 && Math.abs(ratioAfter / ratioBefore - 1) > RATIO_DRIFT) {
      factor = ratioBefore / ratioAfter;
    }
    // 与 realData.ts 同步：VWAP 窗口缺失时不再假设"当日收益约 0"捏造 factor——
    // guard 收紧后该兜底会腐蚀合法数据，一律 warn-only（fail-loud）。
    if (factor > 0 && (factor < 0.95 || factor > 1.05)) {
      for (let j = i; j < bars.length; j++) {
        bars[j].open *= factor;
        bars[j].high *= factor;
        bars[j].low *= factor;
        bars[j].close *= factor;
        bars[j].amount = bars[j].volume * bars[j].close; // 伪成交额同步
      }
      rescaledCount++;
      findings.push({ date: bars[i].tradeDate, pct: Number((r * 100).toFixed(1)), action: 'rescaled' });
    } else {
      findings.push({ date: bars[i].tradeDate, pct: Number((r * 100).toFixed(1)), action: 'warn-only' });
    }
  }
  return { bars, findings, rescaledCount };
}

function computeAnnualizedVol(bars: StagingBar[]): number {
  const n = bars.length;
  if (n < 30) return 0;
  const rets: number[] = [];
  for (let i = Math.max(1, n - 121); i < n; i++) {
    rets.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
  }
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Number((Math.sqrt(v) * Math.sqrt(250)).toFixed(4));
}

/** 简单的 6 位 A 股代码校验（池外拉取的目标必须是可拉取的 A 股/ETF） */
export function isPlausibleAShareCode(code: string): boolean {
  const bare = code.split('.')[0];
  return /^\d{6}$/.test(bare) && /^[0-9]/.test(bare);
}

/** 拉取池外标的 → 断裂检测 → 快照 → 落缓存区，返回质量报告 */
export async function fetchToStaging(code: string, target: StagingTarget): Promise<StagingQualityReport> {
  const bare = code.split('.')[0];
  if (!isPlausibleAShareCode(code)) {
    throw new Error(`无效代码「${code}」：只支持 6 位 A 股/ETF 代码`);
  }
  const dir = ensureDirs(target);

  const [rawBars, quote] = await Promise.all([
    fetchTencentHfqDaily(bare),
    fetchTencentQuote(bare).catch(() => null),
  ]);

  const { bars, findings, rescaledCount } = detectAndFixBreaks(rawBars);
  const lastHfqClose = bars[bars.length - 1].close;
  const marketPrice = quote?.currentPrice ?? 0;
  const hfqToMarketFactor = marketPrice > 0 && lastHfqClose > 0 ? marketPrice / lastHfqClose : 0;

  const warnings: string[] = [];
  if (!quote) warnings.push('实时快照获取失败（无市价/PE/PB，factor 未定）');
  if (bars.length < 250) warnings.push(`历史不足一年（${bars.length} 根），波动率/回测置信度有限`);
  const warnOnly = findings.filter((f) => f.action === 'warn-only');
  if (warnOnly.length) {
    warnings.push(
      `${warnOnly.length} 处疑似断裂仅告警未重标定（VWAP 同向或数据源无真实成交额）：${warnOnly
        .slice(0, 3)
        .map((f) => `${f.date}(${f.pct}%)`)
        .join(', ')}`,
    );
  }

  const report: StagingQualityReport = {
    code: bare,
    name: quote?.name || bare,
    target,
    barCount: bars.length,
    firstDate: bars[0].tradeDate,
    lastDate: bars[bars.length - 1].tradeDate,
    coverageYears: Number(((new Date(bars[bars.length - 1].tradeDate).getTime() - new Date(bars[0].tradeDate).getTime()) / (365.25 * 86400000)).toFixed(1)),
    annualizedVol: computeAnnualizedVol(bars),
    suspiciousBreaks: findings,
    rescaledCount,
    marketPrice,
    hfqToMarketFactor: Number(hfqToMarketFactor.toFixed(6)),
    peTTM: quote?.peTTM ?? 0,
    pb: quote?.pb ?? 0,
    warnings,
    storedAt: new Date().toISOString(),
  };

  writeFileSync(path.join(dir, `${bare}_bars.json`), JSON.stringify(bars), 'utf-8');
  writeFileSync(path.join(dir, `${bare}_meta.json`), JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

export interface StagingListItem {
  code: string;
  target: StagingTarget;
  report: StagingQualityReport;
}

export function listStaging(target: StagingTarget = 'staging'): StagingListItem[] {
  const dir = target === 'staging' ? STAGING_DIR : ANALYSIS_DIR;
  if (!existsSync(dir)) return [];
  const out: StagingListItem[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('_meta.json')) continue;
    try {
      const report = JSON.parse(readFileSync(path.join(dir, f), 'utf-8')) as StagingQualityReport;
      out.push({ code: report.code, target, report });
    } catch {
      /* 跳过损坏文件 */
    }
  }
  return out;
}

export function readPoolRegistry(): PoolRegistryEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
    return Array.isArray(data?.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

function writePoolRegistry(entries: PoolRegistryEntry[]): void {
  const payload = { version: 1, updatedAt: new Date().toISOString(), entries };
  const tmp = REGISTRY_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
  // tmp + rename 原子写（与 persistence.ts 同款）
  renameSync(tmp, REGISTRY_PATH);
}

function inferCategory(bare: string, isETF: boolean): string {
  if (!isETF) return 'stock_cn';
  if (bare.startsWith('51') || bare.startsWith('56') || bare.startsWith('58')) return 'broad_etf';
  if (bare.startsWith('518')) return 'commodity_etf';
  if (bare.startsWith('511')) return 'bond_etf';
  if (bare.startsWith('513')) return 'qdii_etf';
  return 'broad_etf';
}

/** staging bars → 统一池 parquet（pyarrow，schema 与底座完全一致），成功返回 true */
async function writeStagingToParquet(bare: string): Promise<void> {
  const barsPath = path.join(STAGING_DIR, `${bare}_bars.json`);
  const parquetPath = path.resolve(process.cwd(), 'data', 'parquet', 'daily', `${bare}_hfq.parquet`);
  const script = path.resolve(process.cwd(), 'scripts', 'staging_to_parquet.py');
  // node spawn 的 PATH 与交互 shell 不同——多候选逐个尝试（ENOENT=无此解释器，exit≠0=可能缺 pyarrow）
  const candidates = [
    process.env.PYTHON_BIN,
    'python',
    'py',
    'C:/Users/jaxiangjie/AppData/Local/Programs/Python/Python313/python.exe',
  ].filter(Boolean) as string[];
  let lastErr = '';
  for (const py of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const child = spawn(py, [script, barsPath, parquetPath, bare], { stdio: 'ignore' });
        child.on('error', () => resolve(false));
        child.on('exit', (code_) => resolve(code_ === 0 && existsSync(parquetPath)));
      } catch {
        resolve(false);
      }
    });
    if (ok) return;
    lastErr = py;
  }
  throw new Error(`staging_to_parquet.py 全部候选解释器失败（最后尝试 ${lastErr}）——请确认 pyarrow 可用`);
}

/** 确认入池：staging bars 落统一池 parquet + registry 登记。返回晋升后的 registry 条目 */
export async function promoteFromStaging(
  code: string,
  opts: { riskBudgetWeight?: number; category?: string; name?: string } = {},
): Promise<PoolRegistryEntry> {
  const bare = code.split('.')[0];
  const metaPath = path.join(STAGING_DIR, `${bare}_meta.json`);
  const barsPath = path.join(STAGING_DIR, `${bare}_bars.json`);
  if (!existsSync(metaPath) || !existsSync(barsPath)) {
    throw new Error(`staging 中无 ${bare} 的数据，请先执行拉取`);
  }
  const report = JSON.parse(readFileSync(metaPath, 'utf-8')) as StagingQualityReport;
  if (report.target !== 'staging') throw new Error('analysis 区数据不可晋升');
  if (!(report.hfqToMarketFactor > 0)) {
    throw new Error('该标的无有效快照市价（factor 未定），无法保证市价口径——请重新拉取后再晋升');
  }
  await writeStagingToParquet(bare);

  const entries = readPoolRegistry();
  const isETF = ['5', '1'].includes(bare[0]);
  const entry: PoolRegistryEntry = {
    code: bare,
    name: opts.name || report.name,
    category: opts.category || inferCategory(bare, isETF),
    isETF,
    riskBudgetWeight: opts.riskBudgetWeight ?? 0.05,
    hfqToMarketFactor: report.hfqToMarketFactor,
    addedAt: new Date().toISOString(),
    source: 'tencent_hfq',
  };
  const next = entries.filter((e) => e.code !== bare).concat(entry);
  writePoolRegistry(next);

  // 清理 staging（数据已入池；analysis 区保留可重拉的语义不受影响）
  try {
    unlinkSync(metaPath);
    unlinkSync(barsPath);
  } catch {
    /* ignore */
  }
  return entry;
}

/** realData 用：把 registry 条目转成与 mockData 模板同构的元数据模板 */
export function registryToTemplates(entries: PoolRegistryEntry[]): AShareInstrument[] {
  return entries.map((e) => ({
    id: e.code,
    code: e.code + (e.code[0] === '6' || e.code[0] === '5' ? '.SH' : '.SZ'),
    name: e.name,
    category: e.category as AShareInstrument['category'],
    isETF: e.isETF,
    stampDutyExempt: e.isETF,
    currentShares: 0,
    riskBudgetWeight: e.riskBudgetWeight,
    annualizedVol: 0.25,
    currentPrice: 0,
    preClose: 0,
    changePct: 0,
    dailyATR: 0,
    peTTM: 0,
    pb: 0,
    pePercentile: undefined,
    pbPercentile: undefined,
    profitRatePct: undefined,
    notes: '',
    dataSource: 'fallback',
    syntheticBars: true,
    isT0: false,
    bars: [],
  }));
}

/** registry 条目的 hfq→市价 factor（realData 加载 parquet 后应用） */
export function getHfqToMarketFactors(): Map<string, number> {
  const m = new Map<string, number>();
  readPoolRegistry().forEach((e) => {
    if (e.hfqToMarketFactor > 0) m.set(e.code, e.hfqToMarketFactor);
  });
  return m;
}

export const STAGING_PATHS = { CACHE_DIR, STAGING_DIR, ANALYSIS_DIR, REGISTRY_PATH };
