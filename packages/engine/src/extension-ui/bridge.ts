import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Emit } from "../permissions/permissions.js";
import { object, text } from "@openbuddy/services/settings/settings";
type Kind = "select" | "confirm" | "input" | "editor";
type Reason =
  | "resolved"
  | "cancelled"
  | "timeout"
  | "aborted"
  | "session_closed";
type DialogOptions = Parameters<ExtensionUIContext["input"]>[2];
export class ExtensionUiBridge {
  private epochs = new Map<string, symbol>();
  private pending = new Map<
    string,
    {
      sessionId: string;
      kind: Kind;
      options?: string[];
      finish: (value: string | boolean | undefined, reason: Reason) => void;
      /** The exact payload emitted as `agent://ui-request`, so a reconnecting client can rebuild the card. */
      request: Record<string, unknown>;
    }
  >();
  /** 0 = no timeout: like tool approvals, extension dialogs wait for the user (20261115-ui E3). */
  constructor(
    private emit: Emit,
    private timeoutMs = 0,
  ) {}
  private request(
    sessionId: string,
    kind: Kind,
    title: string,
    fields: Record<string, unknown>,
    opts?: DialogOptions,
  ): Promise<string | boolean | undefined> {
    if (opts?.signal?.aborted)
      return Promise.resolve(kind === "confirm" ? false : undefined);
    const requestId = randomUUID(),
      timeout = opts?.timeout ?? this.timeoutMs;
    if (!Number.isFinite(timeout) || timeout < 0)
      throw Error("invalid UI timeout");
    return new Promise((resolve) => {
      const onAbort = () => finish(undefined, "aborted");
      const timer = timeout > 0 ? setTimeout(() => finish(undefined, "timeout"), timeout) : undefined;
      timer?.unref?.();
      const finish = (value: string | boolean | undefined, reason: Reason) => {
        if (!this.pending.has(requestId)) return;
        if (timer) clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(requestId);
        this.emit("agent://ui-dismiss", { requestId, sessionId, reason });
        resolve(value ?? (kind === "confirm" ? false : undefined));
      };
      const request = {
        requestId,
        sessionId,
        kind,
        title,
        ...fields,
        ...(timeout > 0 ? { timeoutMs: timeout } : {}),
      };
      this.pending.set(requestId, {
        sessionId,
        kind,
        options: fields.options as string[] | undefined,
        finish,
        request,
      });
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      this.emit("agent://ui-request", request);
    });
  }
  resolve(raw: unknown) {
    const p = object(raw),
      id = text(p.requestId),
      sessionId = text(p.sessionId),
      pending = this.pending.get(id);
    if (!pending || pending.sessionId !== sessionId)
      throw Error("UI request不存在、已过期或会话不匹配");
    if (p.cancelled !== undefined && typeof p.cancelled !== "boolean")
      throw Error("cancelled必须为布尔值");
    if (p.cancelled) {
      pending.finish(undefined, "cancelled");
      return;
    }
    if (pending.kind === "confirm") {
      if (typeof p.value !== "boolean") throw Error("confirm必须返回布尔值");
    } else if (typeof p.value !== "string" || p.value.length > 1024 * 1024)
      throw Error("UI输入必须为有界字符串");
    if (
      pending.kind === "select" &&
      !pending.options?.includes(String(p.value))
    )
      throw Error("select必须返回已提供的选项");
    pending.finish(p.value as string | boolean, "resolved");
  }
  hasPending(sessionId: string) {
    for (const item of this.pending.values()) if (item.sessionId === sessionId) return true;
    return false;
  }
  /**
   * Question cards still waiting on the user, in the exact shape of
   * `agent://ui-request` (20261117-mobile.md §2.4 path 3). Recovering the
   * permission half was not enough: an extension `select`/`confirm`/`input`
   * blocks the turn the same way, and a phone that missed it saw nothing.
   */
  pendingRequests(sessionId?: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const item of this.pending.values())
      if (!sessionId || item.sessionId === sessionId) out.push(item.request);
    return out;
  }
  cancel(sessionId?: string, reason: Reason = "cancelled") {
    if (sessionId) this.epochs.delete(sessionId);
    else this.epochs.clear();
    for (const p of [...this.pending.values()])
      if (!sessionId || p.sessionId === sessionId) p.finish(undefined, reason);
  }
  context(sessionId: string): ExtensionUIContext {
    this.cancel(sessionId, "aborted");
    const epoch = Symbol();
    this.epochs.set(sessionId, epoch);
    const active = () => this.epochs.get(sessionId) === epoch;
    const ask = (
      kind: Kind,
      title: string,
      fields: Record<string, unknown>,
      opts?: DialogOptions,
    ) =>
      active()
        ? this.request(sessionId, kind, title, fields, opts)
        : Promise.resolve(kind === "confirm" ? false : undefined);
    const state = (kind: string, fields: Record<string, unknown>) =>
      active() && this.emit("agent://ui-state", { sessionId, kind, ...fields });
    // Terminal-only APIs (TUI component factories, terminal input, themes)
    // have nothing to render on the desktop: they degrade to no-ops, and the
    // user is told once per session instead of the extension crashing (F9).
    const told = new Set<string>();
    const degraded = (name: string) => {
      if (!active() || told.has(name)) return;
      told.add(name);
      this.emit("agent://ui-notification", { sessionId, message: `扩展使用了终端界面功能（${name}），桌面版不显示这部分。`, severity: "info" });
    };
    let editorText = "";
    let toolsExpanded = false;
    // A theme whose styling functions return the text unchanged.
    const theme = new Proxy({}, {
      get: (_t, key) => (key === "name" ? "openbuddy" : (...args: unknown[]) => { const last = args[args.length - 1]; return typeof last === "string" ? last : ""; }),
    });
    const supported: Partial<ExtensionUIContext> = {
      select: async (title, options, opts) =>
        (await ask("select", title, { options: [...options] }, opts)) as
          | string
          | undefined,
      confirm: async (title, message, opts) =>
        (await ask("confirm", title, { message }, opts)) as boolean,
      input: async (title, placeholder, opts) =>
        (await ask("input", title, { placeholder }, opts)) as
          | string
          | undefined,
      editor: async (title, initialValue) =>
        (await ask("editor", title, { initialValue })) as string | undefined,
      notify: (message, severity = "info") => {
        if (active())
          this.emit("agent://ui-notification", {
            sessionId,
            message,
            severity,
          });
      },
      setStatus: (key, value) => state("status", { key, text: value }),
      // null (not undefined) so "clear the message" survives IPC serialization.
      setWorkingMessage: (message) => state("working", { message: message ?? null }),
      setWorkingVisible: (visible) => state("working", { visible }),
      setTitle: (title) => state("title", { title }),
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content)) return degraded("组件小部件");
        state("widget", { key, lines: content, placement: options?.placement });
      },
      setEditorText: (text) => { editorText = text; state("editor", { action: "set", text }); },
      pasteToEditor: (text) => { editorText += text; state("editor", { action: "paste", text }); },
      getEditorText: () => editorText,
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      onTerminalInput: () => { degraded("终端输入"); return () => {}; },
      setFooter: (factory) => { if (factory) degraded("页脚"); },
      setHeader: (factory) => { if (factory) degraded("页眉"); },
      setEditorComponent: (factory) => { if (factory) degraded("自定义输入框"); },
      getEditorComponent: () => undefined,
      addAutocompleteProvider: () => degraded("自动补全"),
      get theme() { return theme as ExtensionUIContext["theme"]; },
      getAllThemes: () => [{ name: "openbuddy", path: undefined }],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "桌面版使用应用自身的主题" }),
      getToolsExpanded: () => toolsExpanded,
      setToolsExpanded: (expanded) => { toolsExpanded = expanded; },
      custom: async () => { degraded("自定义界面"); return undefined as never; },
    };
    return new Proxy(supported, {
      get(target, key) {
        if (key in target) return Reflect.get(target, key);
        // Methods added to the SDK later: no-op rather than crash the extension.
        return () => undefined;
      },
    }) as ExtensionUIContext;
  }
}
