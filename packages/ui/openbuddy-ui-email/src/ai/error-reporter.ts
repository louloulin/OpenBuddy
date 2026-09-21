import { useSyncExternalStore } from "react";
/**
 * error-reporter — 错误上报抽象(P3-6)。
 *
 * 设计目标:
 *   - 把 "AI 调用失败时上报" 这件事从 console.warn 升级成可观测入口。
 *   - 默认实现:本地缓冲 + 控制台告警(未来接 Sentry 时只换 reporter 即可)。
 *   - 接口与 Sentry.captureException 对齐,迁移成本 ~10 行。
 *
 * 未来接入 Sentry 的步骤:
 *   1) `pnpm add @sentry/electron @sentry/react`
 *   2) 在 main.tsx 启动 Sentry.init(...)
 *   3) 实现 createSentryReporter() 替换 defaultReporter
 *   4) 在 ErrorBoundary / useAiInbox 失败路径调用 reporter.captureException(err)
 *
 * PII 策略(本期 + 未来):
 *   - 邮件主题/正文/发件人地址 永远不进 reporter。
 *   - 只上报:error.message + error.name + componentStack 前 8 行。
 *   - 用户可在 Settings → 隐私里关闭。
 */
import type { ErrorInfo } from "react";

export interface ReportedError {
  message: string;
  name: string;
  /** React component stack 前 8 行(若有)。 */
  componentStack?: string;
  /** 自由上下文,如 `{ accountId: "a1", action: "summarize" }`。不含 PII。 */
  context?: Record<string, string | number | boolean | null>;
  /** 上报时间戳。 */
  ts: number;
}

export interface ErrorReporter {
  captureException(error: Error, context?: ReportedError["context"]): void;
  captureMessage(message: string, context?: ReportedError["context"]): void;
  /** 获取本地缓冲(用于 Settings 显示最近 N 条)。 */
  recent(limit?: number): ReadonlyArray<ReportedError>;
  /** 清空缓冲。 */
  subscribe(listener: () => void): () => void;
  clear(): void;
}

const MAX_BUFFER = 100;

interface State {
  buffer: ReportedError[];
  enabled: boolean;
}

let state: State = { buffer: [], enabled: true };
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function record(entry: ReportedError): void {
  const buffer = state.buffer.length >= MAX_BUFFER
    ? [...state.buffer.slice(state.buffer.length - MAX_BUFFER + 1), entry]
    : [...state.buffer, entry];
  state = { ...state, buffer };
  notify();
}

export const errorReporter: ErrorReporter = {
  captureException(error, context) {
    if (!state.enabled) return;
    const entry: ReportedError = {
      message: String(error?.message ?? "unknown").slice(0, 200),
      name: String(error?.name ?? "Error"),
      context: context ? sanitizeContext(context) : undefined,
      ts: Date.now(),
    };
    record(entry);
    // 默认 console.error 出口,便于开发期排查
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.error("[email-error-reporter]", entry.name, entry.message, context ?? "");
    }
    // 未来 Sentry:Sentry.captureException(error, { extra: context });
  },
  captureMessage(message, context) {
    if (!state.enabled) return;
    const entry: ReportedError = {
      message: String(message).slice(0, 200),
      name: "Message",
      context: context ? sanitizeContext(context) : undefined,
      ts: Date.now(),
    };
    record(entry);
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[email-error-reporter]", message, context ?? "");
    }
    // 未来 Sentry:Sentry.captureMessage(message, { extra: context });
  },
  recent(limit = 20) {
    return state.buffer.slice(-limit);
  },
  clear() {
    state = { ...state, buffer: [] };
    notify();
  },
  /** 测试 / 外部 hook 订阅。 */
  subscribe,
};

/** 测试 / Settings 切换:启用 / 禁用上报。仅在变化时 notify。 */
export function setErrorReportingEnabled(enabled: boolean): void {
  if (state.enabled === enabled) return;
  state = { ...state, enabled };
  notify();
}

/** 测试用:重置缓冲 + 启用状态。 */
export function resetErrorReporter(): void {
  state = { buffer: [], enabled: true };
}

/** PII scrub:任何包含 "@" 的字符串(疑似邮箱)被替换成 "<email>"。 */
function sanitizeContext(ctx: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "string" && /@/.test(v)) {
      out[k] = "<redacted>";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** ErrorBoundary componentDidCatch 帮手 — 把 React ErrorInfo 压成扁平 context。 */
export function reactErrorToContext(info: ErrorInfo): ReportedError["context"] {
  return {
    componentStack: info.componentStack?.split("\n").slice(0, 8).join("\n") ?? undefined,
  } as Record<string, string | number | boolean | null>;
}


/** React hook — 订阅 errorReporter,返回最近 N 条错误(稳定引用避免 re-render 循环)。 */
export function useErrorRecent(limit = 20): ReadonlyArray<ReportedError> {
  return useSyncExternalStore(
    subscribe,
    () => state.buffer,
    () => [],
  ).slice(-limit);
}
