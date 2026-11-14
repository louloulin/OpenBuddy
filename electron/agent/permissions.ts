import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Settings } from "../services/settings.js";
export type Emit = (event: string, payload: unknown) => void;
type Reason = "resolved" | "cancelled" | "timeout";
const READ_ONLY = ["read", "grep", "find", "ls"];
/** The input field a rule pattern is matched against, per tool. */
function subject(toolName: string, input: unknown): string {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const field = toolName === "bash" ? value.command : value.path ?? value.pattern;
  return typeof field === "string" ? field : JSON.stringify(input ?? "");
}
export class Permissions {
  private pending = new Map<
    string,
    { sessionId: string; toolName: string; finish: (allow: boolean, reason: Reason) => void }
  >();
  /** Tools the user allowed for the rest of a session ("本会话允许"). */
  private sessionAllow = new Map<string, Set<string>>();
  constructor(
    private settings: Settings,
    private emit: Emit,
    /** 0 disables the timeout: an unanswered request waits until answered or cancelled. */
    private timeoutMs = 0,
  ) {}
  extension(sessionId: string): ExtensionFactory {
    return (pi) => {
      pi.on("tool_call", async (event) => {
        const allowed = await this.request(
          sessionId,
          event.toolCallId,
          event.toolName,
          event.input,
        );
        return allowed
          ? undefined
          : { block: true, reason: "用户拒绝或权限请求已取消" };
      });
    };
  }
  /** Whether a rule, mode or session grant decides the call without asking. */
  decide(sessionId: string, toolName: string, input: unknown): boolean | undefined {
    const config = this.settings.config.read();
    const target = subject(toolName, input);
    const rule = config.rules.find(
      (r) =>
        (r.tool === "any" ||
          r.tool === toolName ||
          (r.tool === "mcp" && toolName.startsWith("mcp__"))) &&
        (!r.pattern || target.includes(r.pattern)),
    );
    if (rule?.action === "deny") return false;
    if (rule?.action === "allow" || config.permissionMode === "always-approve")
      return true;
    if (this.sessionAllow.get(sessionId)?.has(toolName)) return true;
    if (config.permissionMode === "auto" && READ_ONLY.includes(toolName))
      return true;
    return undefined;
  }
  async request(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
  ): Promise<boolean> {
    const decided = this.decide(sessionId, toolName, input);
    if (decided !== undefined) return decided;
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = this.timeoutMs > 0 ? setTimeout(() => finish(false, "timeout"), this.timeoutMs) : undefined;
      timer?.unref?.();
      const finish = (allow: boolean, reason: Reason) => {
        if (!this.pending.has(requestId)) return;
        if (timer) clearTimeout(timer);
        this.pending.delete(requestId);
        this.emit("agent://permission-dismiss", { requestId, sessionId, reason, allowed: allow });
        resolve(allow);
      };
      this.pending.set(requestId, { sessionId, toolName, finish });
      this.emit("agent://permission", {
        requestId,
        sessionId,
        toolCallId,
        toolKind: toolName,
        title: toolName,
        rawInput: input,
        options: [
          { optionId: "allow", kind: "allow_once", title: "允许本次" },
          { optionId: "allow_session", kind: "allow_always", title: "本会话允许" },
          { optionId: "deny", kind: "reject_once", title: "拒绝" },
        ],
      });
    });
  }
  resolve(id: string, optionId: unknown, cancelled: unknown) {
    const pending = this.pending.get(id);
    if (!pending) throw Error("权限请求不存在或已过期");
    if (!cancelled && !["allow", "allow_session", "deny"].includes(String(optionId)))
      throw Error("无效的权限选项");
    if (!cancelled && optionId === "allow_session") {
      const tools = this.sessionAllow.get(pending.sessionId) ?? new Set<string>();
      tools.add(pending.toolName);
      this.sessionAllow.set(pending.sessionId, tools);
    }
    pending.finish(!cancelled && optionId !== "deny", cancelled ? "cancelled" : "resolved");
  }
  hasPending(sessionId: string) {
    for (const item of this.pending.values()) if (item.sessionId === sessionId) return true;
    return false;
  }
  cancel(sessionId?: string) {
    for (const item of [...this.pending.values()])
      if (!sessionId || item.sessionId === sessionId) item.finish(false, "cancelled");
  }
  /** Forget per-session grants when a session is deleted. */
  forget(sessionId: string) {
    this.sessionAllow.delete(sessionId);
  }
}
