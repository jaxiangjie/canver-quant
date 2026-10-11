import { 
  BarChart3, 
  Layers, 
  FileCheck, 
  LineChart, 
  Database, 
  PlusCircle, 
  RefreshCw,
  BellRing,
  Activity,
  Radar,
  BookOpen
} from 'lucide-react';

interface HeaderProps {
  activeTab: 'sizer' | 'analytics' | 'strategy' | 'execution' | 'backtest' | 'adapter' | 'docs';
  onTabChange: (tab: 'sizer' | 'analytics' | 'strategy' | 'execution' | 'backtest' | 'adapter' | 'docs') => void;
  pendingTradeCount: number;
  hasBufferBreach: boolean;
  breachedNames?: string[];
  isMonitoringActive?: boolean;
  onToggleMonitoring?: () => void;
  onOpenAddModal: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
  maxLeverageLimitPct?: number;
  latestTradeDate?: string;
  isSyncingLatest?: boolean;
  onSyncLatest?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  pendingTradeCount,
  hasBufferBreach,
  breachedNames = [],
  isMonitoringActive = true,
  onToggleMonitoring,
  onOpenAddModal,
  onRefreshData,
  isRefreshing,
  maxLeverageLimitPct = 20,
  latestTradeDate,
  isSyncingLatest = false,
  onSyncLatest,
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0D131F] border-b border-slate-800 text-slate-200">
      {/* Zone 1: Brand Wordmark (Single text element, strict display face) */}
      <div className="flex items-center gap-3 shrink-0">
        <a 
          href="#home" 
          onClick={(e) => { e.preventDefault(); onTabChange('sizer'); }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap hover:text-emerald-400 transition-colors"
        >
          SYSTEMATIC WORKBENCH
        </a>
        <span className="text-xs text-slate-500 hidden sm:inline">· 100万卡弗模型 · A股与ETF专属</span>
      </div>

      {/* Zone 2: Navigation Links (Single line, whitespace-nowrap) */}
      <nav className="hidden lg:flex items-center gap-6 text-xs font-medium text-slate-400">
        <button
          onClick={() => onTabChange('sizer')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'sizer' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>波动率定仓工作台</span>
        </button>

        <button
          onClick={() => onTabChange('analytics')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'analytics' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <Radar className="w-3.5 h-3.5 text-emerald-400" />
          <span>标的多维深度投研</span>
        </button>

        <button
          onClick={() => onTabChange('strategy')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'strategy' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>A股&ETF定制策略</span>
        </button>

        <button
          onClick={() => onTabChange('execution')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 relative ${
            activeTab === 'execution' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5" />
          <span>日频调仓执行单</span>
          {pendingTradeCount > 0 && (
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
              hasBufferBreach
                ? 'bg-amber-500/30 text-amber-200 border-amber-500/60 animate-pulse font-bold'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}>
              {pendingTradeCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onTabChange('backtest')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'backtest' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <LineChart className="w-3.5 h-3.5" />
          <span>历史回测沙盘</span>
        </button>

        <button
          onClick={() => onTabChange('adapter')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'adapter' ? 'text-white border-b-2 border-emerald-500 font-semibold' : 'hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>A股数据接口与纪律</span>
        </button>

        <button
          onClick={() => onTabChange('docs')}
          className={`flex items-center gap-1.5 whitespace-nowrap transition-colors py-1 ${
            activeTab === 'docs' ? 'text-white border-b-2 border-indigo-400 font-semibold' : 'hover:text-indigo-300'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
          <span>系统文档与架构指南</span>
        </button>
      </nav>

      {/* Zone 3: Primary Action & Control (Single line) */}
      <div className="flex items-center gap-3 shrink-0">
        {/* 卡弗调仓缓冲带边界触发闪烁标记 */}
        {hasBufferBreach ? (
          <button
            onClick={() => onTabChange('execution')}
            title={`卡弗缓冲带触发：${breachedNames.join('、')}`}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-300 bg-amber-950/90 hover:bg-amber-900 border border-amber-500/70 rounded animate-pulse transition-all shadow-md shadow-amber-950/60 whitespace-nowrap cursor-pointer"
          >
            <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-bounce" />
            <span>缓冲带触发 · 建议调仓 ({pendingTradeCount}只)</span>
          </button>
        ) : (
          <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400 font-mono px-2.5 py-1 bg-slate-900/60 rounded border border-slate-800">
            <Activity className="w-3 h-3 text-emerald-400" />
            <span>缓冲监控中</span>
          </div>
        )}

        {latestTradeDate && (
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 bg-slate-900/90 rounded border border-slate-700/70 text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-400">行情至:</span>
            <span className="text-emerald-400 font-semibold">{latestTradeDate}</span>
          </div>
        )}

        <div className="hidden 2xl:flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono px-2.5 py-1 bg-emerald-950/40 rounded border border-emerald-800/40">
          <span>🛡️ 杠杆上限 ≤{maxLeverageLimitPct}%</span>
        </div>

        <button
          onClick={onSyncLatest || onRefreshData}
          disabled={isSyncingLatest || isRefreshing}
          title="在线拉取最新真实交易日行情数据 (OHLCV、ATR与波动率)"
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border transition-all whitespace-nowrap cursor-pointer ${
            isSyncingLatest
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 hover:text-white border-emerald-500/40 shadow-sm'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${(isSyncingLatest || isRefreshing) ? 'animate-spin' : ''}`} />
          <span>{isSyncingLatest ? '正在同步最新日线...' : '同步最新行情'}</span>
        </button>

        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded border border-emerald-500/30 transition-colors whitespace-nowrap"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>添加A股/ETF</span>
        </button>
      </div>
    </header>
  );
};
