/**
 * 「本地已更新就跳过重复同步」闸门测试（2026-10-15）
 *
 * 用法: npx tsx scripts/test_bar_sync_gate.ts
 *
 * 覆盖：
 *  1. latestClosedTradingDay 的时区/周末/盘中边界（北京 15:00 前不算当日已收盘）
 *  2. 本地末根 ≥ 闸门日 → 整轮 skipped，且不发起任何网络请求
 *  3. 本地末根 < 闸门日 → 不 skipped（会真的去拉，故本测试只断言「没被闸门放过」）
 */
import { latestClosedTradingDay, syncDailyBars } from '../src/services/dailyBarSync';

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
const fake = [
  {
    id: '510300', code: '510300.SH', name: '闸门测试标的', dataSource: 'parquet' as const,
    bars: [
      { tradeDate: '2020-01-02', open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { tradeDate: gate, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ],
  },
] as any;

const t0 = Date.now();
const rep = await syncDailyBars(fake, {});
const dt = Date.now() - t0;
eq('末根 == 闸门日 → skipped', rep.skipped, true);
eq('skipped 时 updated=0', rep.updated, 0);
eq('skipped 时 gateDate 正确', rep.gateDate, gate);
eq('skipped 时 upToDate=total', rep.upToDate, rep.total);
console.log(`   ⏱ 耗时 ${dt}ms（应远小于一次网络拉取；>1500ms 说明可能真发了请求）`);
eq('跳过路径耗时 < 500ms（无网络）', dt < 500, true);
console.log(`   reason: ${rep.reason}`);

// ---- 3. 末根滞后于闸门 → 不应被闸门拦住（只断言未被 skip，不验网络结果） ----
const stale = JSON.parse(JSON.stringify(fake));
stale[0].bars[1].tradeDate = '2000-01-03'; // 远早于任何闸门日
const rep2 = await syncDailyBars(stale, {});
eq('末根远早于闸门日 → 不被闸门 skip', rep2.skipped ?? false, false);
console.log(`   （该轮真实结果：total=${rep2.total} updated=${rep2.updated} failed=${rep2.failed}）`);

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
