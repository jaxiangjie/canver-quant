import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { 
  AShareInstrument, 
  CarverSettings 
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

// 代码分割 (Code-splitting)：非首屏重度面板采用懒加载，大幅缩减首屏单体 JS 体积
const StrategyAnalysisPanel = lazy(() => import('./components/StrategyAnalysisPanel').then(m => ({ default: m.StrategyAnalysisPanel })));
const RebalanceExecutionPanel = lazy(() => import('./components/RebalanceExecutionPanel').then(m => ({ default: m.RebalanceExecutionPanel })));
const BacktestSandbox = lazy(() => import('./components/BacktestSandbox').then(m => ({ default: m.BacktestSandbox })));
const DataAdapterConsole = lazy(() => import('./components/DataAdapterConsole').then(m => ({ default: m.DataAdapterConsole })));
const InstrumentDeepAnalysisPanel = lazy(() => import('./components/InstrumentDeepAnalysisPanel').then(m => ({ default: m.InstrumentDeepAnalysisPanel })));
const CustomPortfolioDiagnosticPanel = lazy(() => import('./components/CustomPortfolioDiagnosticPanel').then(m => ({ default: m.CustomPortfolioDiagnosticPanel })));
const DocumentationCenter = lazy(() => import('./components/DocumentationCenter').then(m => ({ default: m.DocumentationCenter })));

// 组合（bundle）层：把 catalog 按组合定义过滤+套权重，得到可切换的测试宇宙
import { DEFAULT_BUNDLES, BALANCED9_ID, resolveUniverse, InstrumentBundle } from './services/bundles';
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

  // 计算当前数据宇宙的最大实际交易日
  const latestTradeDate = useMemo(() => {
    return AShareDataService.getLatestTradeDate(universe);
  }, [universe]);

  // Initialize data on mount
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const loaded = await AShareDataService.loadInstruments();
        setUniverse(loaded);
        // 后台静默检测并增量拉取全市场最新交易日行情
        AShareDataService.syncLatestMarketData()
          .then(syncRes => {
            if (syncRes.instruments?.length) {
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
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // 当前激活组合 → 测试宇宙
  const activeBundle = useMemo(
    () => bundles.find((b) => b.id === activeBundleId) ?? bundles[0],
    [bundles, activeBundleId],
  );
  const activeUniverse = useMemo(
    () => resolveUniverse(universe, activeBundle),
    [universe, activeBundle],
  );

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
    // 权重是「组合」的属性：编辑即更新当前激活组合的该标的权重，并持久化到 localStorage
    setBundles(prev => {
      const next = prev.map(b =>
        b.id === activeBundleId
          ? { ...b, items: b.items.map(it => (it.id === id ? { ...it, riskBudgetWeight: weight } : it)) }
          : b,
      );
      persistBundles(next);
      return next;
    });
  };

  // 诊断面板「导入主页面」：以固定 imported 槽位覆盖式接收外部组合（多次导入覆盖不新建），
  // 并切换为主页面激活组合——随后全部按主页面设置计算（Sizer/回测/分析全链路）。
  const handleImportToMain = (bundle: InstrumentBundle) => {
    setBundles(prev => {
      const next = [...prev.filter(b => b.id !== IMPORTED_BUNDLE_ID), bundle];
      persistBundles(next);
      return next;
    });
    setActiveBundleId(IMPORTED_BUNDLE_ID);
    persistActiveId(IMPORTED_BUNDLE_ID);
  };

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

  const handleExecuteRebalance = () => {
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
      <div className="min-h-screen bg-[#090D16] text-slate-300 flex items-center justify-center font-mono">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-xs text-slate-400">正在载入 A 股与 ETF 系统化投资管理工作台...</div>
        </div>
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
        <div className="max-w-[1520px] w-full mx-auto px-4 py-2 flex items-center gap-3">
          <BundleSelector
            bundles={bundles}
            activeId={activeBundleId}
            onSelect={(id) => { setActiveBundleId(id); persistActiveId(id); }}
          />
          <span className="text-[11px] text-slate-500 truncate">{activeBundle?.description}</span>
        </div>
      </div>

      {/* 资金总览与风险状态 KPI Strip & 动态风险预算贡献图 */}
      <PortfolioSummary
        summary={summary}
        settings={settings}
        positions={positions}
      />

      {/* 主工作区 View 切换 */}
      <main className="flex-1 max-w-[1520px] w-full mx-auto pb-12">
        {activeTab === 'sizer' && (
          <CarverPositionSizer
            universe={activeUniverse}
            positions={positions}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onUpdateInstrumentWeight={handleUpdateInstrumentWeight}
            onUpdateCurrentShares={handleUpdateCurrentShares}
            onDeleteInstrument={handleDeleteInstrument}
          />
        )}

        <ErrorBoundary name="定仓工作台模块">
        <Suspense fallback={
          <div className="flex flex-col items-center justify-center p-16 text-slate-400 font-mono gap-3">
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
              onExecuteRebalance={handleExecuteRebalance}
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
    </div>
  );
}
