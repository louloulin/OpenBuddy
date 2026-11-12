import { afterEach, describe, expect, it, vi } from "vitest";
import { flattenModels, subscribeAgentEvents } from "../agent-client";
import { createDesktopDirectoryReader } from "../desktop-kb-reader";
import { invoke, listen, dialog, getPathForFile, win, type OpenBuddyBridge } from "../ipc";

const installBridge = () => {
  const bridge: OpenBuddyBridge = {
    invoke: vi.fn(async () => ["session"]),
    listen: vi.fn(() => vi.fn()),
    dialog: { open: vi.fn(async () => ["/workspace/a.ts"]), save: vi.fn(async () => "/exports/a.md"), ask: vi.fn(async () => true) },
    window: { minimize: vi.fn(async () => {}), toggleMaximize: vi.fn(async () => {}), close: vi.fn(async () => {}), isMaximized: vi.fn(async () => true), onResized: vi.fn(() => vi.fn()) },
    getPathForFile: vi.fn(file => `/workspace/${file.name}`),
  };
  window.openbuddy = bridge;
  return bridge;
};
afterEach(() => { delete window.openbuddy; });
describe("Electron renderer bridge", () => {
  it("distinguishes same model slugs across providers including encoded slashes", () => {
    const rows = flattenModels({ providers: [{ id: "a/b", providerKind: "custom", label: "First" }, { id: "a", providerKind: "custom", label: "Second" }], models: [{ modelId: "shared/model", providerId: "a/b", input: ["text", "image"], reasoning: true }, { modelId: "shared/model", providerId: "a" }] });
    expect(rows.map(row => row.id)).toEqual(["model:a%2Fb/shared%2Fmodel", "model:a/shared%2Fmodel"]);
    expect(rows[0]).toMatchObject({ modelId: "shared/model", providerLabel: "First", reasoning: true, input: ["text", "image"] });
  });
  it("fails explicitly without preload", async () => {
    await expect(invoke("agent_init")).rejects.toThrow("preload bridge is unavailable");
  });
  it("keeps unavailable replies from escaping as typed arrays", async () => {
    const bridge = installBridge();
    vi.mocked(bridge.invoke).mockResolvedValue({ error: "not_implemented" });
    await expect(invoke<string[]>("session_search")).rejects.toThrow("暂不可用");
  });
  it("unwraps preload payloads and releases the event listener", async () => {
    const bridge = installBridge();
    let listener: ((payload: unknown) => void) | undefined;
    const released = vi.fn();
    vi.mocked(bridge.listen).mockImplementation((_event, callback) => { listener = callback; return released; });
    const received: unknown[] = [];
    const unlisten = await listen("agent://event", event => received.push(event.payload));
    listener?.({ sessionId: "A", event: { type: "agent_settled" } });
    expect(received).toEqual([{ sessionId: "A", event: { type: "agent_settled" } }]);
    unlisten();
    expect(released).toHaveBeenCalledOnce();
  });
  it("completes only settled turns and excludes history replay from completion effects", async () => {
    const bridge = installBridge();
    let callback: ((payload: unknown) => void) | undefined;
    const released = vi.fn();
    vi.mocked(bridge.listen).mockImplementation((event, listener) => {
      if (event === "agent://event") callback = listener;
      return released;
    });
    const updates: unknown[] = [];
    const completions: unknown[] = [];
    const unlisten = await subscribeAgentEvents({ onUpdate: event => updates.push(event), onComplete: event => completions.push(event) });
    callback?.({ sessionId: "A", event: { type: "agent_end" } });
    expect(completions).toEqual([]);
    callback?.({ sessionId: "A", event: { type: "agent_settled", aborted: true } });
    expect(completions).toEqual([expect.objectContaining({ sessionId: "A", stopReason: "cancelled" })]);
    callback?.({ sessionId: "A", event: { type: "agent_settled", replay: true } });
    expect(completions).toHaveLength(1);
    expect(updates).toHaveLength(3);
    unlisten();
    expect(released).toHaveBeenCalledOnce();
  });

  it("forwards extension errors with their session identity and releases the error listener", async () => {
    const bridge = installBridge();
    let extensionError: ((payload: unknown) => void) | undefined;
    const releaseError = vi.fn();
    vi.mocked(bridge.listen).mockImplementation((event, callback) => {
      if (event === "agent://error") { extensionError = callback; return releaseError; }
      return () => {};
    });
    const errors: unknown[] = [];
    const unsubscribe = await subscribeAgentEvents({ onTurnError: error => errors.push(error) });
    expect(extensionError).toBeTypeOf("function");
    extensionError?.({ sessionId: "background-session", message: "MCP extension failed" });
    expect(errors).toEqual([{ sessionId: "background-session", kind: "error", detail: "MCP extension failed" }]);
    unsubscribe();
    expect(releaseError).toHaveBeenCalledOnce();
  });

  it("reads knowledge sources with bounded file commands and directory kind mapping", async () => {
    const bridge = installBridge();
    vi.mocked(bridge.invoke).mockImplementation(async (command, payload) => {
      const args = payload as { maxBytes?: number };
      if (command === "list_dir") return [{ name: "docs", path: "/workspace/docs", kind: "directory" }];
      if (command === "read_text_file" && args.maxBytes && args.maxBytes <= 256 * 1024) return "bounded text";
      if (command === "read_file_base64" && args.maxBytes && args.maxBytes <= 1024 * 1024) return "AQID";
      throw new Error("Unbounded or unsupported knowledge read");
    });
    const reader = createDesktopDirectoryReader();
    expect(await reader.listDir("/workspace")).toEqual([{ name: "docs", path: "/workspace/docs", isDir: true }]);
    expect(await reader.readText("/workspace/a.md")).toBe("bounded text");
    expect(await reader.readBytes?.("/workspace/a.docx")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("uses the preload file resolver and native dialog/window results", async () => {
    installBridge();
    expect(getPathForFile(new File(["x"], "a.ts"))).toBe("/workspace/a.ts");
    expect(await dialog.open({ multiple: true })).toEqual(["/workspace/a.ts"]);
    expect(await dialog.save()).toBe("/exports/a.md");
    expect(await dialog.ask("继续？")).toBe(true);
    expect(await win.isMaximized()).toBe(true);
  });
});
