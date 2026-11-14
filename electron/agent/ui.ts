import { randomUUID } from "node:crypto";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Emit } from "./permissions.js";
import { object, text } from "../services/settings.js";
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
    }
  >();
  constructor(
    private emit: Emit,
    private timeoutMs = 120000,
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
    if (!Number.isFinite(timeout) || timeout <= 0)
      throw Error("invalid UI timeout");
    return new Promise((resolve) => {
      const onAbort = () => finish(undefined, "aborted");
      const timer = setTimeout(() => finish(undefined, "timeout"), timeout);
      timer.unref?.();
      const finish = (value: string | boolean | undefined, reason: Reason) => {
        if (!this.pending.has(requestId)) return;
        clearTimeout(timer);
        opts?.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(requestId);
        this.emit("agent://ui-dismiss", { requestId, sessionId, reason });
        resolve(value ?? (kind === "confirm" ? false : undefined));
      };
      this.pending.set(requestId, {
        sessionId,
        kind,
        options: fields.options as string[] | undefined,
        finish,
      });
      opts?.signal?.addEventListener("abort", onAbort, { once: true });
      this.emit("agent://ui-request", {
        requestId,
        sessionId,
        kind,
        title,
        ...fields,
        timeoutMs: timeout,
      });
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
    const unsupported = (name: string): never => {
      throw Error(`not_implemented: desktop extension UI ${name}`);
    };
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
      setWorkingMessage: (message) => state("working", { message }),
      setWorkingVisible: (visible) => state("working", { visible }),
      setTitle: (title) => state("title", { title }),
      setWidget: (key, content, options) => {
        if (content !== undefined && !Array.isArray(content))
          unsupported("component widget");
        state("widget", { key, lines: content, placement: options?.placement });
      },
      setEditorText: (text) => state("editor", { action: "set", text }),
      pasteToEditor: (text) => state("editor", { action: "paste", text }),
      custom: async () => unsupported("custom"),
    };
    return new Proxy(supported, {
      get(target, key) {
        if (key in target) return Reflect.get(target, key);
        if (key === "theme") return unsupported("theme");
        return () => unsupported(String(key));
      },
    }) as ExtensionUIContext;
  }
}
