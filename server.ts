import express from 'express';
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

// In-memory data store for A-Share instruments (real parquet data if available, else mock)
let instrumentsStore: any[] = [];

// REST API Endpoints for A-Share Data Interface
app.get('/api/ashare/instruments', (_req, res) => {
  res.json(instrumentsStore);
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
      instruments: instrumentsStore,
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
    res.json({ success: true, report, instruments: instrumentsStore });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Sync failed' });
  }
});

app.post('/api/ashare/ingest', (req, res) => {
  try {
    const { instruments } = req.body;
    if (Array.isArray(instruments) && instruments.length > 0) {
      savePersistedStore(instruments, 'ingest'); // 先原子落盘，失败则直接抛错不污染内存
      instrumentsStore = instruments;
      res.json({ success: true, count: instruments.length, message: '数据接入成功（已持久化）' });
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

app.get('/api/health', (_req, res) => {
  const fallbackCount = instrumentsStore.filter((i: any) => i?.dataSource === 'fallback').length;
  res.json({
    status: 'online',
    system: 'Carver A-Share Quantitative System',
    timestamp: new Date().toISOString(),
    instrumentsCount: instrumentsStore.length,
    realCount: instrumentsStore.length - fallbackCount,
    fallbackCount, // 无 parquet、回退合成模板的标的数（>0 表示部分行情并非真实）
    persisted: storePathExists(),
  });
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
      base = mergeStores(base, persisted.instruments, persisted.deletedCodes || []);
      console.log(
        `[persistence] merged ${persisted.instruments.length} persisted instruments (savedAt=${persisted.savedAt}` +
          `${persisted.deletedCodes?.length ? `, deleted=${persisted.deletedCodes.length}` : ''})`,
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
}

startServer();
