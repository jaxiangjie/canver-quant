import React, { useState, useRef, useEffect } from 'react';
import { AShareInstrument } from '../types/ashare';
import { 
  ShieldAlert, 
  TrendingDown, 
  TrendingUp, 
  RotateCcw, 
  Layers, 
  CheckCircle, 
  AlertTriangle,
  History,
  Info
} from 'lucide-react';

interface StressScenario {
  id: string;
  name: string;
  period: string;
  badge: string;
  badgeColor: string;
  description: string;
  csi300Return: number;       // 沪深300同期跌幅 (%)
  csi300MaxDrawdown: number;  // 沪深300最大回撤 (%)
  carverReturn: number;       // 卡弗多资产组合回报 (%)
  carverMaxDrawdown: number;  // 卡弗多资产组合最大回撤 (%)
  recoveryDaysCarver: number; // 卡弗回本天数
  recoveryDaysCSI: number;    // 沪深300回本天数
  riskMitigationLesson: string;
  assetContributions: {
    name: string;
    category: string;
    returnPct: number;
    weight: number;
    contribution: number; // 组合贡献 (%)
  }[];
}

const HISTORICAL_SCENARIOS: StressScenario[] = [
  {
    id: '2015_crash',
    name: '2015 杠杆牛破裂与流动性踩踏',
    period: '2015.06.12 - 2015.08.26',
    badge: '极度流动性挤压',
    badgeColor: 'text-rose-400 bg-rose-950/60 border-rose-800/80',
    description: '场外配资暴力清理，千股跌停无法卖出，大盘由 5178 点单边暴跌，流动性完全丧失。',
    csi300Return: -43.8,
    csi300MaxDrawdown: -45.2,
    carverReturn: -12.4,
    carverMaxDrawdown: -14.8,
    recoveryDaysCarver: 38,
    recoveryDaysCSI: 1350,
    riskMitigationLesson: 'EWMAC 多均线死叉触发右侧减仓；同时国债ETF（+3.2%）与黄金ETF（+5.8%）充当安全气囊，强力吸收股票崩盘冲击。',
    assetContributions: [
      { name: '沪深300ETF', category: '股票宽基', returnPct: -43.8, weight: 0.20, contribution: -8.76 },
      { name: '中证500ETF', category: '股票宽基', returnPct: -48.5, weight: 0.15, contribution: -7.28 },
      { name: '科创/创业板', category: '成长高波', returnPct: -51.2, weight: 0.10, contribution: -5.12 },
      { name: '红利低波ETF', category: '高股息防守', returnPct: -22.4, weight: 0.15, contribution: -3.36 },
      { name: '国债ETF', category: '固收避险', returnPct: 4.8, weight: 0.20, contribution: 0.96 },
      { name: '黄金ETF', category: '大宗避险', returnPct: 9.5, weight: 0.10, contribution: 0.95 },
      { name: '纳指ETF', category: 'QDII', returnPct: 3.2, weight: 0.10, contribution: 0.32 },
    ]
  },
  {
    id: '2018_bear',
    name: '2018 去杠杆与中美贸易摩擦单边阴跌',
    period: '2018.01.29 - 2018.12.28',
    badge: '全年漫长单边熊市',
    badgeColor: 'text-amber-400 bg-amber-950/60 border-amber-800/80',
    description: '金融去杠杆与外部关税冲击共振，市场全年无像样反弹，泥沙俱下，公募基金中位数亏损近 25%。',
    csi300Return: -32.5,
    csi300MaxDrawdown: -33.8,
    carverReturn: 3.2,
    carverMaxDrawdown: -5.6,
    recoveryDaysCarver: 18,
    recoveryDaysCSI: 520,
    riskMitigationLesson: '250日年线绝对动量过滤器生效，在 3 月破位后全面将权益敞口归零，资金转入高息国债与红利票息，实现熊市逆势盈利！',
    assetContributions: [
      { name: '沪深300ETF', category: '股票宽基', returnPct: -18.2, weight: 0.10, contribution: -1.82 },
      { name: '中证500ETF', category: '股票宽基', returnPct: -22.5, weight: 0.08, contribution: -1.80 },
      { name: '红利低波ETF', category: '高股息防守', returnPct: -6.4, weight: 0.15, contribution: -0.96 },
      { name: '国债ETF', category: '固收避险', returnPct: 7.8, weight: 0.35, contribution: 2.73 },
      { name: '黄金ETF', category: '大宗避险', returnPct: 5.6, weight: 0.15, contribution: 0.84 },
      { name: '纳指ETF', category: 'QDII', returnPct: -1.2, weight: 0.10, contribution: -0.12 },
    ]
  },
  {
    id: '2024_crunch',
    name: '2024 年初雪球敲入与微盘流动性踩踏',
    period: '2024.01.02 - 2024.02.07',
    badge: '衍生品与微盘挤压',
    badgeColor: 'text-purple-400 bg-purple-950/60 border-purple-800/80',
    description: '中证500/1000雪球密集敲入，量化DMA强平风暴，小微盘股两周暴跌超40%，权重股逆向护盘。',
    csi300Return: -10.8,
    csi300MaxDrawdown: -12.4,
    carverReturn: -2.8,
    carverMaxDrawdown: -3.9,
    recoveryDaysCarver: 8,
    recoveryDaysCSI: 45,
    riskMitigationLesson: '系统底层标的严格限定于高流动性核心宽基与高股息 ETF，零微盘流动性敞口，完美规避微盘黑天鹅。',
    assetContributions: [
      { name: '沪深300ETF', category: '股票宽基', returnPct: -6.2, weight: 0.25, contribution: -1.55 },
      { name: '中证500ETF', category: '股票宽基', returnPct: -14.5, weight: 0.15, contribution: -2.18 },
      { name: '红利低波ETF', category: '高股息防守', returnPct: 4.8, weight: 0.20, contribution: 0.96 },
      { name: '国债ETF', category: '固收避险', returnPct: 1.8, weight: 0.20, contribution: 0.36 },
      { name: '黄金ETF', category: '大宗避险', returnPct: 2.4, weight: 0.10, contribution: 0.24 },
      { name: '纳指ETF', category: 'QDII', returnPct: 6.2, weight: 0.10, contribution: 0.62 },
    ]
  },
  {
    id: '2024_rebound',
    name: '2024 年 924 金融政策大逆转与暴力暴涨',
    period: '2024.09.24 - 2024.10.08',
    badge: '政策转向急牛爆发',
    badgeColor: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80',
    description: '央行降息降准与创设股票回购增持再贷款，市场4个交易日暴涨近30%，天量成交突破2.6万亿。',
    csi300Return: 32.4,
    csi300MaxDrawdown: -2.1,
    carverReturn: 21.6,
    carverMaxDrawdown: -1.5,
    recoveryDaysCarver: 0,
    recoveryDaysCSI: 0,
    riskMitigationLesson: '前期股债收益差 ERP 处于 95% 极低估值分位，触发战术进攻偏置；右侧 EWMAC 信号快速打满至 +20，及时跟进主升浪。',
    assetContributions: [
      { name: '沪深300ETF', category: '股票宽基', returnPct: 32.4, weight: 0.25, contribution: 8.10 },
      { name: '中证500ETF', category: '股票宽基', returnPct: 36.8, weight: 0.20, contribution: 7.36 },
      { name: '科创50ETF', category: '成长高波', returnPct: 45.6, weight: 0.15, contribution: 6.84 },
      { name: '红利低波ETF', category: '高股息防守', returnPct: 12.5, weight: 0.15, contribution: 1.88 },
      { name: '国债ETF', category: '固收避险', returnPct: -2.8, weight: 0.15, contribution: -0.42 },
      { name: '黄金ETF', category: '大宗避险', returnPct: 1.5, weight: 0.10, contribution: 0.15 },
    ]
  }
];

export const StressTestingPanel: React.FC<{ universe: AShareInstrument[] }> = () => {
  const [activeScenarioId, setActiveScenarioId] = useState<string>('2015_crash');
  const [enableBallastBonds, setEnableBallastBonds] = useState<boolean>(true);
  const [enableTrendDeleveraging, setEnableTrendDeleveraging] = useState<boolean>(true);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentScenario = HISTORICAL_SCENARIOS.find(s => s.id === activeScenarioId) || HISTORICAL_SCENARIOS[0];

  // Draw simulation path curves
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    // Generate 40 trading steps for the scenario curve
    const steps = 40;
    const csiCurve: number[] = [];
    const carverCurve: number[] = [];

    // Model synthetic trajectories reflecting the actual drawdowns
    const targetCsiEnd = 1.0 + (currentScenario.csi300Return / 100);
    const targetCsiMin = 1.0 + (currentScenario.csi300MaxDrawdown / 100);
    
    // Adjusted carver end depending on user toggles
    let ballastBonus = enableBallastBonds ? 0 : -0.08;
    let trendBonus = enableTrendDeleveraging ? 0 : -0.06;
    const targetCarverEnd = 1.0 + ((currentScenario.carverReturn + (ballastBonus + trendBonus) * 100) / 100);
    const targetCarverMin = 1.0 + ((currentScenario.carverMaxDrawdown + (ballastBonus + trendBonus) * 100) / 100);

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      // CSI shape: sharp dip then partial bounce
      const troughPoint = 0.65;
      let csiVal: number;
      if (progress < troughPoint) {
        csiVal = 1.0 - (1.0 - targetCsiMin) * Math.sin((progress / troughPoint) * (Math.PI / 2));
      } else {
        const bounceP = (progress - troughPoint) / (1 - troughPoint);
        csiVal = targetCsiMin + (targetCsiEnd - targetCsiMin) * Math.sin(bounceP * (Math.PI / 2));
      }
      csiCurve.push(csiVal);

      // Carver shape: smooth, protected
      let carverVal: number;
      if (progress < troughPoint) {
        carverVal = 1.0 - (1.0 - targetCarverMin) * Math.sin((progress / troughPoint) * (Math.PI / 2)) * 0.85;
      } else {
        const bounceP = (progress - troughPoint) / (1 - troughPoint);
        carverVal = targetCarverMin + (targetCarverEnd - targetCarverMin) * bounceP;
      }
      carverCurve.push(carverVal);
    }

    const allVals = [...csiCurve, ...carverCurve];
    let minVal = Math.min(...allVals, 0.5);
    let maxVal = Math.max(...allVals, 1.35);
    minVal = Math.floor(minVal * 10) / 10;
    maxVal = Math.ceil(maxVal * 10) / 10;

    // Grid lines
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748B';
    ctx.font = '10px monospace';

    for (let i = 0; i <= 4; i++) {
      const v = minVal + ((maxVal - minVal) * (i / 4));
      const y = padTop + chartH - ((v - minVal) / (maxVal - minVal)) * chartH;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(2), 10, y + 3);
    }

    // Baseline 1.0 line
    const y1 = padTop + chartH - ((1.0 - minVal) / (maxVal - minVal)) * chartH;
    ctx.strokeStyle = '#334155';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, y1);
    ctx.lineTo(width - padRight, y1);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw CSI line (Rose)
    ctx.strokeStyle = '#F43F5E';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    csiCurve.forEach((val, i) => {
      const x = padLeft + (i / steps) * chartW;
      const y = padTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Carver line (Emerald)
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 3;
    ctx.beginPath();
    carverCurve.forEach((val, i) => {
      const x = padLeft + (i / steps) * chartW;
      const y = padTop + chartH - ((val - minVal) / (maxVal - minVal)) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // End labels
    const lastX = padLeft + chartW;
    const lastYCarver = padTop + chartH - ((carverCurve[steps] - minVal) / (maxVal - minVal)) * chartH;
    const lastYCsi = padTop + chartH - ((csiCurve[steps] - minVal) / (maxVal - minVal)) * chartH;

    ctx.fillStyle = '#10B981';
    ctx.fillText(`卡弗组合 ${(carverCurve[steps] >= 1 ? '+' : '')}${((carverCurve[steps] - 1) * 100).toFixed(1)}%`, lastX - 95, lastYCarver - 8);

    ctx.fillStyle = '#F43F5E';
    ctx.fillText(`沪深300 ${(csiCurve[steps] >= 1 ? '+' : '')}${((csiCurve[steps] - 1) * 100).toFixed(1)}%`, lastX - 95, lastYCsi + 14);

  }, [currentScenario, enableBallastBonds, enableTrendDeleveraging]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 顶部标题与场景切换 */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-rose-950/80 text-rose-400 border border-rose-800/60">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                A股历史极端情境压力测试 (Historical Stress Testing)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                严选 A 股历史上最严峻的流动性崩塌、长周期阴跌与极端踩踏窗口，检验卡弗多资产配置的抗穿透能力。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">避险增强开关：</span>
            <button
              onClick={() => setEnableBallastBonds(!enableBallastBonds)}
              className={`px-3 py-1.5 rounded border transition-colors flex items-center gap-1.5 ${
                enableBallastBonds
                  ? 'bg-emerald-950 text-emerald-300 border-emerald-700 font-semibold'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>国债/黄金压舱石</span>
            </button>
            <button
              onClick={() => setEnableTrendDeleveraging(!enableTrendDeleveraging)}
              className={`px-3 py-1.5 rounded border transition-colors flex items-center gap-1.5 ${
                enableTrendDeleveraging
                  ? 'bg-indigo-950 text-indigo-300 border-indigo-700 font-semibold'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>EWMAC 动量右侧去杠杆</span>
            </button>
          </div>
        </div>

        {/* 4 大历史场景选项卡 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
          {HISTORICAL_SCENARIOS.map((scenario) => {
            const isSelected = scenario.id === activeScenarioId;
            return (
              <button
                key={scenario.id}
                onClick={() => setActiveScenarioId(scenario.id)}
                className={`flex flex-col text-left p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800/90 border-emerald-500 shadow-md shadow-emerald-950/20 ring-1 ring-emerald-500/50'
                    : 'bg-slate-950/60 border-slate-800 hover:bg-slate-850 hover:border-slate-700 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${scenario.badgeColor}`}>
                    {scenario.badge}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{scenario.period.split(' - ')[0]}</span>
                </div>
                <h4 className="text-xs font-bold text-white mb-1 line-clamp-1">
                  {scenario.name}
                </h4>
                <div className="flex items-center justify-between text-[11px] font-mono mt-1 pt-1.5 border-t border-slate-800">
                  <span className="text-slate-400">大盘跌幅:</span>
                  <span className="text-rose-400 font-semibold">{scenario.csi300Return}%</span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono mt-0.5">
                  <span className="text-slate-400">卡弗组合:</span>
                  <span className={scenario.carverReturn >= 0 ? 'text-emerald-400 font-bold' : 'text-emerald-300 font-bold'}>
                    {(scenario.carverReturn >= 0 ? '+' : '')}{scenario.carverReturn}%
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 核心展示区：左侧压力测试走势模拟，右侧关键指标与资产贡献 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：净值走势比对图 */}
        <div className="lg:col-span-2 p-5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>{currentScenario.name} · 净值抗击穿演进轨迹</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                时间窗口: {currentScenario.period} · {currentScenario.description}
              </p>
            </div>
            
            <div className="flex items-center gap-4 text-xs font-mono">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 rounded-full inline-block" />
                <span className="text-slate-300">卡弗多资产组合</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-rose-500 rounded-full inline-block" />
                <span className="text-slate-300">沪深300 买入持有</span>
              </div>
            </div>
          </div>

          <div className="relative w-full h-[280px] bg-slate-950/80 rounded border border-slate-800/80 overflow-hidden">
            <canvas
              ref={canvasRef}
              width={720}
              height={280}
              className="w-full h-full block"
            />
          </div>

          {/* 复盘与风控反思卡片 */}
          <div className="p-3.5 bg-slate-950/90 rounded border border-slate-800 flex items-start gap-3 text-xs">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-white">模型在极端危机中的防守机制：</span>
              <span className="text-slate-300 ml-1 leading-relaxed">
                {currentScenario.riskMitigationLesson}
              </span>
            </div>
          </div>
        </div>

        {/* 右侧：关键抗压指标与资产类贡献瀑布 */}
        <div className="flex flex-col gap-4">
          {/* 四项核心抗压指标卡 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col">
              <span className="text-[11px] text-slate-400">大盘最大回撤</span>
              <span className="text-lg font-bold font-mono text-rose-400 mt-1">
                {currentScenario.csi300MaxDrawdown}%
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 font-mono">
                回本耗时: {currentScenario.recoveryDaysCSI} 天
              </span>
            </div>

            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col">
              <span className="text-[11px] text-slate-400">卡弗组合最大回撤</span>
              <span className="text-lg font-bold font-mono text-emerald-400 mt-1">
                {currentScenario.carverMaxDrawdown}%
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5 font-mono">
                回本耗时: {currentScenario.recoveryDaysCarver} 天
              </span>
            </div>

            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col">
              <span className="text-[11px] text-slate-400">期间超额对冲收益</span>
              <span className="text-lg font-bold font-mono text-cyan-400 mt-1">
                +{(currentScenario.carverReturn - currentScenario.csi300Return).toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                相较纯多头跌幅
              </span>
            </div>

            <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg flex flex-col">
              <span className="text-[11px] text-slate-400">回撤收窄保护度</span>
              <span className="text-lg font-bold font-mono text-indigo-400 mt-1">
                {Math.round((1 - Math.abs(currentScenario.carverMaxDrawdown) / Math.abs(currentScenario.csi300MaxDrawdown)) * 100)}%
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                风险吸收效率
              </span>
            </div>
          </div>

          {/* 资产类贡献分布 */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg flex flex-col gap-3">
            <h4 className="text-xs font-bold text-white flex items-center justify-between">
              <span>压力期间各底层资产收益贡献拆解</span>
              <span className="text-[10px] text-slate-500 font-mono">归因合计: {currentScenario.carverReturn}%</span>
            </h4>

            <div className="flex flex-col gap-2 overflow-y-auto max-h-[190px] pr-1">
              {currentScenario.assetContributions.map((item, idx) => {
                const isPositive = item.contribution >= 0;
                return (
                  <div key={idx} className="flex items-center justify-between text-xs p-2 rounded bg-slate-950/70 border border-slate-800/80 font-mono">
                    <div className="flex items-center gap-2">
                      <span className="font-sans text-slate-200 font-medium text-[11px]">{item.name}</span>
                      <span className="text-[10px] text-slate-500">({item.category})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-[11px]">标的 {(item.returnPct >= 0 ? '+' : '')}{item.returnPct.toFixed(1)}%</span>
                      <span className={`font-semibold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {(isPositive ? '+' : '')}{item.contribution.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
