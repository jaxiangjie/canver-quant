import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV !== 'production';
const port = isDev ? 3000 : parseInt(process.env.PORT || '3000', 10);

const app = express();

app.use(express.json({ limit: '20mb' }));

import { INITIAL_INSTRUMENTS } from './src/services/mockData';
import { loadRealUniverse, PARQUET_DIR } from './src/services/realData';
import {
  loadPersistedStore,
  savePersistedStore,
  deletePersistedStore,
  storePathExists,
  mergeStores,
} from './src/services/persistence';
import { syncAllInstruments } from './src/services/liveMarketSync';
import { enrichUniverseValuation, loadValuationSeries } from './src/services/valuationStore';
import {
  fetchToStaging,
  listStaging,
  promoteFromStaging,
  type StagingTarget,
} from './src/services/stagingData';

// In-memory data store for A-Share instruments (real parquet data if available, else mock)
let instrumentsStore: any[] = [];

// REST API Endpoints for A-Share Data Interface
// 响应瘦身：全量 bars（20 只 × ~4000 根 ≈ 17MB）使传输易失败，触发客户端降级路径
// （浏览器直连同 + mock 兜底），曾造成真实行情被污染。前端按需经 /api/ashare/bars/:code 拉取 K 线。
function stripBars(inst: any) {
  const { bars, ...rest } = inst;
  return { ...rest, barsCount: Array.isArray(bars) ? bars.length : 0 };
}

app.get('/api/ashare/instruments', (_req, res) => {
  res.json(instrumentsStore.map(stripBars));
});

// 按需全量 K 线（深度分析/风险贡献图等前端组件消费）
app.get('/api/ashare/bars/:code', (req, res) => {
  const code = String(req.params.code || '');
  const inst = instrumentsStore.find(
    (i) => i.id === code || i.code === code || i.code.split('.')[0] === code,
  );
  if (!inst) {
    res.status(404).json({ error: `instrument not found: ${code}` });
    return;
  }
  res.json({ code: inst.code, name: inst.name, bars: inst.bars || [] });
});

// 动态解析并补全任意 A 股 / ETF 标的信息（优先在已有池寻找，未找到则从实时接口获取最新行情）
// ===== 自选组合库持久化（data/portfolios/custom_portfolios.json，随 git 提交做版本管理） =====
// 只存用户自选组合（官方预设是前端代码常量）；写走 tmp+rename 原子落盘。
const PORTFOLIOS_PATH = path.resolve(process.cwd(), 'data', 'portfolios', 'custom_portfolios.json');

app.get('/api/ashare/portfolios', (_req, res) => {
  try {
    if (!fs.existsSync(PORTFOLIOS_PATH)) {
      res.json({ success: true, portfolios: [] });
      return;
    }
    const raw = JSON.parse(fs.readFileSync(PORTFOLIOS_PATH, 'utf8'));
    res.json({ success: true, portfolios: Array.isArray(raw?.portfolios) ? raw.portfolios : [] });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'read failed' });
  }
});

app.post('/api/ashare/portfolios', (req, res) => {
  try {
    const { portfolios } = req.body;
    if (!Array.isArray(portfolios)) {
      res.status(400).json({ success: false, message: 'portfolios array required' });
      return;
    }
    fs.mkdirSync(path.dirname(PORTFOLIOS_PATH), { recursive: true });
    const tmp = PORTFOLIOS_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), portfolios }, null, 2), 'utf8');
    fs.renameSync(tmp, PORTFOLIOS_PATH); // 原子替换
    res.json({ success: true, count: portfolios.length });

  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'write failed' });
  }
});

// ===== staging 缓存区（三级数据架构 2026-10-13）=====
// 拉取池外标的到缓存区（target=staging 待确认入池 / analysis 按需分析临时数据，均 gitignore）
app.post('/api/ashare/staging/fetch', async (req, res) => {
  try {
    const { code, target } = req.body || {};
    if (!code) {
      res.status(400).json({ success: false, message: 'code required' });
      return;
    }
    const tgt: StagingTarget = target === 'analysis' ? 'analysis' : 'staging';
    const report = await fetchToStaging(String(code), tgt);
    res.json({ success: true, report });
  } catch (err: any) {
    res.status(502).json({ success: false, message: err?.message || 'fetch failed' });
  }
});

app.get('/api/ashare/staging', (_req, res) => {
  try {
    res.json({ success: true, items: listStaging('staging') });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'list failed' });
  }
});

// 确认入池：staging bars → 统一池 parquet + registry 登记 → 刷新内存 catalog
app.post('/api/ashare/staging/promote', async (req, res) => {
  try {
    const { code, riskBudgetWeight, category, name } = req.body || {};
    if (!code) {
      res.status(400).json({ success: false, message: 'code required' });
      return;
    }
    const entry = await promoteFromStaging(String(code), {
      riskBudgetWeight: typeof riskBudgetWeight === 'number' ? riskBudgetWeight : undefined,
      category: category ? String(category) : undefined,
      name: name ? String(name) : undefined,
    });
    // 晋升后刷新 catalog（registry → loadRealUniverse）+ 估值富化，主页面全链路立即可用
    const base = await loadRealUniverse();
    const enr = enrichUniverseValuation(base);
    instrumentsStore = enr.instruments;
    console.log(
      `[staging] promoted ${entry.code} ${entry.name} — catalog 现为 ${instrumentsStore.length} 只`,
    );
    res.json({ success: true, entry, catalogSize: instrumentsStore.length });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'promote failed' });
  }
});

app.get('/api/ashare/resolve-symbol/:code', async (req, res) => {
  try {
    const rawCode = String(req.params.code || '').trim().toUpperCase();
    const cleanNum = rawCode.replace(/\.(SH|SZ|BJ)$/i, '');
    
    // 1. 已有标的池快速命中
    const existing = instrumentsStore.find(
      (i) => i.id === cleanNum || i.code === rawCode || i.code.split('.')[0] === cleanNum
    );
    if (existing) {
      return res.json({
        success: true,
        source: 'catalog',
        instrument: stripBars(existing),
      });
    }

    // 2. 标的池外：实时网络拉取腾讯行情快照
    const { codeToTencentSymbol, fetchBatchTencentQuotes } = await import('./src/services/liveMarketSync');
    const secid = codeToTencentSymbol(cleanNum);
    const quotes = await fetchBatchTencentQuotes([secid]);
    const q = quotes.get(secid);

    if (!q || !q.name || q.currentPrice <= 0) {
      return res.status(404).json({
        success: false,
        message: `无法解析代码 [${rawCode}]，请检查是否为有效的 A 股或 ETF 代码`,
      });
    }

    // 推断标的分类与市场后缀
    const isETF = cleanNum.startsWith('51') || cleanNum.startsWith('15') || cleanNum.startsWith('58') || cleanNum.startsWith('56');
    const suffix = secid.startsWith('sh') ? 'SH' : 'SZ';
    const fullCode = `${cleanNum}.${suffix}`;

    let category: any = 'broad_etf';
    if (isETF) {
      if (cleanNum.startsWith('511') || cleanNum.startsWith('159')) category = 'bond_etf';
      else if (cleanNum.startsWith('518') || cleanNum.startsWith('159937')) category = 'commodity_etf';
      else if (cleanNum.startsWith('513')) category = 'qdii_etf';
      else if (cleanNum.startsWith('56') || cleanNum.startsWith('512') || cleanNum.startsWith('515') || cleanNum.startsWith('159')) category = 'sector_etf';
    } else {
      category = 'stock_cn';
    }

    // 估算基准波动率 (行业ETF 32%，宽基 22%，个股 28%，国债 5%)
    let estVol = 0.25;
    if (category === 'sector_etf') estVol = 0.35;
    else if (category === 'bond_etf') estVol = 0.05;
    else if (category === 'qdii_etf') estVol = 0.28;
    else if (category === 'commodity_etf') estVol = 0.18;

    const resolvedInst: any = {
      id: cleanNum,
      code: fullCode,
      name: q.name,
      category,
      isETF,
      isT0: category === 'bond_etf' || category === 'commodity_etf' || category === 'qdii_etf',
      stampDutyExempt: isETF,
      currentPrice: q.currentPrice,
      preClose: q.preClose,
      changePct: q.preClose > 0 ? Number((((q.currentPrice - q.preClose) / q.preClose) * 100).toFixed(2)) : 0,
      dailyATR: Number((q.currentPrice * (estVol / 15.8)).toFixed(4)),
      annualizedVol: estVol,
      riskBudgetWeight: 0.10,
      currentShares: 0,
      peTTM: q.peTTM,
      pb: q.pb,
      dataSource: 'realtime_synced',
    };

    res.json({
      success: true,
      source: 'live_network',
      instrument: resolvedInst,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || '解析失败' });
  }
});

// 估值历史序列（提供给前端回测与图表消费，无须浏览器端直接读文件系统）
app.get('/api/ashare/valuation-series', async (_req, res) => {
  try {
    const seriesMap = loadValuationSeries();
    const result: Record<string, any[]> = {};
    for (const [k, v] of seriesMap.entries()) {
      result[k] = v;
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load valuation series' });
  }
});

// 数据时效与覆盖率检测
app.get('/api/ashare/freshness', (_req, res) => {
  let maxTradeDate = '';
  for (const inst of instrumentsStore) {
    if (Array.isArray(inst.bars) && inst.bars.length > 0) {
      const d = inst.bars[inst.bars.length - 1].tradeDate;
      if (d && (!maxTradeDate || d > maxTradeDate)) {
        maxTradeDate = d;
      }
    }
  }
  const fallbackCount = instrumentsStore.filter((i: any) => i?.dataSource === 'fallback' || i?.syntheticBars).length;
  res.json({
    maxTradeDate,
    totalCount: instrumentsStore.length,
    realCount: instrumentsStore.length - fallbackCount,
    fallbackCount,
  });
});

// 在线增量拉取最新交易日数据并同步 (GET)
app.get('/api/ashare/sync-latest', async (_req, res) => {
  try {
    const { updatedInstruments, report } = await syncAllInstruments(instrumentsStore);
    if (updatedInstruments.length > 0) {
      instrumentsStore = updatedInstruments;
      savePersistedStore(instrumentsStore, 'sync-latest');
    }
    res.json({
      success: true,
      report,
      instruments: instrumentsStore.map(stripBars),
    });
  } catch (err: any) {
    console.error('[sync-latest] failed:', err);
    res.status(500).json({ success: false, message: err?.message || 'Sync failed' });
  }
});

// 在线增量拉取最新交易日数据并同步 (POST 可支持指定代码)
app.post('/api/ashare/sync-latest', async (req, res) => {
  try {
    const targetCodes: string[] | null = Array.isArray(req.body?.codes) ? req.body.codes : null;
    let pool = instrumentsStore;
    if (targetCodes && targetCodes.length > 0) {
      pool = instrumentsStore.filter(i => targetCodes.includes(i.code) || targetCodes.includes(i.id));
    }
    const { updatedInstruments, report } = await syncAllInstruments(pool);
    const codeMap = new Map(updatedInstruments.map(u => [u.id, u]));
    instrumentsStore = instrumentsStore.map(i => codeMap.get(i.id) || i);
    savePersistedStore(instrumentsStore, 'sync-latest');
    res.json({ success: true, report, instruments: instrumentsStore.map(stripBars) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Sync failed' });
  }
});

app.post('/api/ashare/ingest', (req, res) => {
  try {
    const { instruments } = req.body;
    if (Array.isArray(instruments) && instruments.length > 0) {
      // 数据完整性防御：ingest 的语义是「用户操作结果提交」（持仓/权重变更），不是行情数据提交。
      // 行情字段（currentPrice/bars/pe/pb/名称/类别等）一律以服务端为权威，仅接受
      // currentShares/riskBudgetWeight 两个用户可编辑字段；服务端不存在的 code 才整体接纳（自定义标的）。
      // 历史事故：前端 fetch 失败回退 localStorage 过期 universe（mock 价格+空 bars），
      // 用户一次改持仓即把 20 只真实行情全量污染成 mock 值。
      const serverByCode = new Map(instrumentsStore.map(i => [i.code, i]));
      let preserved = 0;
      const merged = instruments.map((p: any) => {
        const s = serverByCode.get(p?.code);
        if (!s) return p; // 自定义新标的：整体接纳
        preserved++;
        return {
          ...s,
          currentShares: typeof p?.currentShares === 'number' ? p.currentShares : s.currentShares,
          riskBudgetWeight: typeof p?.riskBudgetWeight === 'number' ? p.riskBudgetWeight : s.riskBudgetWeight,
        };
      });
      savePersistedStore(merged, 'ingest'); // 先原子落盘，失败则直接抛错不污染内存
      instrumentsStore = merged;
      res.json({
        success: true,
        count: merged.length,
        preservedMarketData: preserved,
        message: `数据接入成功（已持久化；${preserved} 只已存在标的的行情字段以服务端为权威，仅接受持仓/权重）`,
      });
    } else {
      res.status(400).json({ success: false, message: 'Invalid payload: instruments array required' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

// 清空持久化 store 并重置内存态为原生行情池
app.delete('/api/ashare/store', async (_req, res) => {
  try {
    const removed = deletePersistedStore();
    if (removed) {
      try {
        const real = await loadRealUniverse();
        instrumentsStore = real.length ? real : INITIAL_INSTRUMENTS;
      } catch {
        instrumentsStore = INITIAL_INSTRUMENTS;
      }
    }
    res.json({ success: true, removed, message: removed ? '持久化数据已清除并重置为原生基础池' : '无持久化数据' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

// SSRF 防护：仅允许显式白名单内的主机通过服务端代理请求。
// 旧实现允许客户端指定任意 targetUrl 由服务端 fetch，可被用于探测内网。
const PROXY_ALLOWED_HOSTS = (process.env.PROXY_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isProxyHostAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (PROXY_ALLOWED_HOSTS.length === 0) return false; // 未配置白名单则一律拒绝
    const host = u.hostname.toLowerCase();
    return PROXY_ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

app.post('/api/ashare/proxy', async (req, res) => {
  try {
    const { targetUrl, headers, method, body } = req.body;
    if (!targetUrl) {
      res.status(400).json({ error: 'targetUrl is required' });
      return;
    }
    if (!isProxyHostAllowed(targetUrl)) {
      res.status(403).json({
        error: 'targetUrl host not allowed',
        hint: 'set PROXY_ALLOWED_HOSTS env (comma separated) to enable specific hosts',
      });
      return;
    }
    const response = await fetch(targetUrl, {
      method: method || 'GET',
      headers: headers || { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: 'Proxy request failed', details: err?.message });
  }
});

// 数据湖自动巡检定时任务框架 (Data Sentinel Framework)
// 目前仅预留框架结构与手动巡检接口，默认未开启自动调度器
export interface DataSentinelReport {
  lastCheckTime: string;
  totalParquetFiles: number;
  corruptedFiles: string[];
  anomalousVolCount: number;
  status: 'HEALTHY' | 'WARNING' | 'ERROR';
}

let lastSentinelReport: DataSentinelReport = {
  lastCheckTime: new Date().toISOString(),
  totalParquetFiles: 22,
  corruptedFiles: [],
  anomalousVolCount: 0,
  status: 'HEALTHY',
};

export function runDataSentinelCheck(): DataSentinelReport {
  const anomalies: string[] = [];
  let anomalousVol = 0;
  instrumentsStore.forEach((inst) => {
    if (typeof inst.annualizedVol === 'number' && (inst.annualizedVol < 0.02 || inst.annualizedVol > 0.80)) {
      anomalousVol++;
    }
  });

  lastSentinelReport = {
    lastCheckTime: new Date().toISOString(),
    totalParquetFiles: instrumentsStore.length,
    corruptedFiles: anomalies,
    anomalousVolCount: anomalousVol,
    status: anomalousVol > 0 ? 'WARNING' : 'HEALTHY',
  };
  return lastSentinelReport;
}

app.get('/api/health', (_req, res) => {
  const fallbackCount = instrumentsStore.filter((i: any) => i?.dataSource === 'fallback').length;
  const barDates = instrumentsStore.flatMap((i: any) =>
    Array.isArray(i.bars) && i.bars.length ? [i.bars[i.bars.length - 1].tradeDate] : [],
  );
  barDates.sort();
  const latestBar = barDates.length ? barDates[barDates.length - 1] : '';
  const stalenessDays = latestBar
    ? Math.floor((Date.now() - new Date(latestBar + 'T00:00:00+08:00').getTime()) / 86400000)
    : null;
  res.json({
    status: 'online',
    system: 'Carver A-Share Quantitative System',
    timestamp: new Date().toISOString(),
    instrumentsCount: instrumentsStore.length,
    realCount: instrumentsStore.length - fallbackCount,
    fallbackCount, // 无 parquet、回退合成模板的标的数（>0 表示部分行情并非真实）
    persisted: storePathExists(),
    latestBarDate: latestBar,
    stalenessDays, // parquet 最新 bar 距今天数（>3 提示重建）
    dataSentinel: {
      frameworkEnabled: true,
      schedulerActive: false, // 遵循用户要求：预留框架，暂不启动自动定时
      lastReport: lastSentinelReport,
    },
  });
});

// 手动触发巡检接口（支持预留框架按需调用）
app.post('/api/ashare/sentinel/check', (_req, res) => {
  const rep = runDataSentinelCheck();
  res.json({ success: true, report: rep });
});

// 启动时加载顺序：llmquant 的本地 parquet 真实数据 -> 合并持久化覆盖(持仓/权重) -> 无则回退 mock
async function initStore() {
  // 1. 基础池：真实 parquet 或 mock
  let base: any[] = [];
  if (process.env.USE_REAL_DATA !== 'false') {
    try {
      const real = await loadRealUniverse();
      if (real.length) {
        base = real;
        // 如实区分真实 parquet 与回退模板：旧实现无论读到什么都打印 "loaded N from parquet"，
        // 即使 parquet 目录整个不存在也会谎报成功，用户以为在看真实行情。
        const fb = real.filter((i: any) => i?.dataSource === 'fallback').length;
        console.log(
          `[real-data] loaded ${real.length} instruments from parquet (real=${real.length - fb}, fallback=${fb}) @ ${PARQUET_DIR}`,
        );
        if (fb > 0) {
          console.warn(
            `[real-data] ${fb} 标的无 parquet 数据，已回退合成模板 —— 这部分行情并非真实，回测结论需谨慎`,
          );
        }
      }
    } catch (err: any) {
      console.warn('[real-data] load failed:', err?.message);
    }
  }
  if (!base.length) {
    base = [...INITIAL_INSTRUMENTS];
    console.log('[real-data] using mock instruments');
  }

  // 2. 合并持久化 store（RESET_STORE=true 时忽略，强制重新从 parquet 加载）
  if (process.env.RESET_STORE !== 'true' && storePathExists()) {
    const persisted = loadPersistedStore();
    if (persisted && Array.isArray(persisted.instruments) && persisted.instruments.length) {
      const deletedCodes: string[] = Array.isArray(persisted.deletedCodes) ? persisted.deletedCodes : [];
      // 防御性警告：deletedCodes 与当前 catalog 有交集 = 过时删除记录正在屏蔽真实标的
      // （历史事故：11 个个股 code 的旧删除码把 poorlab11 静默砍成 1 只，debug 成本极高）
      const shadowed = deletedCodes.filter((c) => base.some((i: any) => i?.code === c));
      if (shadowed.length) {
        console.warn(
          `[persistence] ⚠️ ${shadowed.length} 个 code 同时存在于 deletedCodes 与当前 catalog：` +
            `${shadowed.join(', ')} —— 过时删除记录会屏蔽这些标的，请清理 data/store.json 的 deletedCodes`,
        );
      }
      base = mergeStores(base, persisted.instruments, deletedCodes);
      console.log(
        `[persistence] merged ${persisted.instruments.length} persisted instruments (savedAt=${persisted.savedAt}` +
          `${deletedCodes.length ? `, deleted=${deletedCodes.length}` : ''})`,
      );
    }
  }

  // 3. 估值富化：从快照库历史计算 pe/pb 分位（宽基 ETF 映射指数 PE）
  try {
    const enr = enrichUniverseValuation(base);
    base = enr.instruments;
    if (enr.report.enriched > 0) {
      console.log(
        `[valuation] enriched ${enr.report.enriched} instruments with real percentiles (skipped ${enr.report.skipped})`,
      );
    }
  } catch (err: any) {
    console.warn('[valuation] enrich failed:', err?.message);
  }

  // 4. 基本面与财务质量富化：注入 ROE、净利润同比、营收同比、股息率与价值陷阱评分
  try {
    const { enrichUniverseFundamentals } = await import('./src/services/fundamentalService');
    base = enrichUniverseFundamentals(base);
    console.log(`[fundamentals] enriched ${base.length} instruments with fundamental health metrics`);
  } catch (err: any) {
    console.warn('[fundamentals] enrich failed:', err?.message);
  }

  // 市价口径兜底（启动即生效，不依赖腾讯）：parquet 的 currentPrice 是 hfq 后复权价，
  // 直接用于定仓会按复权因子算错目标股数。以 realData 算出的 VWAP（amount/volume，
  // 原始成交数据不经复权）覆盖；随后启动自动同步会用快照实时价再覆盖（更新）。
  base = base.map((inst: any) =>
    typeof inst.vwapPrice === 'number' && inst.vwapPrice > 0
      ? { ...inst, currentPrice: inst.vwapPrice }
      : inst,
  );

  // 数据新鲜度自检：parquet 最新 bar 距今天数（>3 天提示重建，防止看着陈旧 K 线做决策）
  try {
    const allDates: string[] = base.flatMap((i: any) =>
      Array.isArray(i.bars) && i.bars.length ? [i.bars[i.bars.length - 1].tradeDate] : [],
    );
    if (allDates.length) {
      allDates.sort();
      const latest = allDates[allDates.length - 1];
      const ageDays = Math.floor(
        (Date.now() - new Date(latest + 'T00:00:00+08:00').getTime()) / 86400000,
      );
      if (ageDays > 3) {
        console.warn(
          `[data-freshness] ⚠️ parquet 最新 bar ${latest}（${ageDays} 天前），数据陈旧，建议重建 parquet（AKShare hfq 增量更新）`,
        );
      } else {
        console.log(`[data-freshness] latest bar ${latest}（${ageDays} 天前）`);
      }
    }
  } catch (err: any) {
    console.warn('[data-freshness] check failed:', err?.message);
  }

  instrumentsStore = base;
}

// Vite dev server mounting in development, or static hosting in production
async function startServer() {
  await initStore();
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Carver A-Share Portfolio Server listening on http://0.0.0.0:${port}`);
  });

  // 启动后自动同步一次实时快照（市价 + 估值双通道互验）：
  // parquet 底座的 currentPrice 是后复权收盘价（hfq），不刷新则定仓公式
  // 「目标股数 = 目标市值 ÷ 价格」按 hfq 价计算、错一个复权因子——601857 实测差 1.86 倍，
  // 福耀玻璃 hfq 5248 更会被单标的 cap（25%）直接截到 0 股。
  // 同步已重构为纯快照路径（不拉日线、不碰 bars），秒级完成；失败仅告警不阻塞。
  // 禁用：AUTO_SYNC_ON_START=false
  if (process.env.AUTO_SYNC_ON_START !== 'false') {
    (async () => {
      try {
        const { updatedInstruments, report } = await syncAllInstruments(instrumentsStore);
        instrumentsStore = updatedInstruments;
        console.log(
          `[auto-sync] snapshot synced: updated=${report.updatedCount}/${report.totalInstruments}` +
            ` latestTradingDate=${report.latestTradingDate || 'n/a'}` +
            ` valuationSnapshots=${report.valuationSnapshotsAppended ?? 0}`,
        );
      } catch (err: any) {
        console.warn(
          '[auto-sync] failed (非致命：价格保持 parquet hfq 口径，可手动触发同步刷新):',
          err?.message,
        );
      }
    })();
  }
}

startServer();
