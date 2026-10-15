import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RotateCcw, Trash2, Copy, Check, Terminal, ExternalLink } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error('[GlobalErrorBoundary] Fatal Uncaught Exception in React Tree:', error, errorInfo);
  }

  public componentDidMount() {
    // 捕获未处理的全局 Promise 拒绝与资源加载异常
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.addEventListener('error', this.handleGlobalError);
  }

  public componentWillUnmount() {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
    window.removeEventListener('error', this.handleGlobalError);
  }

  private isBenignError = (err: any): boolean => {
    const msg = String(err?.message || err || '');
    return (
      msg.includes('WebSocket') ||
      msg.includes('vite') ||
      msg.includes('HMR') ||
      msg.includes('ResizeObserver') ||
      msg.includes('AbortError') ||
      msg.includes('canceled') ||
      msg.includes('cancelled')
    );
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    // 忽略开发环境/iframe 中由禁用 HMR 引发的正常 WebSocket 关闭事件
    if (this.isBenignError(event.reason)) {
      event.preventDefault();
      return;
    }
    console.warn('[GlobalErrorBoundary] Unhandled rejection:', event.reason);
  };

  private handleGlobalError = (event: ErrorEvent) => {
    if (this.isBenignError(event.error || event.message)) {
      event.preventDefault();
      return;
    }
    console.warn('[GlobalErrorBoundary] Global error:', event.error || event.message);
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetStorage = () => {
    try {
      // 清除可能损坏的前端本地缓存
      const keysToRemove = [
        'canver.bundles.v1',
        'canver.activeBundle.v1',
        'carver_rebalance_history_v1',
        'carver_ashare_universe_v3',
        'carver_data_adapter_config_v1',
        'carver_custom_portfolios_v1',
      ];
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  private handleCopyError = () => {
    const report = [
      `【A股卡弗量化工作台 - 崩溃诊断报告】`,
      `时间: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `错误名称: ${this.state.error?.name || 'Unknown'}`,
      `错误信息: ${this.state.error?.message || '未知错误'}`,
      `调用栈:`,
      this.state.error?.stack || '无栈信息',
      `组件调用栈:`,
      this.state.errorInfo?.componentStack || '无组件栈信息',
    ].join('\n');

    navigator.clipboard.writeText(report);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2500);
  };

  public render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const stack = err?.stack || this.state.errorInfo?.componentStack || '';

      return (
        <div className="min-h-screen bg-[#070B14] text-slate-100 flex items-center justify-center p-6 font-sans">
          <div className="max-w-2xl w-full bg-slate-900/90 border border-red-500/40 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col gap-6 backdrop-blur-md">
            {/* 顶部警示区 */}
            <div className="flex items-start gap-4">
              <div className="p-3 bg-red-950/80 border border-red-800/80 rounded-xl text-red-400 shrink-0">
                <AlertOctagon className="w-8 h-8" />
              </div>
              <div className="flex-1">
                <h1 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>工作台启动渲染保护已触发 (Runtime Crash Prevented)</span>
                </h1>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  检测到组件渲染或状态初始化异常，根边界已拦截该崩溃以避免界面白屏。系统已保护现有资产配置，请按下方指引恢复。
                </p>
              </div>
            </div>

            {/* 错误明细摘要卡 */}
            <div className="p-4 bg-slate-950/90 border border-slate-800 rounded-xl flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  异常详情 (Error Diagnosis)
                </span>
                <span className="font-mono text-[11px] text-red-400 font-semibold">
                  {err?.name || 'Error'}
                </span>
              </div>
              <div className="text-xs text-red-300 font-mono break-all font-semibold bg-red-950/30 p-2.5 rounded border border-red-900/40">
                {err?.message || '组件在挂载时发生未知异常'}
              </div>
              {stack && (
                <div className="mt-2">
                  <span className="text-[10px] text-slate-500 block mb-1">执行栈追踪:</span>
                  <pre className="text-[10px] text-slate-400 font-mono bg-black/60 p-2.5 rounded max-h-40 overflow-y-auto whitespace-pre-wrap leading-tight">
                    {stack}
                  </pre>
                </div>
              )}
            </div>

            {/* 恢复控制栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={this.handleReload}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>刷新页面重试</span>
                </button>

                <button
                  onClick={this.handleResetStorage}
                  className="px-4 py-2 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                  title="清除可能损坏的 localStorage 本地缓存并重置为官方预置默认值"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清除缓存并重置恢复</span>
                </button>
              </div>

              <button
                onClick={this.handleCopyError}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors border border-slate-700"
              >
                {this.state.copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{this.state.copied ? '诊断日志已复制' : '复制诊断日志'}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
