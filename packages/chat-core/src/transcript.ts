/**
 * Transcript data model: messages, parts and tool calls as the chat UI renders them.
 * Moved verbatim from apps/web/src/features/chat/state/session-store.ts (20261115-md R7);
 * the store re-exports these types for its existing importers.
 */
import type { Plan, ToolCallContent } from "@openbuddy/protocol/dto";

export interface MessageMeta {
  /** Engine timestamp (ms) of the message; local clock for optimistic ones. */
  timestamp?: number;
  /** Local time the message finished (live turns only). */
  endedAt?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  /** User message chips. */
  attachments?: string[];
  skill?: string;
  /** 想一想 / 问一问 prompt. */
  mode?: "plan" | "ask";
  expert?: string;
  images?: Array<{ data: string; mimeType: string }>;
  /** Optimistic user message not yet echoed by the engine. */
  pending?: boolean;
  /** Non-chat history entries rendered as dividers. */
  notice?: "compaction" | "branch" | "custom" | "bash";
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "notice";
  parts: MessagePart[];
  complete: boolean;
  meta?: MessageMeta;
}
export type MessagePart =
  | { kind: "text"; text: string; contentIndex?: number }
  | { kind: "thought"; text: string; contentIndex?: number }
  | { kind: "tool_call"; toolCall: ToolCallView; contentIndex?: number };
export interface ToolCallView {
  toolCallId: string; title: string; kind: string;
  status: "in_progress" | "completed" | "failed";
  content: ToolCallContent[]; rawInput?: unknown;
  /** Tool-specific result details (edit diff/patch, bash truncation). */
  details?: unknown;
  durationMs?: number;
  startedAt?: number;
  /** Argument text streamed so far (large writes show progress before they run). */
  argBytes?: number;
}
export interface Usage { promptTokens?: number; completionTokens?: number; totalTokens?: number }
export interface RetryState { attempt: number; maxAttempts: number; delayMs: number; errorMessage?: string; startedAt: number }
export interface SessionTranscript {
  messages: ChatMessage[]; streamingMessageId: string | null; busy: boolean;
  usage: Usage; plan: Plan | null; error: string | null;
  retry: RetryState | null; compacting: string | null;
  /** Local time the current turn started. */
  turnStartedAt: number | null;
}
