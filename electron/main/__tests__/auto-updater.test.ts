/**
 * electron/main/__tests__/auto-updater.test.ts
 *
 * Goal: rb-autoupdater (mu7rpkze-gc769z). Verifies the minimal wire-up
 * without touching the network:
 *   - `installAutoUpdater()` returns a handle with `trigger` + `stop`.
 *   - `handle.trigger()` invokes `autoUpdater.checkForUpdates()` exactly
 *     once even when called multiple times (idempotent).
 *   - The renderer-side IPC channels `app:auto-update-available`,
 *     `app:auto-update-progress`, and `app:auto-update-downloaded` fire
 *     through `BrowserWindow.webContents.send` with the expected payload
 *     shape when the underlying autoUpdater emits the matching events.
 *   - `stop()` detaches listeners so a second `stop()` is a no-op.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron — we only exercise BrowserWindow.getAllWindows + send.
// Each window gets a *distinct* send spy so assertions can target the live
// window without counting sends meant for the destroyed one.
const liveSend = vi.fn();
const deadSend = vi.fn();
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send: liveSend } },
      { isDestroyed: () => true, webContents: { send: deadSend } }, // must be skipped
    ],
  },
}));

// Mock electron-updater with a TypedEmitter-like surface that we can drive.
const checkForUpdates = vi.fn().mockResolvedValue(null);
const updaterListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const fakeAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on(event: string, fn: (...args: unknown[]) => void) {
    if (!updaterListeners.has(event)) updaterListeners.set(event, new Set());
    updaterListeners.get(event)!.add(fn);
    return this;
  },
  off(event: string, fn: (...args: unknown[]) => void) {
    updaterListeners.get(event)?.delete(fn);
    return this;
  },
  checkForUpdates,
};
vi.mock("electron-updater", () => ({
  autoUpdater: fakeAutoUpdater,
}));

// Mock logging-main to keep the test free of pino bring-up.
vi.mock("@openbuddy/logging-main", () => ({
  createMainLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const importModule = async () => {
  // Dynamic import so the mocks above are installed first.
  return await import("../auto-updater");
};

const emitUpdater = (event: string, ...args: unknown[]) => {
  for (const fn of updaterListeners.get(event) ?? []) {
    fn(...args);
  }
};

beforeEach(() => {
  updaterListeners.clear();
  checkForUpdates.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("installAutoUpdater (minimal wire-up)", () => {
  it("returns a handle with trigger() and stop()", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater();
    expect(typeof handle.trigger).toBe("function");
    expect(typeof handle.stop).toBe("function");
    handle.stop();
  });

  it("flips autoDownload=false + autoInstallOnAppQuit=true by default", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater();
    expect(fakeAutoUpdater.autoDownload).toBe(false);
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(true);
    handle.stop();
  });

  it("respects explicit options", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater({ autoDownload: true, autoInstallOnAppQuit: false });
    expect(fakeAutoUpdater.autoDownload).toBe(true);
    expect(fakeAutoUpdater.autoInstallOnAppQuit).toBe(false);
    handle.stop();
  });

  it("trigger() invokes checkForUpdates exactly once (idempotent)", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater();
    await handle.trigger();
    await handle.trigger();
    await handle.trigger();
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    handle.stop();
  });

  it("broadcasts update-available / progress / downloaded via webContents.send", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater();

    emitUpdater("update-available", { version: "0.16.0" });
    emitUpdater("download-progress", { percent: 42, transferred: 420, total: 1000, bytesPerSecond: 100 });
    emitUpdater("update-downloaded", { version: "0.16.0" });

    expect(liveSend).toHaveBeenCalledWith("app:auto-update-available", { version: "0.16.0" });
    expect(liveSend).toHaveBeenCalledWith("app:auto-update-progress", { percent: 42 });
    expect(liveSend).toHaveBeenCalledWith("app:auto-update-downloaded", { version: "0.16.0" });
    // Destroyed window must NOT have received any send.
    expect(deadSend).not.toHaveBeenCalled();
    handle.stop();
  });

  it("uses a custom channelPrefix when provided", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater({ channelPrefix: "app:upd" });
    emitUpdater("update-available", { version: "0.16.0" });
    expect(liveSend).toHaveBeenCalledWith("app:upd-available", { version: "0.16.0" });
    handle.stop();
  });

  it("stop() detaches listeners — second stop() is a safe no-op", async () => {
    const { installAutoUpdater } = await importModule();
    const handle = installAutoUpdater();
    handle.stop();
    // After stop, emitting should not trigger any IPC.
    emitUpdater("update-available", { version: "0.17.0" });
    expect(liveSend).not.toHaveBeenCalled();
    // Second stop must not throw.
    expect(() => handle.stop()).not.toThrow();
  });
});