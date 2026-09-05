import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirm, getCurrentWebview, getCurrentWindow, getElectronBridgeStatus, invoke, listen, open, save } from "@/lib/platform/electron-api";

describe("Electron renderer API", () => {
  const unlisten = vi.fn();
  const api = {
    apiVersion: 1,
    invoke: vi.fn(async (channel: string, args?: unknown) => ({ channel, args })),
    events: { on: vi.fn((_channel: string, _handler: (payload: unknown) => void) => unlisten) },
    dialog: {
      open: vi.fn(async () => ["/tmp/example.txt"]),
      save: vi.fn(async () => "/tmp/example.md"),
      ask: vi.fn(async () => true),
      confirm: vi.fn(async () => false),
      message: vi.fn(async () => undefined),
    },
    window: {
      label: () => "main",
      minimize: vi.fn(async () => undefined),
      toggleMaximize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      isMaximized: vi.fn(async () => false),
      onResized: vi.fn(async () => unlisten),
    },
    webview: {
      label: () => "main",
      onDragDropEvent: vi.fn(async () => unlisten),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });

  it("routes typed commands through Electron IPC", async () => {
    await expect(invoke<{ channel: string }>("agent:current-model")).resolves.toEqual({
      channel: "agent:current-model",
      args: undefined,
    });
    expect(api.invoke).toHaveBeenCalledWith("agent:current-model", undefined);
  });

  it("reports a versioned bridge readiness state", () => {
    expect(getElectronBridgeStatus()).toEqual({ available: true, apiVersion: 1 });
    Object.defineProperty(window, "api", { configurable: true, value: undefined });
    expect(getElectronBridgeStatus()).toEqual({ available: false, reason: "preload-not-loaded" });
  });

  it("subscribes to events and returns a disposer", async () => {
    const handler = vi.fn();
    const disposer = await listen<{ value: number }>("pi://event", handler);
    expect(api.events.on).toHaveBeenCalledWith("pi://event", expect.any(Function));
    const callback = api.events.on.mock.calls[0][1] as (payload: unknown) => void;
    callback({ value: 7 });
    expect(handler).toHaveBeenCalledWith({ type: "pi://event", payload: { value: 7 } });
    disposer();
    expect(unlisten).toHaveBeenCalled();
  });

  it("exposes native dialogs and window controls", async () => {
    await expect(open({ directory: true })).resolves.toEqual(["/tmp/example.txt"]);
    await expect(save({ defaultPath: "example.md" })).resolves.toBe("/tmp/example.md");
    await expect(confirm("Continue?")).resolves.toBe(false);
    expect(getCurrentWindow().label()).toBe("main");
    expect(getCurrentWebview().label()).toBe("main");
  });
});
