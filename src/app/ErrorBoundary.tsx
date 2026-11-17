import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

/** 兜底错误边界：单页渲染异常时不至于整窗空白。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("WeightCoach render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md rounded-3xl border border-line/80 bg-paper p-8 text-center shadow-card">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-[20px] font-semibold text-accent">!</div>
          <h1 className="mt-4 text-[18px] font-semibold text-ink">页面出了点问题</h1>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            你的记录仍保存在本机，没有上传。可以重新加载；如果反复出现，请把下面的信息发给我。
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded-xl bg-bg p-3 text-left text-[9px] leading-relaxed text-muted">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <button className="rounded-xl bg-primary px-4 py-2 text-[11px] font-medium text-white" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <button className="rounded-xl border border-line bg-paper px-4 py-2 text-[11px] text-muted" onClick={() => this.setState({ error: null })}>
              返回上一页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
