import type { AgentSession } from "@earendil-works/pi-coding-agent";

/** 做一做 / 想一想 / 问一问 (20261115-ui §5.8): plan and ask only get read-only tools. */
export type AgentMode = "craft" | "plan" | "ask";
/** `ob_todo` only records the session's plan (pii W3.1): 想一想 needs it to write the steps down. */
export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "ob_todo"];
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
}

export interface PoolLimits {
  /** Sessions kept alive (idle ones are evicted LRU beyond this). */
  maxLive: number;
  /** Sessions allowed to run a turn at the same time. */
  maxRunning: number;
  /** Idle time after which an unfocused, idle session is closed. */
  idleMs: number;
}
