import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** 做一做 / 想一想 / 问一问 (20261115-ui §5.8): plan and ask only get read-only tools. */
export type AgentMode = "craft" | "plan" | "ask";
/**
 * Read-only tools kept in 想一想 / 问一问: `ob_todo` records the plan (W3.1); `ob_remember`
 * writes a memory note the user confirms at the permission gate (W5.3), so ask mode keeps it
 * available but never silently approved.
 */
export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "ob_todo", "ob_remember"];
export type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];
export function validateThinkingLevel(value: unknown): ThinkingLevel {
  if (
    typeof value !== "string" ||
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value)
  )
    throw Error("invalid_thinking_level");
  return value as ThinkingLevel;
}
export type PromptImages = NonNullable<
  Parameters<AgentSession["prompt"]>[1]
>["images"];
/** One pending steering / follow-up prompt (排队图片保留, pii W1.8). */
export interface QueueItem {
  text: string;
  images?: PromptImages;
}

/**
 * How per-branch state (mode, bound expert) follows a move of the session leaf (20261116-pii §5):
 * `restore` (switching versions ‹1/2›) applies the target branch's own state; `keep` (重新生成,
 * 从这里编辑) keeps what the user has selected now and writes it onto the new branch.
 */
export type TreeMove = "restore" | "keep";

/** Renderer-visible lifecycle of one pooled session. */
export type SessionRunStatus = "running" | "idle" | "failed";

export interface Slot {
  /** Streaming tool-call arguments per content index (summarized for the renderer). */
  toolArgs?: Map<number, { bytes: number; head: string; at: number }>;
  /** Text/thinking delta waiting to be merged with the next ones (see emitEvent). */
  pendingDelta?: { type: string; contentIndex?: number; delta: string; timer?: ReturnType<typeof setTimeout> };
  lastDeltaAt?: number;
  /** Tool set the session was created with (restored by 做一做). */
  defaultTools: string[];
  id: string;
  session: AgentSession;
  unsubscribe: () => void;
  busy: boolean;
  generation: number;
  cancelledGeneration: number;
  commandError?: string;
  /** Configuration changed while running; rebuild once settled. */
  stale: boolean;
  lastActive: number;
  finalError?: string;
  failed: boolean;
  /** A `!command` is running (W1.2): the slot is never evicted and a reload waits until it ends. */
  userBash?: boolean;
  /** Set while the engine moves the leaf, until the branch state has followed (features/branch-state.ts). */
  tree?: { move: TreeMove; oldLeafId: string | null };
  /**
   * 子代理 (pii W3.4): the session that spawned this one with `ob_subagent`. A child's approvals
   * are tagged with it, its usage is attributed to it, and stopping the parent cascades down.
   */
  parentId?: string;
  /** 快速问答 (G1-31): a throwaway session. It is never a task: it stays out of the sidebar and out of the running list. */
  hidden?: boolean;
  /** The expert / label the child was spawned as (shown on its approval and subagent card). */
  agentName?: string;
  /** Never evicted while its parent runs; an in-memory child is closed with the parent anyway. */
  subagent?: boolean;
  /** 后台任务视图 (pii W4.5): when the current turn started, for 用时. */
  busySince?: number;
  /** 自动化 (pii W4.2/W4.5): the task that opened this background session, shown in 运行中. */
  automation?: { id: string; name: string };
}

export interface PoolLimits {
  /** Sessions kept alive (idle ones are evicted LRU beyond this). */
  maxLive: number;
  /** Sessions allowed to run a turn at the same time. */
  maxRunning: number;
  /** Idle time after which an unfocused, idle session is closed. */
  idleMs: number;
}
