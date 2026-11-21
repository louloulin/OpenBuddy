import { randomUUID } from "node:crypto";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PROTECTED_PATHS, type Settings } from "@openbuddy/services/settings/settings";
import type { Emit } from "@openbuddy/kernel";
import { assessCommand } from "./command-risk.js";
// The event port moved to @openbuddy/kernel (20261115-md R2); re-exported for existing importers.
export type { Emit };
type Reason = "resolved" | "cancelled" | "timeout";
type Decision = { allow: boolean; note?: string; kind?: "user" | "protected" };
/** The `agent://permission` payload; `permission_pending` returns these verbatim so a reconnecting client sees the same card. */
export type PermissionRequestPayload = {
  requestId: string;
  sessionId: string;
  toolCallId: string;
  subagent?: { parentId: string; name?: string };
  toolKind: string;
  title: string;
  rawInput?: unknown;
  destructive?: { command?: string; paths?: string[] };
  options: { optionId: string; kind: string; title: string }[];
};

/** Tools that mutate a path; the protected-path guard only applies to these. */
const MUTATING_TOOL = (toolName: string) =>
  toolName === "write" || toolName === "edit" || /delete|remove/i.test(toolName) || /^ob_(docx|xlsx|pptx)$/.test(toolName);

/**
 * 受保护路径 (pii W6.2): the first pattern matching a write/edit/delete target, or undefined.
 * `*.x` matches a basename suffix, `.name` a basename prefix (`.env` covers `.env.local`),
 * a pattern with `/` a path substring, and a bare short name a path segment.
 */
export function protectedPathOf(patterns: readonly string[], toolName: string, input: unknown): string | undefined {
  if (!MUTATING_TOOL(toolName)) return undefined;
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const target = typeof value.path === "string" ? value.path : undefined;
  if (!target) return undefined;
  const segments = target.split(/[\\/]/).filter(Boolean);
  const base = segments.at(-1) ?? target;
  for (const raw of patterns) {
    const pattern = raw.trim();
    if (!pattern) continue;
    if (pattern.startsWith("*.")) {
      if (base.endsWith(pattern.slice(1))) return pattern;
      continue;
    }
    if (pattern.endsWith("*")) {
      if (base.startsWith(pattern.slice(0, -1))) return pattern;
      continue;
    }
    if (pattern.includes("/")) {
      if (target.includes(pattern)) return pattern;
      continue;
    }
    if (base === pattern || (pattern.startsWith(".") && base.startsWith(pattern)) || segments.includes(pattern)) return pattern;
  }
  return undefined;
}
/**
 * Commands / tools that delete files: the approval card asks harder (20261115-ui §5.4). Shell
 * commands are read by the main process's own classifier (command-risk.ts).
 */
export function destructiveInfo(toolName: string, input: unknown): { command?: string; paths?: string[] } | undefined {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (/delete|remove/i.test(toolName)) {
    const path = typeof value.path === "string" ? value.path : undefined;
    return { paths: path ? [path] : [] };
  }
  if (toolName !== "bash" || typeof value.command !== "string") return undefined;
  const { deletes } = assessCommand(value.command);
  return deletes ? { command: value.command, paths: deletes } : undefined;
}
const READ_ONLY = ["read", "grep", "find", "ls"];
/**
 * Built-in tools whose only effect is session bookkeeping (`ob_todo` writes the plan into its
 * own result): allowed in every mode unless a deny rule matches — but only when the session's
 * tool of that name is the enabled built-in itself (`builtinTool`). They still pass this gate.
 */
export const SESSION_ONLY_TOOLS = ["ob_todo"];
/** The input field a rule pattern is matched against, per tool. */
function subject(toolName: string, input: unknown): string {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const field = toolName === "bash" ? value.command : value.path ?? value.pattern;
  return typeof field === "string" ? field : JSON.stringify(input ?? "");
}
export class Permissions {
  private pending = new Map<
    string,
    {
      sessionId: string;
      toolName: string;
      input: unknown;
      finish: (allow: boolean, reason: Reason, note?: string) => void;
      userCommand?: boolean;
      /** The exact payload emitted as `agent://permission`, so a reconnecting client can rebuild the card. */
      request: PermissionRequestPayload;
    }
  >();
  /** Tools the user allowed for the rest of a session ("本会话允许"). */
  private sessionAllow = new Map<string, Set<string>>();
  /** 自动化 (W4.2): sessions configured for 完全访问 run unattended; deny rules still win. */
  private sessionAll = new Set<string>();
  constructor(
    private settings: Settings,
    private emit: Emit,
    /** 0 disables the timeout: an unanswered request waits until answered or cancelled. */
    private timeoutMs = 0,
    /** Whether the session's tool of that name is the enabled built-in's own (not a look-alike). */
    private builtinTool: (sessionId: string, toolName: string) => boolean = () => false,
    /** 子代理 (W3.4): the parent of a child session, so its approvals can say 来自子代理 X. */
    private subagentOf: (sessionId: string) => { parentId: string; name?: string } | undefined = () => undefined,
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
        // A reason lets the agent try another way instead of retrying the same call.
        if (decision.kind === "protected") return { block: true, reason: decision.note };
        return { block: true, reason: decision.note ? `用户拒绝：${decision.note}` : "用户拒绝或权限请求已取消" };
      });
    };
  }
  /** Whether a rule, mode or session grant decides the call without asking. */
  decide(sessionId: string, toolName: string, input: unknown): boolean | undefined {
    const config = this.settings.config.read();
    const rule = this.rule(toolName, input);
    if (rule?.action === "deny") return false;
    if (this.sessionAll.has(sessionId) || rule?.action === "allow" || config.permissionMode === "always-approve")
      return true;
    if (SESSION_ONLY_TOOLS.includes(toolName) && this.builtinTool(sessionId, toolName)) return true;
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
    // 受保护路径 (W6.2/W6.4): a hard boundary — allow rules, always-approve and a full-access
    // automation grant do not bypass it. The model gets a reason it can act on.
    const guard = protectedPathOf(
      this.settings.config.read().protectedPaths ?? DEFAULT_PROTECTED_PATHS,
      toolName,
      input,
    );
    if (guard)
      return {
        allow: false,
        kind: "protected",
        note: `受保护路径（${guard}）：写入被拒绝。可在 设置 · 安全中心 调整受保护路径。`,
      };
    const decided = this.decide(sessionId, toolName, input);
    if (decided !== undefined) return { allow: decided };
    return this.ask(sessionId, toolCallId, toolName, input, destructiveInfo(toolName, input));
  }
  /** The first rule matching this call (rules are checked in order). */
  private rule(toolName: string, input: unknown) {
    const target = subject(toolName, input);
    return this.settings.config.read().rules.find(
      (r) =>
        (r.tool === "any" ||
          r.tool === toolName ||
          (r.tool === "mcp" && toolName.startsWith("mcp__"))) &&
        (!r.pattern || target.includes(r.pattern)),
    );
  }
  /**
   * A command the user typed in the composer (`!cmd`, 20261116-pii W1.2). Deny rules still apply;
   * a command the main process rates risky (command-risk.ts: deleting, overwriting, discarding
   * work, unparseable …) always needs the strong confirmation, whatever the mode or grants. The
   * renderer's reading (`strong`) can only add to that, never waive it. Any other command was
   * approved by the user's own Enter. The request's `toolCallId` is `requestKey` (prefixed `user-bash:`).
   */
  async userCommand(sessionId: string, requestKey: string, command: string, opts: { strong?: boolean } = {}): Promise<Decision & { rule?: boolean }> {
    const input = { command };
    if (this.rule("bash", input)?.action === "deny") return { allow: false, rule: true };
    const risk = assessCommand(command);
    if (risk.level === "low" && !opts.strong) return { allow: true };
    return this.ask(sessionId, requestKey, "bash", input, { command, paths: risk.deletes ?? [] }, true);
  }
  private ask(sessionId: string, toolCallId: string, toolName: string, input: unknown, destructive: ReturnType<typeof destructiveInfo>, userCommand = false): Promise<Decision> {
    const requestId = randomUUID();
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
      const subagent = this.subagentOf(sessionId);
      const request: PermissionRequestPayload = {
        requestId,
        sessionId,
        toolCallId,
        // 子代理 (W3.4): the card says which sub-agent asked; the request still belongs to the child.
        ...(subagent ? { subagent } : {}),
        toolKind: toolName,
        title: toolName,
        rawInput: input,
        ...(destructive ? { destructive } : {}),
        // A command the user typed is confirmed once, never granted for later.
        options: userCommand ? [
          { optionId: "allow", kind: "allow_once", title: "仍要执行" },
          { optionId: "deny", kind: "reject_once", title: "取消" },
        ] : [
          { optionId: "allow", kind: "allow_once", title: "允许本次" },
          { optionId: "allow_session", kind: "allow_always", title: "本任务允许" },
          ...(destructive ? [] : [{ optionId: "allow_always", kind: "allow_always", title: "始终允许" }]),
          { optionId: "deny", kind: "reject_once", title: "拒绝" },
        ],
      };
      this.pending.set(requestId, { sessionId, toolName, input, finish, userCommand, request });
      this.emit("agent://permission", request);
    });
  }
  resolve(id: string, optionId: unknown, cancelled: unknown, reason?: unknown) {
    const pending = this.pending.get(id);
    if (!pending) throw Error("权限请求不存在或已过期");
    if (!cancelled && !(pending.userCommand ? ["allow", "deny"] : ["allow", "allow_session", "allow_always", "deny"]).includes(String(optionId)))
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
  /**
   * Cards still waiting on the user, in the exact shape of `agent://permission`
   * (20261117-mobile.md §2.4 path 3). A client that was disconnected when the
   * request was emitted fetches these on resume; the `requestId` it gets back is
   * the one `agent_resolve_permission` accepts.
   */
  pendingRequests(sessionId?: string): PermissionRequestPayload[] {
    const out: PermissionRequestPayload[] = [];
    for (const item of this.pending.values())
      if (!sessionId || item.sessionId === sessionId) out.push(item.request);
    return out;
  }
  /** 后台任务视图 (W4.5): how many approval cards this session is waiting on. */
  countPending(sessionId: string) {
    let count = 0;
    for (const item of this.pending.values()) if (item.sessionId === sessionId) count += 1;
    return count;
  }
  cancel(sessionId?: string) {
    for (const item of [...this.pending.values()])
      if (!sessionId || item.sessionId === sessionId) item.finish(false, "cancelled");
  }
  /** 自动化 (W4.2): `permissionMode: "fullAccess"` — allow every call in this run. */
  grantAll(sessionId: string) {
    this.sessionAll.add(sessionId);
  }
  revokeAll(sessionId: string) {
    this.sessionAll.delete(sessionId);
  }
  /** Forget per-session grants when a session is deleted. */
  forget(sessionId: string) {
    this.sessionAllow.delete(sessionId);
    this.sessionAll.delete(sessionId);
  }
}
