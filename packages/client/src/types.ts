// Client-side wire types that are not in @openbuddy/protocol/dto yet.
// QuestionRequest / UiDismissReason are the agent://ui-request and agent://ui-dismiss payloads; they used to live in
// apps/web/src/features/approvals/state/question-store.ts, which made the client import the web layer.
export interface QuestionRequest {
  requestId: string;
  sessionId: string;
  kind: "select" | "confirm" | "input" | "editor";
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  initialValue?: string;
  /** Reserved for a future extension source; Pi's input API currently has no secret option. */
  secret?: boolean;
  timeoutMs?: number;
  expiresAt?: number;
}
export type UiDismissReason = "resolved" | "cancelled" | "timeout" | "aborted" | "session_closed";

// The transport seam, re-exported (type-only) so consumers such as the chat-core use cases (R7) can type against
// @openbuddy/client/types without importing the implementations.
export type { Transport, TransportState } from "./transport";
