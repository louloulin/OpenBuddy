/**
 * push-provider-error-toast.ts — 集中处理"邮箱 provider 不可用/受限"的 toast UX。
 *
 * 模块级函数,无 React deps,可被 EmailPanel / ConnectorsTab / SettingsPanel
 * 共享。它解决的问题:
 *
 * 1) 不同面板各自拼 toast 文案 + dedup id,会出现重复 toast 占满队列。
 *    这里强制使用稳定 id(以 "email:" 为前缀),同 code 5s 内自动刷新覆盖。
 *
 * 2) 不同面板对 "provider_unavailable" 的恢复动作不一致。
 *    统一为:
 *      - 有 sessionId: 「停止 AI」按钮(调 piCancel)
 *      - 否则:         「打开连接器」按钮(onNavigate)
 *
 * 3) EmailError.code 在 IPC wrap 过程中曾被 invoke() 静默丢弃,
 *    导致 code === "provider_unavailable" 分支永远不命中 ——
 *    fix 后(R7.2) code 正常透传;这里按 code 分桶,新增
 *    `rate_limited / network_error / token_expired` 三类 UX。
 */
import { setToast } from "@/stores/toast-store";

export type ProviderErrorCode =
  | "provider_unavailable"
  | "rate_limited"
  | "network_error"
  | "token_expired"
  | "operation_failed"
  | "operation_not_supported"
  | "invalid_input"
  | "idempotency_conflict"
  | "confirmation_required"
  | string;

export interface PushProviderErrorToastInput {
  message: string;
  code?: ProviderErrorCode;
  /** sessionId 存在时显示「停止 AI」,否则显示「打开连接器」。 */
  sessionId?: string;
  /** 用于"打开连接器"按钮的 onClick。如果不传,按钮点击会调 onNavigate("连接器中心 → 邮箱")。 */
  onNavigate?: (label: string) => void;
  /** 内部用于把消息叠加到 onToast(老 API)的回调;新代码可不传。 */
  onToast?: (message: string) => void;
  /** piCancel — 由调用方注入,避免 push 助手依赖 agent 包。 */
  cancelAi?: (sessionId: string) => void;
}

const NAVIGATE_TO_CONNECTORS = "请前往「专家·技能·连接器」授权邮箱 MCP";

export function pushProviderErrorToast(input: PushProviderErrorToastInput): void {
  const { message, code, sessionId, onNavigate, onToast, cancelAi } = input;

  // 1) provider_unavailable: 终结态。8s TTL + 强动作按钮(默认行为)。
  if (code === "provider_unavailable") {
    const openConnectors = {
      label: "打开连接器",
      onClick: () => {
        if (onNavigate) onNavigate("专家·技能·连接器");
        onToast?.(NAVIGATE_TO_CONNECTORS);
      },
    };
    setToast(message, {
      kind: "error",
      id: "email:provider-unavailable",
      ttlMs: 8_000,
      action: sessionId && cancelAi
        ? { label: "停止 AI", hint: "Esc", onClick: () => cancelAi(sessionId) }
        : openConnectors,
    });
    return;
  }

  // 2) rate_limited: 用户能等。auto-dismiss 之前提示「稍后重试」。
  if (code === "rate_limited") {
    setToast(message, {
      kind: "warning",
      id: "email:rate-limited",
      ttlMs: 5_000,
      action: { label: "稍后重试", onClick: () => onToast?.("已记录;稍后再试") },
    });
    return;
  }

  // 3) network_error: 瞬时错误,5s 警告 +「重试」按钮。
  if (code === "network_error") {
    setToast(message, {
      kind: "warning",
      id: "email:network-error",
      ttlMs: 5_000,
      action: { label: "重试", onClick: () => onToast?.("已触发重试") },
    });
    return;
  }

  // 4) token_expired: 持久 toast(ttlMs: 0 — 仅本模块允许),需要重新授权。
  if (code === "token_expired") {
    const reauthorize = {
      label: "重新授权",
      onClick: () => {
        if (onNavigate) onNavigate("专家·技能·连接器");
        onToast?.("请完成邮箱重新授权");
      },
    };
    setToast(message, {
      kind: "error",
      id: "p:email:token-expired",
      ttlMs: 0,
      action: reauthorize,
    });
    return;
  }

  // 5) invalid_input / operation_failed: 5s 错误 toast,无动作。
  if (code === "invalid_input" || code === "operation_failed") {
    setToast(message, { kind: "error", id: `email:${code}`, ttlMs: 5_000 });
    return;
  }

  // 6) operation_not_supported: 警告 + 5s,提示用户检查连接器声明的能力。
  if (code === "operation_not_supported") {
    setToast(message, { kind: "warning", id: "email:op-not-supported", ttlMs: 5_000 });
    return;
  }

  // 7) idempotency_conflict: 静默成功替代 — 提示 3s 后自动消失。
  if (code === "idempotency_conflict") {
    setToast(message, { kind: "info", id: "email:idempotency", ttlMs: 3_000 });
    return;
  }

  // 8) 兜底:走 onToast 老 API,避免破坏现有调用方。
  onToast?.(message);
}

/**
 * EmailError code → toast UX 映射。完整表见 `specs/email/spec.md §5.1`。
 * 与 pushProviderErrorToast 共享同一份 code 集合,防止漂移。
 */
export const PROVIDER_ERROR_TOAST_TABLE = {
  provider_unavailable: { kind: "error" as const, ttlMs: 8_000, actionLabel: "打开连接器" },
  rate_limited: { kind: "warning" as const, ttlMs: 5_000, actionLabel: "稍后重试" },
  network_error: { kind: "warning" as const, ttlMs: 5_000, actionLabel: "重试" },
  token_expired: { kind: "error" as const, ttlMs: 0, actionLabel: "重新授权" },
  invalid_input: { kind: "error" as const, ttlMs: 5_000, actionLabel: undefined },
  operation_failed: { kind: "error" as const, ttlMs: 5_000, actionLabel: undefined },
  operation_not_supported: { kind: "warning" as const, ttlMs: 5_000, actionLabel: undefined },
  idempotency_conflict: { kind: "info" as const, ttlMs: 3_000, actionLabel: undefined },
};
