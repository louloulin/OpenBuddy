import { describe, expect, it, beforeEach, afterEach } from "vitest";
type Bridge = {
  apiVersion: 1;
  invoke: (c: string, a?: unknown) => Promise<unknown>;
  rpc: { request: (m: unknown) => Promise<unknown>; onMessage: (h: (m: unknown) => void) => () => void };
  events: { on: (c: string, h: (p: unknown) => void) => () => void };
  dialog: {
    open: (o?: unknown) => Promise<string | string[] | null>;
    save: (o?: unknown) => Promise<string | null>;
    ask: (o: { message: string }) => Promise<boolean>;
    confirm: (o: { message: string }) => Promise<boolean>;
    message: (o: { message: string }) => Promise<void>;
  };
  window: {
    label: () => string;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onResized: (h: () => void | Promise<void>) => Promise<() => void>;
  };
  webview: { label: () => string; onDragDropEvent: (h: (e: { payload: unknown }) => void) => Promise<() => void> };
  debug: { enabled: boolean };
  clipboard: { readText: () => Promise<string>; writeText: (t: string) => Promise<void> };
};
const BASE: Bridge = {
  apiVersion: 1,
  rpc: { request: async () => undefined, onMessage: () => () => void 0 },
  events: { on: () => () => void 0 },
  dialog: { open: async () => null, save: async () => null, ask: async () => false, confirm: async () => false, message: async () => void 0 },
  window: { label: () => "main", minimize: async () => void 0, toggleMaximize: async () => void 0, close: async () => void 0, isMaximized: async () => false, onResized: async () => () => void 0 },
  webview: { label: () => "", onDragDropEvent: async () => () => void 0 },
  debug: { enabled: false },
  clipboard: { readText: async () => "", writeText: async () => void 0 },
  invoke: async () => undefined,
};
function install(bridge: Bridge): void {
  (globalThis as unknown as { window: { api: unknown } }).window = { api: bridge };
}
let saved: unknown;
beforeEach(() => { saved = (globalThis as unknown as { window?: { api?: unknown } }).window?.api; });
afterEach(() => {
  (globalThis as unknown as { window?: { api?: unknown } }).window = saved === undefined ? undefined : { api: saved };
});
describe("invoke() — error property preservation (R7.2)", () => {
  it("preserves code and custom properties when main throws EmailError", async () => {
    const e = new Error("Error invoking remote method 'email:accounts': 没有已连接的邮箱 MCP 服务") as Error & { code?: string; retryAfterMs?: number; innerError?: string };
    e.name = "EmailError"; e.code = "provider_unavailable"; e.retryAfterMs = 5000;
    Object.defineProperty(e, "innerError", { value: "underlying", enumerable: true });
    install({ ...BASE, invoke: async () => { throw e; } });
    const { invoke } = await import("../electron-api");
    let caught: unknown;
    try { await invoke("email:accounts"); } catch (x) { caught = x; }
    const err = caught as Error & { code?: string; retryAfterMs?: number; innerError?: string };
    expect(err.name).toBe("EmailError");
    expect(err.code).toBe("provider_unavailable");
    expect(err.retryAfterMs).toBe(5000);
    expect(err.innerError).toBe("underlying");
    expect(err.message).toBe("没有已连接的邮箱 MCP 服务");
  });
  it("preserves code across the wrapping prefix regex", async () => {
    const e = new Error("Error invoking remote method 'email:threads-page': inner") as Error & { code?: string };
    e.name = "EmailError"; e.code = "provider_unavailable";
    install({ ...BASE, invoke: async () => { throw e; } });
    const { invoke } = await import("../electron-api");
    let caught: unknown;
    try { await invoke("email:threads-page"); } catch (x) { caught = x; }
    expect((caught as Error & { code?: string }).code).toBe("provider_unavailable");
  });
  it("non-Error rejections still throw a sanitized Error", async () => {
    install({ ...BASE, invoke: async () => { throw "string-only"; } });
    const { invoke } = await import("../electron-api");
    await expect(invoke("email:accounts")).rejects.toThrow(/string-only/);
  });
  it("skips read-only / getter-only own props without aborting", async () => {
    const e = new Error("inner");
    Object.defineProperty(e, "code", { value: "provider_unavailable", writable: false, configurable: false, enumerable: true });
    install({ ...BASE, invoke: async () => { throw e; } });
    const { invoke } = await import("../electron-api");
    let caught: unknown;
    try { await invoke("email:accounts"); } catch (x) { caught = x; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("Error");
  });
});
