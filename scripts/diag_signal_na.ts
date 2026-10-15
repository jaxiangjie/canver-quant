/** 定位 562500/512660 趋势标量被判为「合成 K 线」的原因（临时诊断） */
import { loadRealUniverse } from '../src/services/realData';
import { loadPersistedStore, mergeStores } from '../src/services/persistence';
import { evaluateAShareStrategies } from '../src/services/ashareStrategies';

const CODES = ['562500.SH', '512660.SH', '510300.SH'];
const brief = (tag: string, arr: any[]) => {
  for (const c of CODES) {
    const i = arr.find((x: any) => x?.code === c);
    if (!i) { console.log(tag, c, 'NOT FOUND'); continue; }
    console.log(
      tag, c,
      'bars=', Array.isArray(i.bars) ? i.bars.length : typeof i.bars,
      'syntheticBars=', i.syntheticBars,
      'hasSignals=', !!i.signals,
      'signalsNA=', i.signals?.trendBarsUnavailable,
    );
  }
};

const real: any[] = (await loadRealUniverse()) as any[];
brief('REAL  ', real);

const persisted = loadPersistedStore();
const pin = (persisted as any)?.instruments ?? [];
brief('STORE ', pin);

const merged = mergeStores(real, pin, (persisted as any)?.deletedCodes ?? []);
brief('MERGED', merged);

for (const c of CODES) {
  const i = merged.find((x: any) => x?.code === c);
  if (!i) continue;
  const s = evaluateAShareStrategies(i, merged);
  console.log('EVAL  ', c, 'scalar=', s.finalForecastScalar, 'NA=', s.trendBarsUnavailable, 'bars=', i.bars?.length, 'synth=', i.syntheticBars);
}
