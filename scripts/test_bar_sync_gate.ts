/**
 * 「本地已更新就跳过重复同步」闸门测试（2026-10-15；2026-11-18 tribunal 隔离化）
 *
 * 用法: npx tsx scripts/test_bar_sync_gate.ts
 *
 * 覆盖：
 *  1. latestClosedTradingDay 的时区/周末/盘中边界（北京 15:00 前不算当日已收盘）
 *  2. 本地末根 ≥ 闸门日（逐只判定全不落后）→ 整轮 skipped，且不发起任何网络请求
 *  3. 本地末根 < 闸门日 → 不被闸门拦住（fixture 用非在池代码 + 隔离目录：
 *     syncOne 在「盘上 parquet 缺失」处 fail-fast，不触网、绝不写生产数据）
 *
 * 目录隔离（2026-11-18 tribunal）：dailyBarSync 的写入目录可用环境变量覆盖
 * （REAL_DATA_DIR 与 realData 同源；BACKUP/TMP 独立变量）。本测试把三个目录全部指向
 * os.tmpdir() 下的沙箱 —— 测试永远不该与生产数据共享写入路径（旧版 fixture 用真实在池
 * 标的 '510300.SH' + 无隔离目录，fixture 日期一改就会真实覆写生产底座）。
 * 必须在动态 import 之前设置 env：目录常量在模块加载时解析。
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SANDBOX = path.join(os.tmpdir(), 'canver-test-barsync');
process.env.REAL_DATA_DIR = path.join(SANDBOX, 'parquet');
process.env.DAILY_SYNC_BACKUP_DIR = path.join(SANDBOX, 'backup');
process.env.DAILY_SYNC_TMP_DIR = path.join(SANDBOX, 'tmp');
rmSync(SANDBOX, { recursive: true, force: true });

const { latestClosedTradingDay, syncDailyBars } = await import('../src/services/dailyBarSync');

let failed = 0;
function eq(label: string, actual: any, expect: any) {
  const ok = actual === expect;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${label}: 实际=${actual} 期望=${expect}`);
}

// ---- 1. 日期闸门（UTC 时间点 → 北京时间） ----
console.log('── latestClosedTradingDay ──');
eq('周三 15:00 整（北京）当日算已收盘', latestClosedTradingDay(new Date('2026-10-14T07:00:00Z')), '2026-10-14');
eq('周三 14:59（北京）尚未收盘 → 回退周二', latestClosedTradingDay(new Date('2026-10-14T06:59:00Z')), '2026-10-13');
eq('周六 → 回退周五', latestClosedTradingDay(new Date('2026-10-17T10:00:00Z')), '2026-10-16');
eq('周日 → 回退周五', latestClosedTradingDay(new Date('2026-10-18T02:00:00Z')), '2026-10-16');
eq('周一 09:00（北京，未收盘）→ 回退周五', latestClosedTradingDay(new Date('2026-10-19T01:00:00Z')), '2026-10-16');
eq('周一 16:00（北京，已收盘）→ 当日', latestClosedTradingDay(new Date('2026-10-19T08:00:00Z')), '2026-10-19');

// ---- 2. 本地已是最新 → 整轮跳过（此路径必须零网络请求） ----
console.log('\n── syncDailyBars 闸门 ──');
const gate = latestClosedTradingDay();
// fixture 用非在池代码：即便 env 隔离被摘掉，syncOne 也会在「盘上 parquet 缺失」处
// fail-closed，绝不触碰真实底座数据。
const fake = [
  {
    id: '999999', code: '999999.SZ', name: '闸门测试标的', dataSource: 'parquet' as const,
    bars: [
      { tradeDate: '2020-01-02', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { tradeDate: gate, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ],
  },
] as any;

const t0 = Date.now();
const rep = await syncDailyBars(fake, {});
const dt = Date.now() - t0;
eq('末根 == 闸门日（全池不落后）→ skipped', rep.skipped, true);
eq('skipped 时 updated=0', rep.updated, 0);
eq('skipped 时 gateDate 正确', rep.gateDate, gate);
eq('skipped 时 upToDate=total', rep.upToDate, rep.total);
console.log(`   ⏱ 耗时 ${dt}ms（应远小于一次网络拉取；>1500ms 说明可能真发了请求）`);
eq('跳过路径耗时 < 500ms（无网络）', dt < 500, true);
console.log(`   reason: ${rep.reason}`);

// ---- 3. 末根滞后于闸门 → 不应被闸门拦住（隔离目录下 fail-fast，零网络零写盘） ----
const stale = JSON.parse(JSON.stringify(fake));
stale[0].bars[1].tradeDate = '2000-01-03'; // 远早于任何闸门日
const t1 = Date.now();
const rep2 = await syncDailyBars(stale, {});
const dt2 = Date.now() - t1;
eq('末根远早于闸门日 → 不被闸门 skip', rep2.skipped ?? false, false);
eq('stale 轮在「盘上 parquet 缺失」处 fail-fast（沙箱无 parquet）', rep2.results[0]?.status, 'failed');
console.log(`   ⏱ 耗时 ${dt2}ms（<500ms 说明没打腾讯）`);
eq('stale 路径耗时 < 500ms（无网络）', dt2 < 500, true);
console.log(`   reason: ${rep2.results[0]?.reason}`);

// 清理沙箱
rmSync(SANDBOX, { recursive: true, force: true });

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
