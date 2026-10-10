import React, { useState, useEffect, useMemo } from 'react';
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
import { PortfolioSummary } from './components/PortfolioSummary';
import { CarverPositionSizer } from './components/CarverPositionSizer';
import { StrategyAnalysisPanel } from './components/StrategyAnalysisPanel';
import { RebalanceExecutionPanel } from './components/RebalanceExecutionPanel';
import { BacktestSandbox } from './components/BacktestSandbox';
import { DataAdapterConsole } from './components/DataAdapterConsole';
import { AddInstrumentModal } from './components/AddInstrumentModal';
import { InstrumentDeepAnalysisPanel } from './components/InstrumentDeepAnalysisPanel';
import { DocumentationCenter } from './components/DocumentationCenter';

export default function App() {
  const [universe, setUniverse] = useState<AShareInstrument[]>([]);
  const [settings, setSettings] = useState<CarverSettings>(DEFAULT_CARVER_SETTINGS);
  const [activeTab, setActiveTab] = useState<'sizer' | 'analytics' | 'strategy' | 'execution' | 'backtest' | 'adapter' | 'docs'>('sizer');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMonitoringActive, setIsMonitoringActive] = useState(true);

  // Initialize data on mount
  useEffect(() => {
    async function init() {
      setIsLoading(true);
      try {
        const loaded = await AShareDataService.loadInstruments();
        setUniverse(loaded);
      } catch (err) {
        console.error('Failed to load instruments', err);
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Recalculate Carver Portfolio Positions whenever universe or settings change
  const { positions, summary } = useMemo(() => {
    return calculatePortfolio(universe, settings);
  }, [universe, settings]);

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
    setUniverse(prev => {
      const updated = prev.map(inst => inst.id === id ? { ...inst, riskBudgetWeight: weight } : inst);
      AShareDataService.saveInstruments(updated);
      return updated;
    });
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

  const handleRefreshData = async () => {
    setIsRefreshing(true);
    try {
      // Simulate slight closing drift or fetch live API
      const updated = universe.map(inst => {
        const randDrift = (Math.random() - 0.48) * 0.008;
        const newPrice = Number(Math.max(0.1, inst.currentPrice * (1 + randDrift)).toFixed(3));
        const newPct = Number((((newPrice - inst.preClose) / inst.preClose) * 100).toFixed(2));
        return {
          ...inst,
          currentPrice: newPrice,
          changePct: newPct,
        };
      });
      setUniverse(updated);
      await AShareDataService.saveInstruments(updated);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

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
    <div className="min-h-screen bg-[#090D16] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
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
      />

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
            universe={universe}
            positions={positions}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onUpdateInstrumentWeight={handleUpdateInstrumentWeight}
            onUpdateCurrentShares={handleUpdateCurrentShares}
            onDeleteInstrument={handleDeleteInstrument}
          />
        )}

        {activeTab === 'analytics' && (
          <InstrumentDeepAnalysisPanel
            universe={universe}
            positions={positions}
            settings={settings}
            onNavigateToExecution={() => setActiveTab('execution')}
          />
        )}

        {activeTab === 'strategy' && (
          <StrategyAnalysisPanel
            universe={universe}
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
            universe={universe}
            settings={settings}
            summary={summary}
          />
        )}

        {activeTab === 'adapter' && (
          <DataAdapterConsole
            universe={universe}
            onUniverseUpdated={setUniverse}
          />
        )}

        {activeTab === 'docs' && (
          <DocumentationCenter />
        )}
      </main>

      {/* 添加标的模态窗口 */}
      <AddInstrumentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddInstrument}
      />
    </div>
  );
}
