import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { 
  AShareInstrument, 
  CarverSettings,
  RebalanceRecord
} from './types/ashare';
import { 
  DEFAULT_CARVER_SETTINGS, 
  calculatePortfolio 
} from './services/carverEngine';
import { AShareDataService } from './services/apiClient';
import { Header } from './components/Header';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PortfolioSummary } from './components/PortfolioSummary';
import { CarverPositionSizer } from './components/CarverPositionSizer';
import { AddInstrumentModal } from './components/AddInstrumentModal';
import { RebalanceHistoryModal } from './components/RebalanceHistoryModal';
import { loadLocalRebalanceHistory, fetchServerRebalanceHistory } from './services/rebalanceHistoryStore';

// 代码分割 (Code-splitting)：非首屏重度面板采用懒加载，大幅缩减首屏单体 JS 体积
const StrategyAnalysisPanel = lazy(() => import('./components/StrategyAnalysisPanel').then(m => ({ default: m.StrategyAnalysisPanel })));
const RebalanceExecutionPanel = lazy(() => import('./components/RebalanceExecutionPanel').then(m => ({ default: m.RebalanceExecutionPanel })));
const BacktestSandbox = lazy(() => import('./components/BacktestSandbox').then(m => ({ default: m.BacktestSandbox })));
const DataAdapterConsole = lazy(() => import('./components/DataAdapterConsole').then(m => ({ default: m.DataAdapterConsole })));
const InstrumentDeepAnalysisPanel = lazy(() => import('./components/InstrumentDeepAnalysisPanel').then(m => ({ default: m.InstrumentDeepAnalysisPanel })));
const CustomPortfolioDiagnosticPanel = lazy(() => import('./components/CustomPortfolioDiagnosticPanel').then(m => ({ default: m.CustomPortfolioDiagnosticPanel })));
const DocumentationCenter = lazy(() => import('./components/DocumentationCenter').then(m => ({ default: m.DocumentationCenter })));

// 组合（bundle）层：把 catalog 按组合定义过滤+套权重，得到可切换的测试宇宙
import { DEFAULT_BUNDLES, BALANCED9_ID, resolveUniverseDetailed, InstrumentBundle } from './services/bundles';
import { IMPORTED_BUNDLE_ID } from './services/customPortfolioStore';
import { BundleSelector } from './components/BundleSelector';

const BUNDLES_KEY = 'canver.bundles.v1';
const ACTIVE_KEY = 'canver.activeBundle.v1';
function loadBundles(): InstrumentBundle[] {
  try {
    const s = localStorage.getItem(BUNDLES_KEY);
    if (s) {
      const stored = JSON.parse(s) as InstrumentBundle[];
      // 保证新增的内置 bundle 始终能被合并识别
      const existingIds = new Set(stored.map((b) => b.id));
      const merged = [...stored];
      for (const def of DEFAULT_BUNDLES) {
        if (!existingIds.has(def.id)) {
          merged.push(def);
        }
      }
      return merged;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BUNDLES;
}
function persistBundles(b: InstrumentBundle[]) {
  try {
    localStorage.setItem(BUNDLES_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}
function loadActiveId(): string {
  try {
    return localStorage.getItem(ACTIVE_KEY) || BALANCED9_ID;
  } catch {
    return BALANCED9_ID;
  }
}
function persistActiveId(id: string) {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [universe, setUniverse] = useState<AShareInstrument[]>([]);
  const [settings, setSettings] = useState<CarverSettings>(DEFAULT_CARVER_SETTINGS);
  const [activeTab, setActiveTab] = useState<'sizer' | 'analytics' | 'strategy' | 'execution' | 'backtest' | 'adapter' | 'portfolio' | 'docs'>('sizer');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMonitoringActive, setIsMonitoringActive] = useState(true);
  const [bundles, setBundles] = useState<InstrumentBundle[]>(() => loadBundles());
  const [activeBundleId, setActiveBundleId] = useState<string>(() => loadActiveId());

  const [isSyncingLatest, setIsSyncingLatest] = useState(false);
  const [syncToast, setSyncToast] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // 组合调仓历史全局账本与模态框状态
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [globalRebalanceHistory, setGlobalRebalanceHistory] = useState<RebalanceRecord[]>(() => loadLocalRebalanceHistory());

  // 挂载时拉取服务端持久化的调仓账本
  useEffect(() => {
    let cancelled = false;
    fetchServerRebalanceHistory().then((h) => {
      if (!cancelled && Array.isArray(h) && h.length > 0) {
        setGlobalRebalanceHistory(h);
      }
    });
    return () => { cancelled = true; };
  }, []);

  // 计算当前数据宇宙的最大实际交易日
  const latestTradeDate = useMemo(() => {
    return AShareDataService.getLatestTradeDate(universe);
  }, [universe]);

  // Initialize data on mount (with 4s timeout safeguard to prevent blocking)
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        setIsLoading(false);
      }
    }, 4000);

    async function init() {
      setIsLoading(true);
      try {
        const loaded = await AShareDataService.loadInstruments();
        if (active) setUniverse(loaded);
        // 后台静默检测并增量拉取全市场最新交易日行情
        AShareDataService.syncLatestMarketData()
          .then(syncRes => {
            if (active && syncRes.instruments?.length) {
              setUniverse(syncRes.instruments);
              if (syncRes.report.updatedCount > 0) {
                setSyncToast({
                  type: 'info',
                  message: `已自动增量同步至最新交易日: ${syncRes.report.latestTradingDate} (${syncRes.report.updatedCount} 只标的更新)`,
                });
                setTimeout(() => setSyncToast(null), 4000);
              }
            }
          })
          .catch(e => console.warn('[App] initial sync skipped:', e));
      } catch (err) {
        console.error('Failed to load instruments', err);
      } finally {
        if (active) setIsLoading(false);
        clearTimeout(timer);
      }
    }
    init();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  // 当前激活组合 → 测试宇宙
  const activeBundle = useMemo(
    () => bundles.find((b) => b.id === activeBundleId) ?? bundles[0],
    [bundles, activeBundleId],
  );
  const activeUniverseResolution = useMemo(
    () => resolveUniverseDetailed(universe, activeBundle),
    [universe, activeBundle],
  );
  const activeUniverse = activeUniverseResolution.universe;
  const droppedLegs = activeUniverseResolution.dropped;

  // Recalculate Carver Portfolio Positions whenever universe or settings change
  const { positions, summary } = useMemo(() => {
    return calculatePortfolio(activeUniverse, settings);
  }, [activeUniverse, settings]);

  // 实时监测：当任意标的波动率/持仓偏离触发卡弗缓冲带边界（withinBuffer === false 且需买卖）
  const breachedPositions = useMemo(() => {
    return (positions || []).filter(p => !p?.withinBuffer && (p?.recommendedShares || 0) > 0);
  }, [positions]);

  const hasBufferBreach = isMonitoringActive && breachedPositions.length > 0;
  
  const breachedNames = useMemo(() => {
    return breachedPositions.map(p => `${p?.instrument?.name || '标的'} (${p?.action === 'BUY' ? '买入' : '卖出'}${(p?.recommendedShares || 0) / 100}手)`);
  }, [breachedPositions]);

  // 计算当前组合实际持仓总市值（用于资金对齐与偏离诊断）
  const currentActualHoldingsTotal = useMemo(() => {
    return (positions || []).reduce((acc, p) => acc + (p?.currentValue || 0), 0);
  }, [positions]);

  // 实时监控心跳轮询机制 (监控波动率与缓冲带状态)
  useEffect(() => {
    if (!isMonitoringActive) return;

    const interval = setInterval(() => {
      // 周期性监测标的波动率与偏离度状态
    }, 12000);

    return () => clearInterval(interval);
  }, [isMonitoringActive]);

  // Handlers
  const handleUpdateSettings = (newSettings: CarverSettings) => {
    setSettings(newSettings);
  };

  const handleUpdateInstrumentWeight = (id: string, weight: number) => {
    // 权重是「组合」的属性：编辑即更新当前激活组合的该标的权重（持久化见下方 useEffect）
    setBundles(prev =>
      prev.map(b =>
        b.id === activeBundleId
          ? { ...b, items: b.items.map(it => (it.id === id ? { ...it, riskBudgetWeight: weight } : it)) }
          : b,
      ),
    );
  };

  // 切换组合并自动同步该组合的专属资金规模
  const handleSelectBundle = (id: string) => {
    setActiveBundleId(id);
    persistActiveId(id);
    const target = bundles.find(b => b.id === id);
    if (target?.targetCapital && target.targetCapital > 0) {
      setSettings(prev => ({ ...prev, totalCapital: Math.round(target.targetCapital!) }));
    }
  };

  // 修改当前组合专属总资金（双向同步至 settings.totalCapital 与 bundle.targetCapital 并持久化）
  const handleUpdateBundleCapital = (bundleId: string, capital: number) => {
    const clamped = Math.max(1000, Math.round(capital));
    setSettings(prev => ({ ...prev, totalCapital: clamped }));
    setBundles(prev =>
      prev.map(b => (b.id === bundleId ? { ...b, targetCapital: clamped } : b))
    );
  };

  // 诊断面板「导入主页面」：以固定 imported 槽位覆盖式接收外部组合，并同步其资金规模
  const handleImportToMain = (bundle: InstrumentBundle) => {
    const normalized: InstrumentBundle =
      bundle.id === IMPORTED_BUNDLE_ID ? bundle : { ...bundle, id: IMPORTED_BUNDLE_ID };
    setBundles(prev => [...prev.filter(b => b.id !== IMPORTED_BUNDLE_ID), normalized]);
    setActiveBundleId(IMPORTED_BUNDLE_ID);
    persistActiveId(IMPORTED_BUNDLE_ID);
    if (normalized.targetCapital && normalized.targetCapital > 0) {
      setSettings(prev => ({ ...prev, totalCapital: Math.round(normalized.targetCapital!) }));
    }
  };

  // bundles 持久化（单一出口落盘）
  useEffect(() => {
    persistBundles(bundles);
  }, [bundles]);

  const handleUpdateCurrentShares = (id: string, shares: number) => {
    setUniverse(prev => {
      const updated = prev.map(inst => inst.id === id ? { ...inst, currentShares: shares } : inst);
      AShareDataService.saveInstruments(updated);
      return updated;
    });
  };

  const handleDeleteInstrument = (id: string) => {
    setUniverse(prev => {
      const updated = prev.filter(inst => inst.id !== id);
      AShareDataService.saveInstruments(updated);
      return updated;
    });
  };

  const handleAddInstrument = (newInst: AShareInstrument) => {
    setUniverse(prev => {
      const updated = [...prev, newInst];
      AShareDataService.saveInstruments(updated);
      return updated;
    });
  };

  // 统一调仓执行入口：更新持仓股数，并同步持久化至全局调仓账本
  const handleExecuteRebalance = (record?: RebalanceRecord) => {
    if (record) {
      setGlobalRebalanceHistory(prev => [record, ...prev.filter(r => r.id !== record.id)].slice(0, 500));
    }
    setUniverse(prev => {
      const updated = prev.map(inst => {
        const pos = positions.find(p => p.instrument.id === inst.id);
        if (pos && !pos.withinBuffer && pos.recommendedShares > 0) {
          return { ...inst, currentShares: pos.targetShares };
        }
        return inst;
      });
      AShareDataService.saveInstruments(updated);
      return updated;
    });
  };

  const handleSyncLatest = async () => {
    setIsSyncingLatest(true);
    setIsRefreshing(true);
    try {
      const res = await AShareDataService.syncLatestMarketData();
      setUniverse(res.instruments);
      const rep = res.report;
      setSyncToast({
        type: 'success',
        message: `成功同步 ${rep.updatedCount}/${rep.totalInstruments} 只标的至 ${rep.latestTradingDate || '最新交易日'}，波动率与目标仓位已自动重算！`,
      });
      setTimeout(() => setSyncToast(null), 5000);
    } catch (err: any) {
      setSyncToast({
        type: 'error',
        message: `行情同步失败: ${err?.message || '网络连接超时'}`,
      });
      setTimeout(() => setSyncToast(null), 5000);
    } finally {
      setIsSyncingLatest(false);
      setIsRefreshing(false);
    }
  };

  const handleRefreshData = handleSyncLatest;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090D16] text-slate-300 flex flex-col items-center justify-center font-sans gap-4 p-6">
        <div className="w-9 h-9 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-semibold text-white">正在载入 A 股与 ETF 系统化投资管理工作台...</div>
        <p className="text-xs text-slate-500 max-w-sm text-center">
          正在初始化卡弗波动率模型、相关性矩阵及标的资产行情数据
        </p>
        <button
          onClick={() => setIsLoading(false)}
          className="mt-2 px-3.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono transition-colors border border-slate-700"
        >
          跳过等待直接进入 →
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white relative">
      {/* 顶部标准三区导航 */}
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        pendingTradeCount={summary.pendingTradeCount}
        hasBufferBreach={hasBufferBreach}
        breachedNames={breachedNames}
        isMonitoringActive={isMonitoringActive}
        onToggleMonitoring={() => setIsMonitoringActive(prev => !prev)}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onRefreshData={handleRefreshData}
        isRefreshing={isRefreshing}
        maxLeverageLimitPct={summary.maxLeverageLimitPct}
        latestTradeDate={latestTradeDate}
        isSyncingLatest={isSyncingLatest}
        onSyncLatest={handleSyncLatest}
      />

      {/* 组合（bundle）切换条：任意换一组打包组合后的标的进行测试 */}
      <div className="border-b border-slate-800 bg-[#0B1120]">
        <div className="max-w-[1520px] w-full mx-auto px-4 py-2 flex items-center justify-between gap-3">
          <BundleSelector
            bundles={bundles}
            activeId={activeBundleId}
            activeBundle={activeBundle}
            totalCapital={settings.totalCapital}
            actualHoldingsSum={currentActualHoldingsTotal}
            onSelect={handleSelectBundle}
            onUpdateCapital={(cap) => handleUpdateBundleCapital(activeBundleId, cap)}
            onOpenLedger={() => setIsLedgerModalOpen(true)}
            rebalanceCount={globalRebalanceHistory.length}
          />
        </div>
      </div>

      {/* 资金总览与风险状态 KPI Strip & 动态风险预算贡献图 */}
      <ErrorBoundary name="资金总览与资产风险监控条">
        <PortfolioSummary
          summary={summary}
          settings={settings}
          positions={positions}
        />
      </ErrorBoundary>

      {/* 主工作区 View 切换 */}
      <main className="flex-1 max-w-[1520px] w-full mx-auto pb-12">
        {/* 组合丢腿显式告警（tribunal D1c2/G3i1）：组合引用的标的已不在池中时，
            引擎按绝对预算低配（剩余权重和 <1），静默会发生「钱只投了一半」——
            这里明确告知缺哪些腿、影响是什么，绝不悄悄重归一（那会改变用户风险预算）。 */}
        {droppedLegs.length > 0 && (
          <div className="mx-4 mt-4 px-4 py-3 rounded-lg border border-amber-500/50 bg-amber-950/40 text-amber-200 text-xs font-sans flex items-start gap-3">
            <span className="text-amber-400 text-base leading-none">⚠️</span>
            <div className="flex-1">
              <div className="font-semibold text-amber-300">
                当前组合「{activeBundle.name}」有 {droppedLegs.length} 条腿的标的已不在统一池中：
                <span className="font-mono">{droppedLegs.join('、')}</span>
              </div>
              <div className="mt-1 text-amber-200/80">
                这些腿已被跳过，剩余腿按原风险预算绝对配比执行（不会自动放大填满，故组合整体可能低配、留现金）。
                如想恢复：在「数据适配」页重新拉取该标的入池，或编辑当前组合移除这些腿。
              </div>
            </div>
          </div>
        )}
        {activeTab === 'sizer' && (
          <ErrorBoundary name="卡弗波动率定仓工作台">
            <CarverPositionSizer
              universe={activeUniverse}
              positions={positions}
              settings={settings}
              activeBundleId={activeBundle.id}
              activeBundleName={activeBundle.name}
              onUpdateSettings={handleUpdateSettings}
              onUpdateInstrumentWeight={handleUpdateInstrumentWeight}
              onUpdateCurrentShares={handleUpdateCurrentShares}
              onDeleteInstrument={handleDeleteInstrument}
              onUpdateBundleCapital={(cap) => handleUpdateBundleCapital(activeBundle.id, cap)}
              onExecuteRebalanceWithRecord={handleExecuteRebalance}
            />
          </ErrorBoundary>
        )}

        <ErrorBoundary name="定仓工作台模块">
        <Suspense fallback={
          <div className="flex flex-col items-center justify-center min-h-[60vh] p-16 text-slate-400 font-mono gap-3">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">按需载入模块资源...</span>
          </div>
        }>
          {activeTab === 'analytics' && (
            <InstrumentDeepAnalysisPanel
              universe={activeUniverse}
              positions={positions}
              settings={settings}
              onNavigateToExecution={() => setActiveTab('execution')}
            />
          )}

          {activeTab === 'strategy' && (
            <StrategyAnalysisPanel
              universe={activeUniverse}
            />
          )}

          {activeTab === 'execution' && (
            <RebalanceExecutionPanel
              positions={positions}
              settings={settings}
              activeBundleId={activeBundle.id}
              activeBundleName={activeBundle.name}
              universe={activeUniverse}
              onExecuteRebalance={handleExecuteRebalance}
              onUpdateCurrentShares={handleUpdateCurrentShares}
              onUpdateBundleCapital={(cap) => handleUpdateBundleCapital(activeBundle.id, cap)}
            />
          )}

          {activeTab === 'backtest' && (
            <BacktestSandbox
              universe={activeUniverse}
              settings={settings}
              summary={summary}
            />
          )}

          {activeTab === 'adapter' && (
            <DataAdapterConsole
              universe={universe}
              onUniverseUpdated={setUniverse}
              latestTradeDate={latestTradeDate}
              onSyncLatest={handleSyncLatest}
              isSyncingLatest={isSyncingLatest}
            />
          )}

          {activeTab === 'portfolio' && (
            <CustomPortfolioDiagnosticPanel
              universe={universe}
              settings={settings}
              onImportToMain={handleImportToMain}
            />
          )}

          {activeTab === 'docs' && (
            <DocumentationCenter />
          )}
        </Suspense>
        </ErrorBoundary>
      </main>

      {/* 实时行情同步状态悬浮提示 */}
      {syncToast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg border shadow-2xl flex items-center gap-3 text-xs font-sans transition-all animate-bounce ${
          syncToast.type === 'success'
            ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/60 shadow-emerald-950/50'
            : syncToast.type === 'error'
            ? 'bg-rose-950/95 text-rose-200 border-rose-500/60 shadow-rose-950/50'
            : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-950/50'
        }`}>
          <span className={`w-2 h-2 rounded-full ${syncToast.type === 'success' ? 'bg-emerald-400' : syncToast.type === 'error' ? 'bg-rose-400' : 'bg-cyan-400'} animate-ping`} />
          <span className="font-medium">{syncToast.message}</span>
          <button
            onClick={() => setSyncToast(null)}
            className="ml-2 text-slate-400 hover:text-white text-xs px-1 hover:bg-slate-800 rounded"
          >
            ✕
          </button>
        </div>
      )}

      {/* 添加标的模态窗口 */}
      <AddInstrumentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddInstrument}
      />

      {/* 组合调仓历史总账本模态窗口 */}
      <RebalanceHistoryModal
        isOpen={isLedgerModalOpen}
        onClose={() => setIsLedgerModalOpen(false)}
        history={globalRebalanceHistory}
        activeBundleId={activeBundle.id}
        activeBundleName={activeBundle.name}
      />
    </div>
  );
}
