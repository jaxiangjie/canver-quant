import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 落盘目录：项目根 / data（与 src/services 相对两级）
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

export interface PersistedStore {
  version: number;
  savedAt: string;
  source: 'ingest' | 'manual';
  instruments: any[];
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadPersistedStore(): PersistedStore | null {
  try {
    if (!fs.existsSync(STORE_PATH)) return null;
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.instruments)) return null;
    return obj as PersistedStore;
  } catch {
    return null;
  }
}

/**
 * 落盘时剔除 bars（真实数据每次从 parquet 重新加载，bars 体积大且无必要持久化），
 * 仅保留 code 与可编辑持仓/权重字段，供重启后合并覆盖。
 */
export function savePersistedStore(instruments: any[], source: 'ingest' | 'manual' = 'ingest'): void {
  ensureDataDir();
  const slim = (Array.isArray(instruments) ? instruments : []).map(({ bars, ...rest }: any) => rest);
  const payload: PersistedStore = {
    version: 1,
    savedAt: new Date().toISOString(),
    source,
    instruments: slim,
  };
  fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
}

export function deletePersistedStore(): boolean {
  try {
    if (fs.existsSync(STORE_PATH)) {
      fs.unlinkSync(STORE_PATH);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function storePathExists(): boolean {
  return fs.existsSync(STORE_PATH);
}

/**
 * 将持久化的标的合并进"真实基础池"：
 * - 命中 code 的标的：仅覆盖可编辑的持仓/权重字段（currentShares / riskBudgetWeight），
 *   价格、波动率、bars 等仍由 parquet 实时刷新 —— 既保留 ingest 编辑，又保证行情新鲜。
 * - 未命中的 code（自定义标的）：整体追加。
 */
export function mergeStores(base: any[], persisted: any[]): any[] {
  const result = (Array.isArray(base) ? base : []).map((i) => ({ ...i }));
  const byCode = new Map(result.map((i) => [i.code, i]));
  const appended: any[] = [];
  for (const p of Array.isArray(persisted) ? persisted : []) {
    const b = byCode.get(p.code);
    if (b) {
      if (typeof p.currentShares === 'number') b.currentShares = p.currentShares;
      if (typeof p.riskBudgetWeight === 'number') b.riskBudgetWeight = p.riskBudgetWeight;
    } else {
      appended.push(p);
    }
  }
  return result.concat(appended);
}
