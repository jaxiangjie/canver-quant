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
import { loadRealUniverse } from './src/services/realData';
import {
  loadPersistedStore,
  savePersistedStore,
  deletePersistedStore,
  storePathExists,
  mergeStores,
} from './src/services/persistence';

// In-memory data store for A-Share instruments (real parquet data if available, else mock)
let instrumentsStore: any[] = [];

// REST API Endpoints for A-Share Data Interface
app.get('/api/ashare/instruments', (_req, res) => {
  res.json(instrumentsStore);
});

app.post('/api/ashare/ingest', (req, res) => {
  try {
    const { instruments } = req.body;
    if (Array.isArray(instruments) && instruments.length > 0) {
      instrumentsStore = instruments;
      savePersistedStore(instruments, 'ingest'); // 落盘，重启后合并覆盖
      res.json({ success: true, count: instruments.length, message: '数据接入成功（已持久化）' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid payload: instruments array required' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
});

// 清空持久化 store（下次重启重新从 parquet 加载真实数据）
app.delete('/api/ashare/store', (_req, res) => {
  const removed = deletePersistedStore();
  res.json({ success: true, removed, message: removed ? '持久化数据已清除' : '无持久化数据' });
});

app.post('/api/ashare/proxy', async (req, res) => {
  try {
    const { targetUrl, headers, method, body } = req.body;
    if (!targetUrl) {
      res.status(400).json({ error: 'targetUrl is required' });
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
          `[real-data] loaded ${real.length} instruments from parquet (real=${real.length - fb}, fallback=${fb}) @ ${
            process.env.REAL_DATA_DIR || 'E:/quant-platform/data/parquet/daily'
          }`,
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
