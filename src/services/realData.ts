import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { AShareInstrument, AShareBar } from '../types/ashare';
import { INITIAL_INSTRUMENTS } from './mockData';
import { registryToTemplates, getHfqToMarketFactors, readPoolRegistry } from './stagingData';
import { scanAndRescaleBreaks, detectSyntheticAmount } from './breakDetection';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 真实数据适配器：对接上一级 llmquant 的本地 parquet 数据契约。
 *
 * 默认从项目内嵌数据读取（data/parquet/daily，已随仓库提交，clone 即自包含）：
 *   {项目根}/data/parquet/daily/{6位代码}_hfq.parquet
 * 与 llmquant 的数据契约一致（后复权日线，字段: date/open/high/low/close/volume/amount/code）。
 * 可用环境变量 REAL_DATA_DIR 覆盖为外部大湖（如 E:\quant-platform\data\parquet\daily）。
 * 这里复用同一份数据契约，把后复权日线转成 canver-quant 的 AShareInstrument。
 *
 * 设计：以 src/services/mockData.ts 的 INITIAL_INSTRUMENTS 作为"元数据模板"
 * （保留 category / isETF / isT0 / stampDutyExempt / riskBudgetWeight /
 * currentShares / 估值默认值），用 parquet 真实日线填充
 * currentPrice / preClose / changePct / dailyATR / annualizedVol / bars。
 * 前端 apiClient 已能 hydrate 真实 bars，因此前端零改动即可呈现真实数据。
 */

// 默认从项目内 data/parquet/daily 加载（数据自包含）；可用 REAL_DATA_DIR 覆盖为外部大湖
export const PARQUET_DIR = process.env.REAL_DATA_DIR || path.resolve(__dirname, '..', '..', 'data', 'parquet', 'daily');

// hyparquet 为纯 JS parquet 读取器（自带 TS 类型），在 Node 端直接读 llmquant 的本地 parquet
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';

function stripSuffix(code: string): string {
  return code.replace(/\.(SH|SZ)$/i, '');
}

function mean(a: number[]): number {
  if (!a.length) return 0;
  return a.reduce((x, y) => x + y, 0) / a.length;
}

function stdSample(a: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1);
  return Math.sqrt(v);
}

function normDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'number') {
    const ms = d < 1e11 ? d * 1000 : d;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return String(d).slice(0, 10);
}

interface RawRow {
  date: unknown;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number;
}

async function readRows(code: string): Promise<RawRow[]> {
  const file = `${PARQUET_DIR}/${code}_hfq.parquet`;
  if (!existsSync(file)) return [];
  const af = await asyncBufferFromFile(file);
  const rows = await parquetReadObjects({ file: af });
  return (rows || []) as RawRow[];
}

export async function loadRealUniverse(): Promise<AShareInstrument[]> {
  const out: AShareInstrument[] = [];
  let fallbackCount = 0; // 无 parquet、回退合成模板的标的数（用于暴露真实数据覆盖率，避免谎报成功）

  // 统一池 registry（2026-10-13 三级数据架构）：staging 晋升的池外标的在此扩展 catalog。
  // registry 条目同样走 parquet 底座路径（staging_to_parquet.py 产出的 schema 与底座一致）。
  // 只读一次（tribunal G1c6：旧版 registryToTemplates 与 getHfqToMarketFactors 内部各读
  // 一次文件，且 realData 还有第三份本地读取实现）。
  const registryEntries = readPoolRegistry();
  const registryTemplates = registryToTemplates(registryEntries);
  const hfqToMarketFactor = getHfqToMarketFactors(registryEntries);
  if (registryTemplates.length) {
    console.log(`[real-data] registry: +${registryTemplates.length} 晋升标的扩展 catalog`);
  }
  // 按 code 去重、base 优先（tribunal G1c6）：registry 里出现已在基础 catalog 的 code 时
  // 旧版会双列——同一标的带两份风险预算进池，组合权重被静默放大。
  const seenCodes = new Set(INITIAL_INSTRUMENTS.map((t) => stripSuffix(t.code)));
  const allTemplates: typeof INITIAL_INSTRUMENTS = [...INITIAL_INSTRUMENTS];
  for (const t of registryTemplates) {
    const bare = stripSuffix(t.code);
    if (seenCodes.has(bare)) {
      console.warn(
        `[real-data] registry 条目 ${bare}（${t.name}）已在基础 catalog 中，跳过重复登记（防止双份风险预算）`,
      );
      continue;
    }
    seenCodes.add(bare);
    allTemplates.push(t);
  }

  for (const tpl of allTemplates) {
    const code = stripSuffix(tpl.code);
    let rows: RawRow[] = [];
    try {
      rows = await readRows(code);
    } catch (e) {
      console.warn(`[real-data] read ${code} failed:`, (e as Error).message);
    }
    if (!rows.length) {
      // 该标的无 parquet 时回退 mock 模板，保证工作台不崩；
      // 必须打上 fallback 标记，否则会被误当作真实行情参与回测与相关性计算。
      out.push({ ...tpl, dataSource: 'fallback' });
      fallbackCount++;
      continue;
    }
    // parquetReadObjects 返回的 date 是 Date 对象（非字符串），必须按时间戳排序，
    // 否则 String(Date) 会退化为 "Thu Jan 03 2013..." 导致按星期几乱序
    rows.sort(
      (a, b) =>
        new Date(a.date as string | number | Date).getTime() -
        new Date(b.date as string | number | Date).getTime(),
    );
    const n = rows.length;
    const closes = rows.map((r) => Number(r.close));

    // ===== 复权断裂检测 + 自动重标定（逻辑已抽至 breakDetection.ts 单一模块，tribunal G1c6） =====
    // 背景与阈值语义见 breakDetection.ts 头注释。registry（staging 晋升）标的的 amount
    // 是伪成交额（volShares×close），无独立 VWAP 锚——模块按数据驱动指纹自动识别为
    // 合成源并跳过甄别（不让检测器验证自己的输入）；上游换真实 amount 时自动恢复。
    const scan = scanAndRescaleBreaks(rows as any[], {
      normDate: (d) => normDate(d),
    });
    // closes 数组已被模块就地修复（rows 的 close 同步），重建以让后续 vol/ATR/均线
    // 全部基于修复后的连续序列计算。
    const fixedCloses = rows.map((r) => Number(r.close));
    for (let i = 0; i < n; i++) closes[i] = fixedCloses[i];
    const rescaledCount = scan.rescaledCount;
    for (const ev of scan.rescaledEvents) {
      console.warn(
        `[real-data] 🔧 ${tpl.name || tpl.id} 复权断裂已重标定: ${ev.date} ` +
          `(${ev.pct}%)，断裂日及之后 OHLC ×${ev.factor.toFixed(4)} 缩回断裂前基准 ` +
          `(VWAP 平稳，判定为复权基准切换非真实行情)`,
      );
    }
    for (const f of scan.findings) {
      if (f.action !== 'warn-only') continue;
      const reasonText =
        f.reason === 'synthetic_source'
          ? '该标的为 staging 晋升源（合成成交额，无独立 VWAP 锚），无法甄别，保守不动作'
          : f.reason === 'vwap_window_missing'
            ? '断裂前后 VWAP 窗口缺失（amount 数据缺或为零），无法甄别，保守不动作'
            : 'VWAP 同向跳动，判为合法极端波动';
      console.warn(
        `[real-data] ⚠️ ${tpl.name || tpl.id} 疑似复权断裂 ${f.date} ` +
          `(${f.pct}%)：${reasonText}，未重标定，请人工核实`,
      );
    }

    // 年化波动率 = 日收益率样本标准差 × √250
    // 仅取最近 120 个交易日收益（与回测 buildSnapshot 的 120 日窗口口径一致）；
    // 若用全样本（可能十年），定仓会严重偏离近期波动状态。
    const retStart = Math.max(1, n - 121);
    const rets: number[] = [];
    for (let i = retStart; i < n; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const annualizedVol =
      Number((stdSample(rets) * Math.sqrt(250)).toFixed(4)) || tpl.annualizedVol;

    // ATR(20)：真实波幅 = max(H-L, |H-昨收|, |L-昨收|)，20 日均值
    const tr: number[] = [0];
    for (let i = 1; i < n; i++) {
      const pc = closes[i - 1];
      tr.push(
        Math.max(
          Number(rows[i].high) - Number(rows[i].low),
          Math.abs(Number(rows[i].high) - pc),
          Math.abs(Number(rows[i].low) - pc),
        ),
      );
    }
    const atr20: number[] = [];
    for (let i = 0; i < n; i++) {
      atr20.push(i >= 20 ? mean(tr.slice(i - 19, i + 1)) : 0);
    }

    const last = n - 1;
    const currentPrice = Number(rows[last].close);
    const preClose = last > 0 ? Number(rows[last - 1].close) : currentPrice;
    const changePct = preClose
      ? Number((((currentPrice - preClose) / preClose) * 100).toFixed(2))
      : 0;
    const dailyATR = Number(
      (atr20[last] || (currentPrice * annualizedVol) / 15.8).toFixed(4),
    );

    // 市价近似（VWAP = amount / volume）——对齐 quant-lab research/lab.py load_market_prices：
    // parquet 的 hfq close 含复权系数，直接当市价用会按复权因子算错目标股数
    // （601857 实测差 1.86 倍）；amount/volume 是原始成交数据、不经复权处理，其比值即
    // 真实市价口径日均价，单源自洽、无需第二数据源。
    // 防坑（quant-lab test_carver.py 实测教训）：volume/amount 单位变化会让个别日 VWAP
    // 跳变而 close 不跳，故取「最近 60 个有效 VWAP 的中位数附近最后一个稳定值」，
    // 剔除与中位数差超 50% 的离群日。
    // ⚠️ 合成 amount 源判定（tribunal G1c4）：registry（staging 晋升）标的的 amount 是
    // 伪成交额（volShares×close，stagingData 构造），vwapSeries 恒等于 close——此时
    // vwapPrice 不是独立价格锚而是 currentPrice 的代数副本，名字/类型却声称 VWAP，
    // 还会喂给 liveMarketSync 的市价兜底链制造"两个源一致"的假象。数据驱动判定：
    // 合成源不产出 vwapPrice（undefined），兜底链诚实落到下一级（hfq close）。
    const isSyntheticAmountSource = detectSyntheticAmount(rows as any[]);
    if (isSyntheticAmountSource && registryEntries.some((e) => e.code === code)) {
      console.log(
        `[real-data] ${tpl.name || tpl.id} 为 staging 晋升源（合成成交额）——不产出 vwapPrice（市价锚由 liveMarketSync 快照负责）`,
      );
    }
    const vwapSeries: number[] = [];
    for (let i = 0; i < n; i++) {
      const vol = Number(rows[i].volume);
      const amt = Number(rows[i].amount);
      if (vol > 0 && amt > 0) vwapSeries.push(amt / vol);
    }
    let vwapPrice = 0;
    if (!isSyntheticAmountSource && vwapSeries.length > 0) {
      const recent = vwapSeries.slice(-60);
      const sorted = [...recent].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      const stable = recent.filter((v) => v > med * 0.5 && v < med * 2);
      vwapPrice = Number((stable.length ? stable[stable.length - 1] : med).toFixed(4));
    }


    // 前缀和加速：O(1) 滚动均线，避免 3000根×3均线 产生千万级 slice().map()
    const prefixCloseSum: number[] = [0];
    for (let i = 0; i < n; i++) {
      prefixCloseSum.push(prefixCloseSum[i] + closes[i]);
    }
    const rollingMA = (idx: number, window: number): number | undefined => {
      if (idx < window - 1) return undefined;
      const sum = prefixCloseSum[idx + 1] - prefixCloseSum[idx + 1 - window];
      return Number((sum / window).toFixed(3));
    };

    const bars: AShareBar[] = rows.map((r, i) => {
      const close = Number(r.close);
      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const vol = Number(r.volume);
      const pc = i > 0 ? Number(rows[i - 1].close) : close;
      const amt = Number(r.amount) > 0 ? Number(r.amount) : vol * close; // 真实成交额 (元)
      return {
        tradeDate: normDate(r.date),
        open,
        high,
        low,
        close,
        preClose: pc,
        volume: vol,
        amount: amt,
        // turnover 仅作展示 (万元)，由真实成交额换算
        // （旧实现用合成的 成交量×价/100 并四舍五入，早期小成交额样本会被取整为 0）
        turnover: Number((amt / 10000).toFixed(0)),
        changePct: Number((((close - pc) / pc) * 100).toFixed(2)),
        ma20: rollingMA(i, 20),
        ma60: rollingMA(i, 60),
        ma250: rollingMA(i, 250),
        atr20: i >= 20 ? Number(atr20[i].toFixed(3)) : undefined,
      };
    });

    // registry 标的（腾讯 hfq 源）：用 factor 把 hfq 绝对值换算回市价口径。
    // currentPrice/preClose/vwapPrice 是「市价口径」展示与定仓输入（加载时给市价初值，
    // sync 后由腾讯快照覆盖，双 owner 无害——都是「设为市价」而非「缩放」）；
    // bars 保持 hfq（收益率/波动率口径），factor 只影响绝对值不影响收益率。
    // ⚠️ dailyATR 刻意不做 factor 换算（tribunal G1c3）：它是「由 hfq bars 算出的绝对值」，
    // 市价化唯一 owner 是 liveMarketSync 的 atrScale=市价/hfq末收。此处若也乘 factor，
    // registry 标的的 ATR 会被缩放两次（f²，f=0.5→25%、f=1.86→3.46 倍），
    // 腐败值流入 instrumentsStore → computeEWMAC → carverEngine 目标股数。
    // factor 钳制（tribunal G1c5 消费侧）：hfqToMarketFactor=快照市价/hfq末收，物理上
    // 只可能在 1 附近小幅偏离（复权因子差）。超出 (0.2, 5) 的值只有两种解释——手改坏了
    // 或晋升时拿到了错误时点的快照。旧版只校验 >0，一个 100×/0.01× 的坏 factor 会
    // 静默把所有市价口径字段放大/缩小百倍。此处钳到边界并显式告警。
    const rawFactor = hfqToMarketFactor.get(code) ?? 1;
    const factor =
      rawFactor > 0 && rawFactor < 0.2
        ? (console.warn(`[real-data] ${code} hfqToMarketFactor=${rawFactor} 异常偏低，钳到 0.2`), 0.2)
        : rawFactor > 5
          ? (console.warn(`[real-data] ${code} hfqToMarketFactor=${rawFactor} 异常偏高，钳到 5`), 5)
          : rawFactor;
    const marketOr = (v: number) => (factor !== 1 && v > 0 ? Number((v * factor).toFixed(4)) : v);
    out.push({
      ...tpl,
      currentPrice: marketOr(currentPrice),
      preClose: marketOr(preClose),
      changePct,
      dailyATR, // hfq 口径——市价化由 liveMarketSync 统一负责（唯一 owner）
      annualizedVol,
      vwapPrice: vwapPrice > 0 ? marketOr(vwapPrice) : undefined,
      bars,
      dataSource: 'parquet',
    });
  }
  if (fallbackCount > 0) {
    console.warn(
      `[real-data] ${fallbackCount}/${out.length} 标的无 parquet 数据，已回退合成模板（非真实行情）`,
    );
  }
  return out;
}
