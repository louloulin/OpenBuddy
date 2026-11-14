import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Settings } from "@openbuddy/services/settings/settings";
export type Emit = (event: string, payload: unknown) => void;
type Reason = "resolved" | "cancelled" | "timeout";
type Decision = { allow: boolean; note?: string };
/** Commands / tools that delete files: the approval card asks harder (20261115-ui §5.4). */
export function destructiveInfo(toolName: string, input: unknown): { command?: string; paths?: string[] } | undefined {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (/delete|remove/i.test(toolName)) {
    const path = typeof value.path === "string" ? value.path : undefined;
    return { paths: path ? [path] : [] };
  }
  if (toolName !== "bash" || typeof value.command !== "string") return undefined;
  const command = value.command;
  const match = command.match(/(?:^|[;&|]\s*|\s)(rm|rmdir|unlink|del|Remove-Item)\s+([^;&|]*)/);
  if (!match) return undefined;
  const paths = match[2].split(/\s+/).filter((part) => part && !part.startsWith("-")).slice(0, 20);
  return { command, paths };
}
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
    { sessionId: string; toolName: string; input: unknown; finish: (allow: boolean, reason: Reason, note?: string) => void }
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
        const decision = await this.decision(
          sessionId,
          event.toolCallId,
          event.toolName,
          event.input,
        );
        if (decision.allow) return undefined;
        // A reason from the user lets the agent try another way instead of retrying the same call.
        return { block: true, reason: decision.note ? `用户拒绝：${decision.note}` : "用户拒绝或权限请求已取消" };
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
  async request(sessionId: string, toolCallId: string, toolName: string, input: unknown): Promise<boolean> {
    return (await this.decision(sessionId, toolCallId, toolName, input)).allow;
  }
  async decision(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
  ): Promise<Decision> {
    const decided = this.decide(sessionId, toolName, input);
    if (decided !== undefined) return { allow: decided };
    const requestId = randomUUID();
    const destructive = destructiveInfo(toolName, input);
    return new Promise((resolve) => {
      const timer = this.timeoutMs > 0 ? setTimeout(() => finish(false, "timeout"), this.timeoutMs) : undefined;
      timer?.unref?.();
      const finish = (allow: boolean, reason: Reason, note?: string) => {
        if (!this.pending.has(requestId)) return;
        if (timer) clearTimeout(timer);
        this.pending.delete(requestId);
        this.emit("agent://permission-dismiss", { requestId, sessionId, reason, allowed: allow });
        resolve({ allow, ...(note ? { note } : {}) });
      };
      this.pending.set(requestId, { sessionId, toolName, input, finish });
      this.emit("agent://permission", {
        requestId,
        sessionId,
        toolCallId,
        toolKind: toolName,
        title: toolName,
        rawInput: input,
        ...(destructive ? { destructive } : {}),
        options: [
          { optionId: "allow", kind: "allow_once", title: "允许本次" },
          { optionId: "allow_session", kind: "allow_always", title: "本任务允许" },
          ...(destructive ? [] : [{ optionId: "allow_always", kind: "allow_always", title: "始终允许" }]),
          { optionId: "deny", kind: "reject_once", title: "拒绝" },
        ],
      });
    });
  }
  resolve(id: string, optionId: unknown, cancelled: unknown, reason?: unknown) {
    const pending = this.pending.get(id);
    if (!pending) throw Error("权限请求不存在或已过期");
    if (!cancelled && !["allow", "allow_session", "allow_always", "deny"].includes(String(optionId)))
      throw Error("无效的权限选项");
    if (!cancelled && optionId === "allow_session") {
      const tools = this.sessionAllow.get(pending.sessionId) ?? new Set<string>();
      tools.add(pending.toolName);
      this.sessionAllow.set(pending.sessionId, tools);
    }
    if (!cancelled && optionId === "allow_always") {
      // 始终允许: an allow rule for this tool + subject, editable in 设置·安全中心.
      const config = this.settings.config.read();
      const rule = { action: "allow", tool: pending.toolName, pattern: subject(pending.toolName, pending.input) };
      if (!config.rules.some((r) => r.action === rule.action && r.tool === rule.tool && r.pattern === rule.pattern))
        this.settings.config.write({ ...config, rules: [...config.rules, rule] });
    }
    const note = !cancelled && optionId === "deny" && typeof reason === "string" ? reason.trim().slice(0, 500) : undefined;
    pending.finish(!cancelled && optionId !== "deny", cancelled ? "cancelled" : "resolved", note || undefined);
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
