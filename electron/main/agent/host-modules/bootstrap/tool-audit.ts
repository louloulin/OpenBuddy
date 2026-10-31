/**
 * Tool-call audit — every tool the agent runs leaves one entry in the local
 * audit trail (tool name, outcome, duration, args hash), so the audit center
 * shows what the agent actually did, not just settings changes.
 *
 * Args are hashed, never stored: they can carry file contents or secrets.
 */
import { createHash } from "node:crypto";

export type ToolAuditEntry = {
  event: "tool.call";
  outcome: "success" | "failure";
  source: "main";
  subject: string;
  detail: { sessionId: string; toolCallId: string; durationMs: number; argsHash: string };
};

type Recorder = (entry: ToolAuditEntry) => Promise<unknown>;

const defaultRecorder: Recorder = async (entry) => {
  const { auditTrail } = await import("../../../audit/audit-log");
  return auditTrail.record(entry);
};

export function hashToolArgs(args: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(args ?? null) ?? "null";
  } catch {
    text = String(args);
  }
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function createToolAudit(record: Recorder = defaultRecorder, now: () => number = Date.now) {
  const started = new Map<string, { toolName: string; sessionId: string; startedAt: number; argsHash: string }>();
  return {
    start(toolCallId: string, toolName: string, sessionId: string, args: unknown): void {
      started.set(toolCallId, { toolName, sessionId, startedAt: now(), argsHash: hashToolArgs(args) });
    },
    end(toolCallId: string, isError: boolean): void {
      const run = started.get(toolCallId);
      if (!run) return;
      started.delete(toolCallId);
      // Auditing must never break the run it observes.
      void record({
        event: "tool.call",
        outcome: isError ? "failure" : "success",
        source: "main",
        subject: run.toolName,
        detail: {
          sessionId: run.sessionId,
          toolCallId,
          durationMs: Math.max(0, now() - run.startedAt),
          argsHash: run.argsHash,
        },
      }).catch(() => undefined);
    },
  };
}

export const toolAudit = createToolAudit();
