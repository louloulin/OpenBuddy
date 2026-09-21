/**
 * AiErrorBoundary — 邮件 AI 区域的紧凑错误边界(P3-6)。
 *
 * 设计动机:
 *   - 共用 `src/components/ErrorBoundary.tsx` 渲染逻辑(compact 模式),
 *     但额外把异常转发到 `errorReporter`(默认 console.error,未来接 Sentry)。
 *   - 把 AI 闭环异常"局部化"——只显示紧凑恢复卡,不挤压侧栏 / Topbar。
 *
 * 用法:
 *   <AiErrorBoundary scope="ai-inbox"><AiInboxShell ... /></AiErrorBoundary>
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { errorReporter } from "../error-reporter";

export interface AiErrorBoundaryProps {
  children: ReactNode;
  /** 用于 telemetry 区分 region(ai-inbox / ai-summary / ai-action-strip / ...)。 */
  scope: string;
  /** 测试用:替换 ErrorBoundary 渲染(默认用 src/components/ErrorBoundary compact)。 */
  renderFallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

export class AiErrorBoundary extends Component<AiErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 上报 — 不包含 PII(scope / componentStack 是结构化信息)。
    errorReporter.captureException(error, {
      scope: this.props.scope,
      componentStack: info.componentStack?.split("\n").slice(0, 8).join("\n") ?? null,
    });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { children, scope, renderFallback } = this.props;
    if (this.state.error) {
      if (renderFallback) {
        return renderFallback(this.state.error, this.reset);
      }
      // 复用根 ErrorBoundary compact 样式,标题带 scope 提示。
      return (
        <ErrorBoundary
          compact
          title={`${scope} 出现错误`}
        >
          {children}
        </ErrorBoundary>
      );
    }
    return children;
  }
}
