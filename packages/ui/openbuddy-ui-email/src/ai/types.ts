/**
 * AI 邮件功能闭环类型契约。
 *
 * 设计目标:在 UI 层用统一的"状态机"表达 AI 行动闭环,让组件无需各自维护
 * `loading / success / error` 三态。所有 hook 返回 `AsyncPhase<T>`,
 * 状态变更可观察、可重试、可撤销。
 *
 * 闭环:Observe → Plan → Confirm → Execute → (Receipt + Undo)
 */

export type AsyncPhaseIdle = { status: "idle" };
export type AsyncPhaseLoading = { status: "loading" };
export type AsyncPhaseReady<T> = { status: "ready"; value: T };
export type AsyncPhaseError = { status: "error"; error: string };
export type AsyncPhase<T> =
  | AsyncPhaseIdle
  | AsyncPhaseLoading
  | AsyncPhaseReady<T>
  | AsyncPhaseError;

export function phaseIdle<T>(): AsyncPhase<T> { return { status: "idle" }; }
export function phaseLoading<T>(): AsyncPhase<T> { return { status: "loading" }; }
export function phaseReady<T>(value: T): AsyncPhase<T> { return { status: "ready", value }; }
export function phaseError<T>(error: string): AsyncPhase<T> { return { status: "error", error }; }

export function phaseIsLoading<T>(phase: AsyncPhase<T>): phase is AsyncPhaseLoading {
  return phase.status === "loading";
}
export function phaseIsReady<T>(phase: AsyncPhase<T>): phase is AsyncPhaseReady<T> {
  return phase.status === "ready";
}
export function phaseIsError<T>(phase: AsyncPhase<T>): phase is AsyncPhaseError {
  return phase.status === "error";
}

/**
 * AI 行动原子。一封邮件一个动作,便于"全部执行 / 部分驳回"。
 *
 * `kind` 限定 6 种最常用动作,扩展在 email 侧执行层处理;
 * `confidence` ∈ [0,1] 决定默认勾选状态。
 */
export type AiActionKind =
  | "archive"
  | "label"
  | "snooze"
  | "mark-read"
  | "reply-draft"
  | "create-task";

export interface AiAction {
  id: string;
  kind: AiActionKind;
  threadId: string;
  /** 邮件 messageId,用于回执时引用证据。 */
  messageId?: string;
  label?: string;
  snoozeUntil?: string;
  draftId?: string;
  taskTitle?: string;
  taskDueAt?: string;
  /** 0-1,低于 0.6 默认不勾选,需要用户手动选。 */
  confidence: number;
  /** AI 一句话理由,展示给用户。 */
  reason: string;
}

/** 用户对单条 action 的处置。 */
export type AiActionDecision = "accepted" | "rejected" | "pending";

export interface AiActionReceipt {
  actionId: string;
  threadId: string;
  kind: AiActionKind;
  status: "executed" | "skipped" | "failed";
  reason?: string;
  /** 关联的 label / snoozeUntil — 撤销时需要。 */
  label?: string;
  snoozeUntil?: string;
}

/** 一个 AI 计划覆盖一组 action。 */
export interface AiActionPlan {
  id: string;
  /** 自然语言描述:"归档本周 GitHub CI 通知" */
  prompt: string;
  createdAt: string;
  /** 计划阶段的整体状态 — 闭环状态机的根节点。 */
  phase: AsyncPhase<{
    accepted: AiAction[];
    receipts: AiActionReceipt[];
  }>;
}

/**
 * AI 回复建议。三选一是顶级邮件产品(Gmail Gemini / Outlook Copilot)的标配。
 */
export interface AiReplySuggestion {
  id: string;
  tone: "concise" | "inquisitive" | "delegate";
  subject: string;
  body: string;
  /** 是否需要附议会议。 */
  suggestsMeeting?: boolean;
  confidence: number;
  reason: string;
}

/** AI 摘要,自动出现在打开邮件后。 */
export interface AiThreadSummary {
  threadId: string;
  oneLiner: string;
  keyPoints: string[];
  actionItems: Array<{ content: string; owner?: string; dueAt?: string; sourceMessageId?: string }>;
  meetingProposal?: { title: string; start: string; end: string; attendees?: string[] };
  confidence: number;
  citations: Array<{ messageId: string; quote?: string }>;
  /** 模型版本/签名,便于追溯与回放。 */
  generatedAt: string;
  signature?: string;
}

/** 闭环可撤销 action 记录,30s 窗口。 */
export interface UndoEntry {
  id: string;
  planId: string;
  receipts: AiActionReceipt[];
  /** 触发时刻,30s 后自动过期。 */
  createdAt: number;
  /** 撤销回调。 */
  undo: () => Promise<void>;
}
