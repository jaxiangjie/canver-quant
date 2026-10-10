import React from 'react';
import { 
  AShareInstrument, 
  CarverSettings, 
  PositionCalculation 
} from '../types/ashare';
import { 
  Sliders, 
  ShieldCheck, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Info,
  Trash2,
  Network,
  Zap
} from 'lucide-react';

interface CarverPositionSizerProps {
  universe: AShareInstrument[];
  positions: PositionCalculation[];
  settings: CarverSettings;
  onUpdateSettings: (newSettings: CarverSettings) => void;
  onUpdateInstrumentWeight: (id: string, weight: number) => void;
  onUpdateCurrentShares: (id: string, shares: number) => void;
  onDeleteInstrument: (id: string) => void;
}

export const CarverPositionSizer: React.FC<CarverPositionSizerProps> = ({
  positions,
  settings,
  onUpdateSettings,
  onUpdateInstrumentWeight,
  onUpdateCurrentShares,
  onDeleteInstrument,
}) => {
  const targetCapitalSum = (positions || []).reduce((acc, p) => acc + (p?.targetCapital || 0), 0);
  const currentCapitalSum = (positions || []).reduce((acc, p) => acc + (p?.currentValue || 0), 0);
  const totalCap = settings?.totalCapital || 1000000;
  const targetGrossRatio = Number(((targetCapitalSum / totalCap) * 100).toFixed(1));
  const targetLeveragePct = Math.max(0, Number((targetGrossRatio - 100).toFixed(1)));
  const currentGrossRatio = Number(((currentCapitalSum / totalCap) * 100).toFixed(1));
  const currentLeveragePct = Math.max(0, Number((currentGrossRatio - 100).toFixed(1)));
  const maxLeverageLimitPct = Number(((settings.maxLeverage ?? 0.20) * 100).toFixed(0));
  const totalBudgetWeight = (positions || []).reduce((acc, p) => acc + (p?.instrument?.riskBudgetWeight || 0), 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* 1. 卡弗模型全局控制台 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white tracking-wide">
              罗伯特·卡弗波动率定仓参数设置 (Carver Volatility Sizing)
            </h2>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>快捷预设：</span>
            <button
              onClick={() => onUpdateSettings({ ...settings, targetAnnualVol: 0.08, bufferThreshold: 0.10, maxLeverage: 0.00, maxBondCap: 0.25 })}
              className={`px-2.5 py-1 rounded border transition-colors ${
                settings.targetAnnualVol === 0.08 
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 font-semibold' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              稳健防守 (8% Vol · 0%杠杆)
            </button>
            <button
              onClick={() => onUpdateSettings({ ...settings, targetAnnualVol: 0.12, bufferThreshold: 0.12, maxLeverage: 0.20, maxBondCap: 0.25 })}
              className={`px-2.5 py-1 rounded border transition-colors ${
                settings.targetAnnualVol === 0.12 && (settings.maxBondCap ?? 0.25) > 0.20
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600 font-semibold' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              卡弗标准 (12% Vol · 20%杠杆)
            </button>
            <button
              onClick={() => onUpdateSettings({ ...settings, targetAnnualVol: 0.20, bufferThreshold: 0.12, maxLeverage: 0.20, maxBondCap: 0.20 })}
              className={`px-2.5 py-1 rounded border transition-colors font-medium flex items-center gap-1 shadow-sm ${
                settings.targetAnnualVol === 0.20
                  ? 'bg-cyan-950 text-cyan-200 border-cyan-500 font-bold' 
                  : 'bg-cyan-950/60 hover:bg-cyan-900 text-cyan-300 border-cyan-700/80'
              }`}
            >
              🎯 进取冲刺 (20% Vol · 债限20%)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 text-xs">
          {/* 总资金规模 */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-slate-300">
              <span className="font-medium">管理总资金</span>
              <span className="font-mono text-emerald-400 tabular-nums font-semibold">
                ¥{settings.totalCapital.toLocaleString('zh-CN')}
              </span>
            </div>
            <input
              type="range"
              min="200000"
              max="5000000"
              step="50000"
              value={settings.totalCapital}
              onChange={(e) => onUpdateSettings({ ...settings, totalCapital: Number(e.target.value) })}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>20万</span>
              <span>100万 (基准)</span>
              <span>500万</span>
            </div>
          </div>

          {/* 目标年化波动率 */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-slate-300">
              <span className="font-medium">目标年化波动率 (Target Vol)</span>
              <span className="font-mono text-cyan-400 tabular-nums font-semibold">
                {(settings.targetAnnualVol * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.06"
              max="0.25"
              step="0.01"
              value={settings.targetAnnualVol}
              onChange={(e) => onUpdateSettings({ ...settings, targetAnnualVol: Number(e.target.value) })}
              className="w-full accent-cyan-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>6% (极稳健)</span>
              <span>12% (稳健基准)</span>
              <span className="text-cyan-400 font-semibold">20% (12%回报目标)</span>
            </div>
          </div>

          {/* 债券类资产上限 (防收益拖累) */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-slate-300">
              <span className="font-medium flex items-center gap-1">
                <span>债券资产上限</span>
                <span className="text-[10px] text-amber-400 font-mono">(防拖累)</span>
              </span>
              <span className="font-mono text-amber-400 tabular-nums font-semibold">
                {((settings.maxBondCap ?? 0.20) * 100).toFixed(0)}% (≤¥{((settings.totalCapital * (settings.maxBondCap ?? 0.20))).toLocaleString('zh-CN')})
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.30"
              step="0.01"
              value={settings.maxBondCap ?? 0.20}
              onChange={(e) => onUpdateSettings({ ...settings, maxBondCap: Number(e.target.value) })}
              className="w-full accent-amber-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>5% (低配债)</span>
              <span className="text-amber-400 font-semibold">20% (防拖累平衡)</span>
              <span>30% (高防守)</span>
            </div>
          </div>

          {/* 调仓死区缓冲带 */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-slate-300">
              <span className="font-medium">调仓缓冲带阈值 (Buffer)</span>
              <span className="font-mono text-indigo-400 tabular-nums font-semibold">
                {(settings.bufferThreshold * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.25"
              step="0.01"
              value={settings.bufferThreshold}
              onChange={(e) => onUpdateSettings({ ...settings, bufferThreshold: Number(e.target.value) })}
              className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>5% (频调)</span>
              <span>12% (卡弗推荐)</span>
              <span>25% (节制)</span>
            </div>
          </div>

          {/* 最大允许杠杆率上限 */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-slate-300">
              <span className="font-medium flex items-center gap-1">
                <span>最大杠杆率上限</span>
                <span className="text-[10px] text-emerald-400 font-mono">(风控红线)</span>
              </span>
              <span className="font-mono text-emerald-400 tabular-nums font-semibold">
                +{(settings.maxLeverage * 100).toFixed(0)}% (仓位 ≤{(100 + settings.maxLeverage * 100).toFixed(0)}%)
              </span>
            </div>
            <input
              type="range"
              min="0.00"
              max="0.25"
              step="0.01"
              value={settings.maxLeverage ?? 0.20}
              onChange={(e) => onUpdateSettings({ ...settings, maxLeverage: Number(e.target.value) })}
              className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>0% (纯多头)</span>
              <span className="text-emerald-400 font-semibold">20% (硬顶上限)</span>
              <span>25% (极限)</span>
            </div>
          </div>
        </div>

        {/* 量化进阶模型开关：IDM 分散化乘数补偿 & A股 ERP 股债收益差战术偏置 */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 卡弗标的分散化乘数 IDM 控制卡片 */}
          <div 
            className={`flex flex-col gap-3 p-3.5 rounded-lg border transition-all ${
              settings.useIDM !== false 
                ? 'bg-indigo-950/40 border-indigo-700/60 text-indigo-200' 
                : 'bg-slate-950/40 border-slate-800 text-slate-400'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded ${settings.useIDM !== false ? 'bg-indigo-900/60 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                  <Network className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white text-xs">卡弗标的分散化乘数 (Carver IDM)</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-900 text-indigo-200">
                      推荐区间: 1.20x ~ 1.80x
                    </span>
                  </div>
                </div>
              </div>

              {/* 开关切换 */}
              <button
                type="button"
                onClick={() => onUpdateSettings({ ...settings, useIDM: settings.useIDM === false ? true : false })}
                className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors ${
                  settings.useIDM !== false 
                    ? 'bg-indigo-600 text-white border-indigo-500' 
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {settings.useIDM !== false ? '已启用补偿' : '已停用'}
              </button>
            </div>

            {settings.useIDM !== false && (
              <div className="flex flex-col gap-2 pt-2 border-t border-indigo-900/40">
                {/* 模式切换：矩阵自适应 vs 手动指定 */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">计算模式：</span>
                  <div className="flex items-center bg-slate-950 p-0.5 rounded border border-indigo-950/80">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, idmMode: 'auto' })}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        (settings.idmMode ?? 'auto') === 'auto'
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      🤖 矩阵自适应 (推荐)
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, idmMode: 'manual', manualIDM: settings.manualIDM ?? 1.45 })}
                      className={`px-2 py-0.5 rounded transition-colors ${
                        settings.idmMode === 'manual'
                          ? 'bg-indigo-600 text-white font-semibold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      ⚙️ 手动指定
                    </button>
                  </div>
                </div>

                {/* 手动指定滑块 */}
                {settings.idmMode === 'manual' ? (
                  <div className="flex flex-col gap-1.5 bg-slate-950/80 p-2.5 rounded border border-indigo-900/50">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300 font-medium">指定 IDM 乘数:</span>
                      <span className="font-mono text-indigo-300 font-bold text-sm tabular-nums">
                        {(settings.manualIDM ?? 1.45).toFixed(2)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1.00"
                      max="2.20"
                      step="0.05"
                      value={settings.manualIDM ?? 1.45}
                      onChange={(e) => onUpdateSettings({ ...settings, manualIDM: Number(e.target.value) })}
                      className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                      <span>1.00x (无分散)</span>
                      <span className="text-emerald-400 font-semibold">1.45x (标准)</span>
                      <span className="text-amber-400">1.80x (上限)</span>
                      <span>2.20x</span>
                    </div>

                    {/* 快捷档位 */}
                    <div className="flex items-center gap-1.5 pt-1 text-[10px]">
                      <span className="text-slate-400">快捷预设:</span>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ ...settings, manualIDM: 1.25 })}
                        className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800"
                      >
                        稳健 1.25x
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ ...settings, manualIDM: 1.45 })}
                        className="px-1.5 py-0.5 rounded bg-indigo-950 hover:bg-indigo-900 text-indigo-300 border border-indigo-800 font-semibold"
                      >
                        推荐 1.45x
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateSettings({ ...settings, manualIDM: 1.75 })}
                        className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-850 text-slate-300 border border-slate-800"
                      >
                        进取 1.75x
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between p-2 rounded bg-slate-950/60 border border-indigo-900/30 text-[11px] font-mono">
                    <span className="text-slate-400">60D 协方差矩阵动态求解：</span>
                    <span className="text-emerald-400 font-bold">自适应计算中 (封顶 ≤{(settings.maxIDM ?? 1.80).toFixed(2)}x)</span>
                  </div>
                )}
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed">
              解决多标的低相关性导致组合实际波动率被过度平抑（年化仅 6%）的核心算法。<strong>卡弗学术推荐区间为 1.20x ~ 1.80x</strong>，严禁超过 2.0x 避免极端流动性踩踏穿仓。
            </p>
          </div>

          <div 
            onClick={() => onUpdateSettings({ ...settings, useERPTilt: settings.useERPTilt === false ? true : false })}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
              settings.useERPTilt !== false 
                ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200' 
                : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            <div className={`p-1.5 rounded mt-0.5 ${settings.useERPTilt !== false ? 'bg-emerald-900/60 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
              <Zap className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-white flex items-center gap-1.5">
                  <span>A股股债收益差 (ERP/Fed模型) 逆向战术偏置</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-900 text-emerald-200">
                    安全边际增益
                  </span>
                </span>
                <span className="font-mono text-xs">
                  {settings.useERPTilt !== false ? '已开启 (估值底加仓)' : '未开启 (纯动量)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                跟踪全市场 PE 倒数与 10 年期国债收益率差额。当大盘估值处于历史 80%+ 极度低估黄金坑时，为权益资产注入 1.15x~1.25x 逆向进攻偏置，右侧反弹时享受超额阿尔法。
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-400">
          <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>
            卡弗核心定仓公式：标的每日风险 = 现价 × (年化波动率 / √250) · 基准股数 = (总资金 × 目标波动率 / √250 × 风险权重 × IDM) / 标的每日风险 · 严格受<strong>最多 20% 杠杆上限 (120% 总仓位)</strong>与<strong>单标的最高 25% 市值上限</strong>保护。
          </span>
        </div>
      </div>

      {/* 2. 组合杠杆安全与风控约束横幅 (杜绝 170%+ 过度配资) */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-emerald-950/60 rounded-md border border-emerald-800/60 shrink-0 text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">组合杠杆率硬顶防线：最多允许 20% 杠杆 (≤120% 组合总仓位)</h3>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-emerald-950 text-emerald-300 rounded border border-emerald-800/60">
                风控合规 ✅
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              针对 A 股长线投资与两融风控，系统已部署<strong>单标的市值上限（≤25%）</strong>与<strong>组合级等比压缩机制</strong>。
              彻底防止国债ETF等低波标的在波动率平价公式下无序放大（杜绝 170%+ 过度配资杠杆爆仓），确保组合总市值永远压制在 120% 安全红线内。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 bg-slate-950/60 px-4 py-2.5 rounded-lg border border-slate-800/80 font-mono text-xs">
          <div className="flex flex-col items-end">
            <span className="text-[11px] text-slate-400">目标总仓位 / 杠杆</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-white tabular-nums">
                ¥{targetCapitalSum.toLocaleString('zh-CN')}
              </span>
              <span className="text-xs text-emerald-400 font-semibold tabular-nums">
                ({targetGrossRatio}% · 杠杆 +{targetLeveragePct}%)
              </span>
            </div>
          </div>
          <div className="h-7 w-px bg-slate-800" />
          <div className="flex flex-col items-end">
            <span className="text-[11px] text-slate-400">当前实盘总仓位</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-bold text-slate-300 tabular-nums">
                ¥{currentCapitalSum.toLocaleString('zh-CN')}
              </span>
              <span className="text-xs text-slate-400 tabular-nums">
                ({currentGrossRatio}% · 杠杆 +{currentLeveragePct}%)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 标的池波动率平价与定仓明细表格 */}
      <div className="p-5 bg-slate-900/70 border border-slate-800 rounded-lg flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">
              A股与ETF持仓标的 · 波动率倒数定仓矩阵
            </h3>
            <span className="text-xs text-slate-400">
              (共 {positions.length} 只标的 · 严格支持 A 股整手交易)
            </span>
          </div>

          <div className="text-xs text-slate-400">
            总风险预算分配：
            <span className="font-mono text-emerald-400 font-semibold tabular-nums ml-1">
              {(positions.reduce((acc, p) => acc + p.instrument.riskBudgetWeight, 0) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                <th className="py-2.5 px-3">标的代码/名称</th>
                <th className="py-2.5 px-2">属性</th>
                <th className="py-2.5 px-2 text-right">现价 (元)</th>
                <th className="py-2.5 px-2 text-right">年化波动率</th>
                <th className="py-2.5 px-2 text-right">日ATR</th>
                <th className="py-2.5 px-3">风险预算权重</th>
                <th className="py-2.5 px-2 text-center">卡弗标量</th>
                <th className="py-2.5 px-2 text-right">目标股数 (手)</th>
                <th className="py-2.5 px-2 text-right">目标市值</th>
                <th className="py-2.5 px-3 text-right">当前持仓 (手)</th>
                <th className="py-2.5 px-2 text-center">缓冲状态</th>
                <th className="py-2.5 px-2 text-center">建议操作</th>
                <th className="py-2.5 px-2 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
              {(positions || []).map((pos) => {
                const inst = pos?.instrument;
                if (!inst) return null;
                const targetLots = (pos.targetShares || 0) / 100;
                const currentLots = (pos.currentShares || 0) / 100;
                const deltaLots = ((pos.targetShares || 0) - (pos.currentShares || 0)) / 100;

                return (
                  <tr key={inst.id || Math.random()} className="hover:bg-slate-800/40 transition-colors">
                    {/* 代码与名称 */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-white text-xs">{inst.name}</div>
                      <div className="text-[11px] text-slate-400 font-normal">{inst.code}</div>
                    </td>

                    {/* 资产属性 */}
                    <td className="py-3 px-2 font-sans">
                      <div className="flex flex-col text-[11px] text-slate-400">
                        <span>{inst.isETF ? 'ETF' : 'A股个股'}</span>
                        <span className="text-[10px] text-slate-500">
                          {inst.isT0 ? 'T+0' : 'T+1'} · {inst.stampDutyExempt ? '免印花税' : '有印花税'}
                        </span>
                      </div>
                    </td>

                    {/* 现价 */}
                    <td className="py-3 px-2 text-right font-semibold text-slate-200">
                      ¥{inst.currentPrice.toFixed(inst.currentPrice > 100 ? 2 : 3)}
                    </td>

                    {/* 年化波动率 */}
                    <td className="py-3 px-2 text-right">
                      <span className={inst.annualizedVol > 0.25 ? 'text-amber-400' : 'text-slate-300'}>
                        {(inst.annualizedVol * 100).toFixed(1)}%
                      </span>
                    </td>

                    {/* 日ATR */}
                    <td className="py-3 px-2 text-right text-slate-400">
                      {inst.dailyATR.toFixed(3)}
                    </td>

                    {/* 风险权重预算滑块 */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min="0"
                          max="0.4"
                          step="0.05"
                          value={inst.riskBudgetWeight}
                          onChange={(e) => onUpdateInstrumentWeight(inst.id, Number(e.target.value))}
                          className="w-16 accent-emerald-500 bg-slate-800 h-1 rounded cursor-pointer"
                        />
                        <span className="text-slate-300 w-8 text-right font-medium">
                          {(inst.riskBudgetWeight * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>

                    {/* 卡弗预测标量 */}
                    <td className="py-3 px-2 text-center">
                      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-800">
                        {pos.forecastScalar > 0 ? (
                          <TrendingUp className="w-3 h-3 text-emerald-400" />
                        ) : pos.forecastScalar < 0 ? (
                          <TrendingDown className="w-3 h-3 text-red-400" />
                        ) : (
                          <Minus className="w-3 h-3 text-slate-400" />
                        )}
                        <span className={pos.forecastScalar > 0 ? 'text-emerald-400' : pos.forecastScalar < 0 ? 'text-red-400' : 'text-slate-300'}>
                          {pos.forecastScalar > 0 ? `+${pos.forecastScalar}` : pos.forecastScalar}
                        </span>
                      </div>
                    </td>

                    {/* 目标股数 (手) */}
                    <td className="py-3 px-2 text-right font-bold text-white">
                      {targetLots}手
                      <div className="text-[10px] text-slate-500 font-normal">
                        ({pos.targetShares}股)
                      </div>
                    </td>

                    {/* 目标市值 */}
                    <td className="py-3 px-2 text-right text-slate-300">
                      ¥{pos.targetCapital.toLocaleString('zh-CN')}
                      <div className="text-[10px] text-slate-500 font-normal">
                        {(pos.targetWeight * 100).toFixed(1)}%仓位
                      </div>
                    </td>

                    {/* 当前持仓 (可点击修改) */}
                    <td className="py-3 px-3 text-right">
                      <input
                        type="number"
                        min="0"
                        step="100"
                        value={pos.currentShares}
                        onChange={(e) => onUpdateCurrentShares(inst.id, Math.max(0, Number(e.target.value)))}
                        className="w-20 text-right bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                      />
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {currentLots}手
                      </div>
                    </td>

                    {/* 缓冲状态 */}
                    <td className="py-3 px-2 text-center font-sans">
                      {pos.withinBuffer ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40">
                          <ShieldCheck className="w-3 h-3" />
                          缓冲内·免调
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                          偏离·需调仓
                        </span>
                      )}
                    </td>

                    {/* 建议操作 */}
                    <td className="py-3 px-2 text-center font-sans font-semibold">
                      {pos.action === 'HOLD' ? (
                        <span className="text-slate-400 text-xs">持有</span>
                      ) : pos.action === 'BUY' ? (
                        <span className="text-emerald-400 text-xs">
                          买入 {pos.recommendedShares / 100}手
                        </span>
                      ) : (
                        <span className="text-red-400 text-xs">
                          卖出 {pos.recommendedShares / 100}手
                        </span>
                      )}
                    </td>

                    {/* 删除标的 */}
                    <td className="py-3 px-2 text-center">
                      <button
                        onClick={() => onDeleteInstrument(inst.id)}
                        className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                        title="从标的池移除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-700 bg-slate-900/90 font-mono text-xs font-semibold text-slate-200">
                <td className="py-3 px-3" colSpan={5}>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">标的池汇总 ({positions.length} 只标的)</span>
                    <span className="text-[11px] text-emerald-400 font-normal">
                      · 最多 20% 杠杆上限已生效
                    </span>
                  </div>
                </td>
                <td className="py-3 px-3 text-emerald-400">
                  {(totalBudgetWeight * 100).toFixed(0)}%
                </td>
                <td className="py-3 px-2 text-center text-slate-400">
                  -
                </td>
                <td className="py-3 px-2 text-right text-slate-400">
                  -
                </td>
                {/* 目标市值合计 */}
                <td className="py-3 px-2 text-right">
                  <div className="text-white font-bold">
                    ¥{targetCapitalSum.toLocaleString('zh-CN')}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-normal">
                    {targetGrossRatio}% 仓位 · 杠杆 +{targetLeveragePct}%
                  </div>
                </td>
                {/* 当前市值合计 */}
                <td className="py-3 px-3 text-right">
                  <div className="text-slate-300">
                    ¥{currentCapitalSum.toLocaleString('zh-CN')}
                  </div>
                  <div className="text-[10px] text-slate-400 font-normal">
                    {currentGrossRatio}% 现仓 · 杠杆 +{currentLeveragePct}%
                  </div>
                </td>
                {/* 缓冲与建议操作 */}
                <td className="py-3 px-2 text-center font-sans text-[11px] text-slate-300" colSpan={3}>
                  <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-sans">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>总杠杆 ≤ 20% (安全合规)</span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};
