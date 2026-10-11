import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_INSTRUMENTS } from './mockData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 落盘目录：项目根 / data（与 src/services 相对两级）
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const TMP_PATH = `${STORE_PATH}.tmp`;

// 模板标的 = 有 parquet 数据源的标的，其 bars 可由 parquet 重新加载，无需持久化
const TEMPLATE_CODES = new Set(INITIAL_INSTRUMENTS.map((i) => i.code));

export interface PersistedStore {
  version: number;
  savedAt: string;
  source: 'ingest' | 'manual' | 'sync-latest';
  instruments: any[];
  deletedCodes?: string[]; // 用户删除的模板标的 code（重启后不得因 mergeStores 而复活）
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
 * 落盘。三条关键保证：
 * 1. 模板标的（有 parquet 源）剔除 bars —— 重启后由 parquet 重新加载，保持文件小巧。
 *    自定义标的（无 parquet 源）保留 bars —— 否则重启后 bars 丢失，前端 hydrate 会
 *    静默生成一段伪随机 K 线，使回测与相关性计算建立在假数据上。
 * 2. 记录 deletedCodes —— 用户删除的模板标的，避免 mergeStores「只增不减」让它重启复活。
 * 3. 原子写：先写 .tmp 再 rename，避免进程中断/磁盘满留下半截 JSON 导致全部编辑静默丢失。
 */
export function savePersistedStore(
  instruments: any[],
  source: 'ingest' | 'manual' | 'sync-latest' = 'ingest',
): void {
  ensureDataDir();
  const list = Array.isArray(instruments) ? instruments : [];
  const slim = list.map((inst: any) => {
    // 仅在属于初始模板且不是实时同步数据时剥离 bars；实时同步数据保留 bars 避免重启丢失
    if (TEMPLATE_CODES.has(inst?.code) && inst?.dataSource !== 'realtime_synced') {
      const { bars, ...rest } = inst;
      return rest;
    }
    return inst; // 自定义标的或已实时同步标的：保留 bars，避免重启后被合成为伪数据
  });

  // 仅在有数据时才记录删除，避免空列表把全部模板标的误判为"已删除"
  const present = new Set(list.map((i: any) => i?.code));
  const deletedCodes =
    list.length > 0 ? Array.from(TEMPLATE_CODES).filter((c) => !present.has(c)) : [];

  const payload: PersistedStore = {
    version: 2,
    savedAt: new Date().toISOString(),
    source,
    instruments: slim,
    deletedCodes,
  };
  fs.writeFileSync(TMP_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  fs.renameSync(TMP_PATH, STORE_PATH); // 同目录 rename 为原子操作
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
 * - deletedCodes：用户已删除的模板标的，从基础池中剔除，防止重启后复活。
 */
export function mergeStores(base: any[], persisted: any[], deletedCodes: string[] = []): any[] {
  const deleted = new Set(Array.isArray(deletedCodes) ? deletedCodes : []);
  const result = (Array.isArray(base) ? base : [])
    .filter((i) => !deleted.has(i?.code))
    .map((i) => ({ ...i }));
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
