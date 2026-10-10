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

// In-memory data store for A-Share instruments
let instrumentsStore: any[] = [...INITIAL_INSTRUMENTS];

// REST API Endpoints for A-Share Data Interface
app.get('/api/ashare/instruments', (_req, res) => {
  res.json(instrumentsStore);
});

app.post('/api/ashare/ingest', (req, res) => {
  try {
    const { instruments } = req.body;
    if (Array.isArray(instruments) && instruments.length > 0) {
      instrumentsStore = instruments;
      res.json({ success: true, count: instruments.length, message: '数据接入成功' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid payload: instruments array required' });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message || 'Server error' });
  }
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
  res.json({
    status: 'online',
    system: 'Carver A-Share Quantitative System',
    timestamp: new Date().toISOString(),
    instrumentsCount: instrumentsStore.length
  });
});

// Vite dev server mounting in development, or static hosting in production
async function startServer() {
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
