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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  renameSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { AShareInstrument } from '../types/ashare';
import { codeToTencentSymbol } from './liveMarketSync';
import { scanAndRescaleBreaks, type BreakFinding } from './breakDetection';

export type { BreakFinding };

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
  /** 配对 bars 文件的字节数——promote 时校验 meta/bars 未被并发轮次改写（撕裂写入防护） */
  barsBytes?: number;
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
    // 每页 15s 超时 + 失败重试 1 次（tribunal G2c8：旧版一次 5xx/超时就抛错，
    // 已收集的全部 bars 随内存一起丢弃，用户只能整轮重拉）
    let res: Response | null = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        const r = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) res = r;
        else if (attempt === 1) throw new Error(`tencent hfq http ${r.status}`);
      } catch (e: any) {
        if (attempt === 1) {
          throw new Error(
            `tencent hfq 第 ${page + 1} 页网络失败（已收集 ${collected.size} 根，重试 1 次后仍失败）: ${e?.message || e}`,
          );
        }
        await new Promise((r2) => setTimeout(r2, 1000));
      }
    }
    if (!res) throw new Error(`tencent hfq 第 ${page + 1} 页无响应`);
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


/**
 * 复权断裂检测 + VWAP 甄别重标定——逻辑已抽至 breakDetection.ts 单一模块
 * （tribunal G1c6/G2c3：旧版是手抄副本，与 realData 内联块已漂移）。
 * staging 源的 amount 是伪成交额（volShares×close）——模块按数据驱动指纹自动
 * 识别为合成源，VWAP 甄别对其数学上不可用，只做候选检测 + warn-only，绝不捏造
 * factor（tribunal V5/V6）。上游若换源提供真实 amount，甄别自动恢复（无需改代码）。
 */
export function detectAndFixBreaks(bars: StagingBar[]): {
  bars: StagingBar[];
  findings: BreakFinding[];
  rescaledCount: number;
} {
  const scan = scanAndRescaleBreaks(bars as any[], {
    normDate: (d) => String(d).slice(0, 10),
  });
  return { bars, findings: scan.findings, rescaledCount: scan.rescaledCount };
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

/** 拉取池外标的 → 断裂检测 → 快照 → 落缓存区，返回质量报告（同 code 串行执行，见 withStagingLock） */
export async function fetchToStaging(code: string, target: StagingTarget): Promise<StagingQualityReport> {
  return withStagingLock(`staging:${code.split('.')[0]}`, async () => {
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
    // factor 时间戳一致性（tribunal G1c5 生产侧）：quote.tradeDate 与 bars 末交易日必须
    // 一致。盘中晋升会把当日波动烤进 factor 并永久固化（唯一刷新途径是重新晋升）。
    // 不阻断（快照盘中价 vs 上一交易日 bars 是常见时点差），但必须显式警告。
    if (quote?.tradeDate && bars.length && quote.tradeDate !== bars[bars.length - 1].tradeDate) {
      warnings.push(
        `快照日期 ${quote.tradeDate} 与末交易日 ${bars[bars.length - 1].tradeDate} 不一致——hfqToMarketFactor 含时点差（建议收盘后拉取）`,
      );
    }
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

    // 先写 bars、后写 meta（meta 是「本轮完成」标记）；barsBytes 记账供 promote 校验配对
    const barsJson = JSON.stringify(bars);
    report.barsBytes = Buffer.byteLength(barsJson, 'utf-8');
    writeFileSync(path.join(dir, `${bare}_bars.json`), barsJson, 'utf-8');
    writeFileSync(path.join(dir, `${bare}_meta.json`), JSON.stringify(report, null, 2), 'utf-8');
    return report;
  });
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

/**
 * promote 专用严格读取：文件损坏/结构异常必须抛错中止晋升。
 * tribunal G2c3：旧版 promote 复用宽容读取，registry 一坏就以「仅含新条目」的数组
 * 覆盖写回——整个池的登记被静默抹掉（parquet 还在但 catalog 再也不引用）。
 * 读失败时的正确行为是拒绝写入，不是降级成空数组。
 */
function readPoolRegistryStrict(): PoolRegistryEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  let data: any;
  try {
    data = JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch (e: any) {
    throw new Error(`读取 pool_registry.json 失败（${e?.message || e}）——已中止晋升，防止覆盖写清空已登记数据`);
  }
  if (!Array.isArray(data?.entries)) {
    throw new Error('pool_registry.json 结构损坏（entries 非数组）——已中止晋升，防止覆盖写清空已登记数据');
  }
  return data.entries as PoolRegistryEntry[];
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
  // node spawn 的 PATH 与交互 shell 不同——多候选逐个尝试（ENOENT=无此解释器，exit≠0=可能缺 pyarrow）。
  // 个人绝对路径改为从 LOCALAPPDATA 动态推导，避免把某台机器的用户名提交进源码。
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.PYTHON_BIN,
    'python',
    'py',
    localAppData ? path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe') : '',
  ].filter(Boolean) as string[];
  const SPAWN_TIMEOUT_MS = 120000;
  let lastErr = '';
  for (const py of candidates) {
    const outcome = await new Promise<{ ok: boolean; err: string }>((resolve) => {
      try {
        const child = spawn(py, [script, barsPath, parquetPath, bare], {
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        // 超时强杀：hung python（pyarrow 卡死/文件锁）曾能让 promote 请求永远挂起
        const timer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }, SPAWN_TIMEOUT_MS);
        let stderrTail = '';
        child.stderr?.on('data', (d) => {
          stderrTail = (stderrTail + String(d)).slice(-400);
        });
        const settle = (ok: boolean, err: string) => {
          clearTimeout(timer);
          resolve({ ok, err });
        };
        child.on('error', (e) => settle(false, `spawn 失败: ${e.message}`));
        child.on('exit', (code_, signal) => {
          if (code_ === 0 && existsSync(parquetPath)) settle(true, '');
          else if (signal) settle(false, `超时 ${SPAWN_TIMEOUT_MS / 1000}s 被杀（${signal}）`);
          else settle(false, `exit ${code_}${stderrTail ? ' | ' + stderrTail.trim() : ''}`);
        });
      } catch (e: any) {
        resolve({ ok: false, err: String(e?.message || e) });
      }
    });
    if (outcome.ok) return;
    lastErr = `${py} → ${outcome.err}`;
  }
  throw new Error(`staging_to_parquet.py 全部候选解释器失败：${lastErr}`);
}

/**
 * per-code in-flight 串行化（tribunal Cc3/G2c4）：同一 code 的 fetch/promote 绝不交叉执行。
 * 旧版零并发控制：两个 fetch 可把「A 轮 bars + B 轮 meta」混写成一对，用户按 B 的
 * 质量报告批准、晋升的却是 A 的数据；promote 也可能读到半写状态。
 * 锁 key 不含 target——fetch 与 promote 同 code 也要互斥（后者消费前者的产物）。
 */
const stagingInflight = new Map<string, Promise<unknown>>();

function withStagingLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = stagingInflight.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // 前一个无论成败都继续，不级联失败
  const tracked = run.finally(() => {
    if (stagingInflight.get(key) === tracked) stagingInflight.delete(key);
  });
  // tracked 必须挂 no-op catch：Node 15+ 默认 unhandled-rejections=throw，
  // 无人认领的 rejected promise 会直接杀进程（调用方各自 await 的是 run）。
  tracked.catch(() => {});
  stagingInflight.set(key, tracked);
  return run;
}

/** 确认入池：staging bars 落统一池 parquet + registry 登记。返回晋升后的 registry 条目 */
export async function promoteFromStaging(
  code: string,
  opts: { riskBudgetWeight?: number; category?: string; name?: string } = {},
): Promise<PoolRegistryEntry> {
  return withStagingLock(`staging:${code.split('.')[0]}`, async () => {
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
    // meta/bars 一致性：meta 记录了配对 bars 的字节数，不一致说明被并发轮次改动过（撕裂写入），
    // 宁可诚实失败也不把「报告描述 A、实际内容是 B」的数据晋升入池。
    if (typeof report.barsBytes === 'number') {
      let actualBytes = -1;
      try {
        actualBytes = statSync(barsPath).size;
      } catch {
        /* 下面统一抛错 */
      }
      if (actualBytes !== report.barsBytes) {
        throw new Error(`staging 数据不完整（bars 与 meta 不配对，${actualBytes}≠${report.barsBytes}）——请重新拉取后再晋升`);
      }
    }
    await writeStagingToParquet(bare);

    // 严格读取：registry 损坏时中止晋升，而不是用只含新条目的数组覆盖写（G2c3）
    const entries = readPoolRegistryStrict();
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
  });
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
export function getHfqToMarketFactors(entries?: PoolRegistryEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  (entries ?? readPoolRegistry()).forEach((e) => {
    if (e.hfqToMarketFactor > 0) m.set(e.code, e.hfqToMarketFactor);
  });
  return m;
}

export const STAGING_PATHS = { CACHE_DIR, STAGING_DIR, ANALYSIS_DIR, REGISTRY_PATH };
