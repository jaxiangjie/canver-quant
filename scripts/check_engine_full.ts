/** 临时诊断：carverEngine 全量输出 vs UI 截图（poorlab11）。 */
import { loadRealUniverse } from '../src/services/realData';
import { calculatePortfolio } from '../src/services/carverEngine';
import { DEFAULT_BUNDLES, POORLAB11_ID, resolveUniverse } from '../src/services/bundles';

async function main() {
  const catalog = await loadRealUniverse();
  const bundle = DEFAULT_BUNDLES.find(b => b.id === POORLAB11_ID)!;
  const universe = resolveUniverse(catalog, bundle);

  const settings = {
    totalCapital: 1_000_000,
    targetAnnualVol: 0.18,
    bufferThreshold: 0.12,
    maxInstrumentRiskCap: 0.25,
    maxLeverage: 0.20,
    maxInstrumentPositionCap: 0.25,
    useIDM: true,
    idmMode: 'auto' as const,
    maxIDM: 1.80,
    useERPTilt: true,
    useQualityGate: true,
    useTrendGate: true,
    enforceTargetVol: true,
    stockCommissionRate: 0.00025,
    etfCommissionRate: 0.0001,
    stockStampDuty: 0.0005,
    slippageBps: 5,
  };

  const result = calculatePortfolio(universe, settings as any);
  const rows: any[] = Array.isArray(result) ? result : ((result as any).positions || []);
  console.log('id\tprice\tscalar\trawTargetSh\ttargetShares\trecShares\tcurShares\tbuffer');
  for (const p of rows) {
    console.log(
      `${p.instrument?.id ?? p.id}\t${(p.instrument?.currentPrice ?? 0).toFixed(2)}` +
      `\t${(p.forecastScalar ?? p.carverForecastScalar ?? '?')}` +
      `\t${(p.rawTargetShares ?? '?')}\t${(p.targetShares ?? '?')}\t${(p.recommendedShares ?? '?')}` +
      `\t${(p.currentShares ?? 0)}\t${p.bufferStatus ?? p.inBuffer ?? '?'}`
    );
  }
  if (result && !Array.isArray(result)) {
    console.log('TOPKEYS:', Object.keys(result).join(','));
    console.log('IDM:', (result as any).idmMultiplier, 'dailyVol:', (result as any).dailyTotalCashVol ?? (result as any).dailyCashVol);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
