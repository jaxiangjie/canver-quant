import React from 'react';

interface Props {
  children: React.ReactNode;
  /** 边界名（用于提示用户哪个模块挂了） */
  name?: string;
}

interface State {
  error: Error | null;
}

/**
 * 懒加载面板的错误边界（2026-10-14，tribunal V7）。
 * 背景：App.tsx 把 7 个重度面板改为 React.lazy 代码分割后，chunk 加载失败
 * （部署后旧标签页拿到过期 index.html 请求已哈希资源 404、网络抖动、CDN 丢包）
 * 会从根节点卸载整棵树——Header、KPI、默认 tab 全部白屏，prod 构建连 Vite
 * 报错浮层都没有，用户唯一恢复手段是手动刷新。此边界把「一次 chunk 404」
 * 降级为「一个模块的加载失败」：展示重试按钮（含一次自动 import 重试），
 * 保住应用骨架。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  private retried = false;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? ' ' + this.props.name : ''}]`, error, info.componentStack);
  }

  private handleReload = () => {
    // 优先原地重试一次（不清全应用状态），失败再整页刷新
    this.setState({ error: null });
    if (this.retried) {
      window.location.reload();
    } else {
      this.retried = true;
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <div className="text-rose-400 text-sm font-semibold">
          {this.props.name ? `「${this.props.name}」` : '该模块'}加载失败
        </div>
        <pre className="max-w-xl text-[11px] text-slate-400 font-mono whitespace-pre-wrap break-all">
          {this.state.error.message}
        </pre>
        <button
          onClick={this.handleReload}
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
        >
          重试载入
        </button>
        <div className="text-[10px] text-slate-500">
          若多次重试仍失败，请刷新页面（F5）；这通常是部署后浏览器缓存了旧版本资源所致
        </div>
      </div>
    );
  }
}
