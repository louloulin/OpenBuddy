/**
 * session-tree.ts — read-only session tree projection for the UI.
 *
 * Phase 4 (补底层 API): BranchNavigator (阶段 5) needs a session tree to render
 * conversation forks. The canonical tree already lives in pi's `SessionManager`
 * (`getTree()` returns `SessionTreeNode[]`). Rather than re-implement tree
 * traversal, this module **reuses** pi's tree and projects it into a
 * UI-friendly, serializable shape:
 *
 *   { id, parentId, branch, summary, createdAt, children }
 *
 * The projection is pure data — no React, no store reads, no I/O. It is safe to
 * serialize across the IPC boundary to the renderer.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry, SessionManager, SessionTreeNode } from "@earendil-works/pi-coding-agent";

export type { SessionTreeNode } from "@earendil-works/pi-coding-agent";

/** UI-facing branch kind, derived from the underlying pi entry type. */
export type SessionTreeBranchKind =
  | "message"
  | "compaction"
  | "branch_summary"
  | "model_change"
  | "thinking_level_change"
  | "custom"
  | "custom_message"
  | "label"
  | "session_info"
  | "other";

/** UI-facing, serializable session tree node. */
export interface SessionTreeBranch {
  id: string;
  parentId: string | null;
  branch: SessionTreeBranchKind;
  /** Human-readable summary (branch_summary/compaction summary, or truncated message text). */
  summary?: string;
  createdAt: string;
  children: SessionTreeBranch[];
}

/** Map a pi entry type to a UI-facing branch kind. */
export function branchKindOf(entry: SessionEntry): SessionTreeBranchKind {
  switch (entry.type) {
    case "message":
      return "message";
    case "compaction":
      return "compaction";
    case "branch_summary":
      return "branch_summary";
    case "model_change":
      return "model_change";
    case "thinking_level_change":
      return "thinking_level_change";
    case "custom":
      return "custom";
    case "custom_message":
      return "custom_message";
    case "label":
      return "label";
    case "session_info":
      return "session_info";
    default:
      return "other";
  }
}

const SUMMARY_CAP = 200;

/** Extract a short human-readable summary from a pi entry, if any. */
export function entrySummary(entry: SessionEntry): string | undefined {
  switch (entry.type) {
    case "branch_summary":
    case "compaction":
      return entry.summary ? truncate(entry.summary, SUMMARY_CAP) : undefined;
    case "session_info":
      return entry.name ? truncate(entry.name, SUMMARY_CAP) : undefined;
    case "label":
      return entry.label ? truncate(entry.label, SUMMARY_CAP) : undefined;
    case "message": {
      const text = messageText(entry.message);
      return text ? truncate(text, SUMMARY_CAP) : undefined;
    }
    default:
      return undefined;
  }
}

function messageText(message: AgentMessage | unknown): string | undefined {
  // Discriminated union narrowing: only UserMessage / AssistantMessage / ToolResultMessage
  // (and similar LLM-shaped messages) carry a `content` field. Custom types such as
  // BashExecutionMessage do not — return undefined for those.
  if (!message || typeof message !== "object" || !("content" in message)) return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") parts.push(text);
      }
    }
    return parts.join(" ") || undefined;
  }
  return undefined;
}

function truncate(value: string, cap: number): string {
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}…`;
}

function projectNode(node: SessionTreeNode): SessionTreeBranch {
  return {
    id: node.entry.id,
    parentId: node.entry.parentId,
    branch: branchKindOf(node.entry),
    summary: entrySummary(node.entry),
    createdAt: node.entry.timestamp,
    children: node.children.map(projectNode),
  };
}

/**
 * Project a pi `SessionManager`'s session tree into the UI-facing shape.
 * Reuses pi's `getTree()` traversal; this function only maps node shapes.
 */
export function sessionTree(manager: SessionManager): SessionTreeBranch[] {
  return manager.getTree().map(projectNode);
}
