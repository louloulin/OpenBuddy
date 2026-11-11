import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("uses the preload file resolver and native dialog/window results", async () => {
    installBridge();
    expect(getPathForFile(new File(["x"], "a.ts"))).toBe("/workspace/a.ts");
    expect(await dialog.open({ multiple: true })).toEqual(["/workspace/a.ts"]);
    expect(await dialog.save()).toBe("/exports/a.md");
    expect(await dialog.ask("继续？")).toBe(true);
    expect(await win.isMaximized()).toBe(true);
  });
});
