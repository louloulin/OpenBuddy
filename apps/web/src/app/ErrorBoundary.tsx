/**
 * 应用级错误边界 (O1): a render error no longer leaves a white window. The fallback keeps the
 * rest of the renderer's state (drafts live in stores), and offers 重试 / 返回首页 / 复制诊断.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { agentDiagnose } from "@openbuddy/client/agent-client";
import { copyText } from "@openbuddy/platform/clipboard";

interface Props {
  children: ReactNode;
  /** Shown in the diagnostic report so a report says which surface failed. */
  scope?: string;
}

interface State {
  error?: Error;
  componentStack?: string;
  status?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? "" });
    // Keep a local trace even if the diagnostics command is unavailable (browser preview).
    console.error(`[${this.props.scope ?? "app"}] render error`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: undefined, componentStack: undefined, status: undefined });
  private goHome = () => { window.location.hash = "#/"; this.reset(); };

  private copyDiagnostics = async () => {
    const { error, componentStack } = this.state;
    const feedback = [error?.message ?? "unknown error", error?.stack ?? "", componentStack ?? ""].filter(Boolean).join("\n\n").slice(0, 3800);
    try {
      const result = await agentDiagnose({ app: "OpenBuddy", feedback: `[${this.props.scope ?? "app"}] ${feedback}` });
      await copyText(result.diagnostics);
      this.setState({ status: "诊断已复制到剪贴板（不含密钥与绝对路径）" });
    } catch {
      try {
        await copyText(feedback);
        this.setState({ status: "诊断命令不可用，已复制错误摘要" });
      } catch {
        this.setState({ status: "复制失败，请检查剪贴板权限" });
      }
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error.message || String(this.state.error);
    return (
      <div className="ob-crash" role="alert" aria-live="assertive">
        <div className="ob-crash__card">
          <div className="ob-crash__badge">OpenBuddy</div>
          <h1 className="ob-crash__title">这个页面遇到了问题</h1>
          <p className="ob-crash__desc">你的草稿和会话都还在。可以先重试，或回到首页继续其他任务。</p>
          <pre className="ob-crash__error" aria-label="错误信息">{message}</pre>
          <div className="ob-crash__actions">
            <button type="button" className="um-btn um-btn--primary" onClick={this.reset}>重试</button>
            <button type="button" className="um-btn um-btn--grey" onClick={this.goHome}>返回首页</button>
            <button type="button" className="um-btn um-btn--grey" onClick={() => void this.copyDiagnostics()}>复制诊断</button>
          </div>
          {this.state.status && <p className="ob-crash__status" role="status">{this.state.status}</p>}
        </div>
      </div>
    );
  }
}
