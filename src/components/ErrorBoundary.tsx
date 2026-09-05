/**
 * ErrorBoundary — R2.3 全局错误边界。
 *
 * 渲染期未捕获的 throw 过去会让整个 renderer 白屏(尤其 Markdown 解析或
 * plugin slot 渲染出错时)。本组件捕获后展示友好的 fallback + 重置按钮,
 * 让用户可以返回首页而不是完全失去控制台。
 *
 * 用法:
 *   <ErrorBoundary><App /></ErrorBoundary>
 *
 * 已知限制:不能捕获异步错误(promise reject)、事件处理器错误,以及
 * 服务端渲染错误。Electron 主进程崩溃另由 bridge-status 上报,不归这里管。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Custom fallback title. */
  title?: string;
  /** Whether to show "返回首页" reset button (defaults true). */
  showReset?: boolean;
  /**
    * R6.8 — compact 内联模式。子区域 (Composer / ChatView / EmailPanel / Sidebar
    * / Settings / PlaceholderPage) 任一抛错时,只在该区域显示一个紧凑的恢复
    * 卡片,而非整页白屏 + 重置全树。默认 false(根 ErrorBoundary 用全屏卡)。
    */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 单条 console.error 即可 — 不向 production 用户上报(无 backend)。
    // 若未来接入 telemetry,在此处 sendBeacon。
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  handleReload = (): void => {
    if (typeof window !== "undefined" && window.location) {
      window.location.reload();
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // R6.8 — compact 模式:用紧凑卡片,只占子区域范围,不挤掉兄弟节点。
    if (this.props.compact) {
      return (
        <div
          className="error-boundary error-boundary--compact"
          role="alert"
          aria-live="assertive"
          style={{
            padding: "16px",
            margin: "12px",
            border: "1px solid var(--border-subtle, #d0d7de)",
            borderRadius: "8px",
            background: "var(--bg-elevated, #fff8f8)",
            fontFamily: "system-ui, sans-serif",
            color: "var(--fg-default, #1f2328)",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 6px" }}>
            {this.props.title ?? "本区域出现错误"}
          </div>
          <div style={{ fontSize: "13px", lineHeight: 1.5, margin: "0 0 8px" }}>
            {error.message?.slice(0, 160) ?? "未知错误"}
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: "4px 12px",
                border: "1px solid var(--border-default, #d0d7de)",
                borderRadius: "4px",
                background: "var(--bg-default, #fff)",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: "4px 12px",
                border: "1px solid var(--border-default, #d0d7de)",
                borderRadius: "4px",
                background: "var(--bg-default, #fff)",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              重新加载应用
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="error-boundary"
        role="alert"
        aria-live="assertive"
        style={{
          padding: "32px",
          maxWidth: "720px",
          margin: "48px auto",
          fontFamily: "system-ui, sans-serif",
          color: "var(--fg-default, #1f2328)",
          background: "var(--bg-elevated, #ffffff)",
          borderRadius: "12px",
          border: "1px solid var(--border-subtle, #d0d7de)",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
        }}
      >
        <h1 style={{ fontSize: "20px", margin: "0 0 12px" }}>
          {this.props.title ?? "界面出现错误"}
        </h1>
        <p style={{ margin: "0 0 16px", lineHeight: 1.6 }}>
          应用层捕获到一个渲染错误,工作台已暂停。你可以返回首页继续使用,
          或查看下方错误信息反馈给我们。
        </p>
        <details
          style={{
            margin: "12px 0",
            padding: "12px",
            background: "var(--bg-subtle, #f6f8fa)",
            borderRadius: "6px",
            fontSize: "13px",
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 500 }}>
            查看错误详情
          </summary>
          <pre
            style={{
              margin: "8px 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "ui-monospace, monospace",
              fontSize: "12px",
            }}
          >
            {error.message}
            {"\n\n"}
            {error.stack?.split("\n").slice(0, 8).join("\n")}
          </pre>
        </details>
        <div style={{ display: "flex", gap: "8px" }}>
          {this.props.showReset !== false && (
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: "8px 16px",
                border: "1px solid var(--border-default, #d0d7de)",
                borderRadius: "6px",
                background: "var(--bg-default, #ffffff)",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              返回首页
            </button>
          )}
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: "8px 16px",
              border: "1px solid var(--border-default, #d0d7de)",
              borderRadius: "6px",
              background: "var(--bg-default, #ffffff)",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}