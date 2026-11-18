/**
 * 回答「IDM 是否恒为 1.80」：用真实 parquet 数据，对每个组合 × 多个相关性窗口
 * 算出「未封顶 IDM」与「引擎生效 IDM（maxIDM=1.80）」，看封顶是否总是binding。
 * 跑法: npx tsx scripts/diag_idm_range.ts
 */
import { loadRealUniverse } from '../src/services/realData';
import { DEFAULT_BUNDLES, resolveUniverseDetailed } from '../src/services/bundles';
import { computeUniverseCorrelationMatrix, computeCarverIDM } from '../src/services/correlationEngine';
import { calculatePortfolio, DEFAULT_CARVER_SETTINGS } from '../src/services/carverEngine';

const CAP = DEFAULT_CARVER_SETTINGS.maxIDM ?? 1.80;

(async () => {
  const catalog = await loadRealUniverse();
  const windows = [60, 120, 250];

  console.log(`封顶 maxIDM = ${CAP}（engine 默认）\n`);
  console.log('组合            窗口   腿  平均ρ     未封顶IDM   生效IDM   封顶?');
  console.log('-'.repeat(76));

  for (const b of DEFAULT_BUNDLES) {
    const uni = resolveUniverseDetailed(catalog, b).universe;
    for (const w of windows) {
      const r = computeUniverseCorrelationMatrix(uni, w);
      const raw = computeCarverIDM(r.instruments.length, r.averageUniverseCorrelation);
      const eff = Math.max(1.0, Math.min(CAP, raw));
      console.log(
        `${b.id.padEnd(14)} ${String(w).padStart(4)}  ${String(r.instruments.length).padStart(2)}  ` +
          `${r.averageUniverseCorrelation.toFixed(4).padStart(7)}   ${raw.toFixed(3).padStart(8)}   ` +
          `${eff.toFixed(2).padStart(7)}   ${raw > CAP + 1e-9 ? '是' : '否（未顶到）'}`,
      );
    }
  }

  // 临界 ρ：rawIDM > CAP ⟺ 1/n + (1−1/n)ρ < 1/CAP²  ⟺ ρ < (1/CAP² − 1/n)/(1 − 1/n)
  // 方向容易写反：**ρ 越低 → 分散化收益越大 → rawIDM 越高 → 越容易被 1.80 封顶**。
  console.log('\n【临界 ρ】只要平均相关**低于**下表值，未封顶 IDM 就会超过 1.80 而被封顶');
  for (const n of [5, 6, 9, 11, 22]) {
    const crit = (1 / (CAP * CAP) - 1 / n) / (1 - 1 / n);
    console.log(`  n=${String(n).padStart(2)}  →  ρ < ${crit.toFixed(4)} 即被封顶`);
  }

  const b9 = resolveUniverseDetailed(catalog, DEFAULT_BUNDLES.find((x) => x.id === 'balanced9')!).universe;
  const r60 = computeUniverseCorrelationMatrix(b9, 60);
  const crit9 = (1 / (CAP * CAP) - 1 / 9) / (1 - 1 / 9);
  console.log(
    `\n【当前 balanced9】ρ(60d)=${r60.averageUniverseCorrelation.toFixed(4)}  ` +
      `临界=${crit9.toFixed(4)}  → ${r60.averageUniverseCorrelation < crit9 ? '低于临界 → 被 1.80 封顶' : '高于临界 → 未封顶'}`,
  );

  // 引擎侧核对：summary.carverIDM 与手算一致？
  const { summary } = calculatePortfolio(b9, DEFAULT_CARVER_SETTINGS, {
    idm: r60.carverIDM,
    avgCorrelation: r60.averageUniverseCorrelation,
    legCount: r60.instruments.length,
    codes: r60.instruments.map((i: any) => i.id),
  });
  console.log(
    `【引擎核对】summary.carverIDM=${summary.carverIDM}  组合年化波动=${summary.portfolioAnnualVol}%  ` +
      `有效波动=${summary.effectiveAnnualVol}%  目标杠杆=${summary.targetLeverageRatio}%`,
  );
})();
