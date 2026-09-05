import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  ElectronBridgeUnavailableError,
  isElectronBridgeUnavailable,
  listenSafe,
  getElectronBridgeStatus,
} from "@/lib/platform/electron-api";

const setBridge = (api?: unknown) => {
  if (api === undefined) {
    delete (window as Window & { api?: unknown }).api;
  } else {
    (window as Window & { api?: unknown }).api = api;
  }
};

describe("bridge resilience", () => {
  beforeEach(() => {
    setBridge(undefined);
  });

  afterEach(() => {
    setBridge(undefined);
    vi.restoreAllMocks();
  });

  it("classifies ElectronBridgeUnavailable errors via the dedicated helper", () => {
    expect(isElectronBridgeUnavailable(new Error("other"))).toBe(false);
    expect(isElectronBridgeUnavailable(new ElectronBridgeUnavailableError("preload-not-loaded"))).toBe(true);
    const obj = Object.assign(new Error("wrapped"), { name: "ElectronBridgeUnavailable" });
    expect(isElectronBridgeUnavailable(obj)).toBe(true);
  });

  it("reports preload-not-loaded via getElectronBridgeStatus", () => {
    expect(getElectronBridgeStatus()).toEqual({ available: false, reason: "preload-not-loaded" });
  });

  it("reports unsupported-version with the actual apiVersion", () => {
    setBridge({ apiVersion: 2 });
    expect(getElectronBridgeStatus()).toEqual({ available: false, reason: "unsupported-version", apiVersion: 2 });
  });

  it("listenSafe resolves to null and triggers onUnavailable when the bridge is missing", async () => {
    const handler = vi.fn();
    const onUnavailable = vi.fn();
    const result = await listenSafe("chat://event", handler, onUnavailable);
    expect(result).toBeNull();
    expect(handler).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledOnce();
    const err = onUnavailable.mock.calls[0][0] as ElectronBridgeUnavailableError;
    expect(err.reason).toBe("preload-not-loaded");
    expect(err.name).toBe("ElectronBridgeUnavailable");
  });

  it("listenSafe rethrows non-bridge errors so app code is not silently swallowed", async () => {
    setBridge({ apiVersion: 1, events: { on: () => { throw new Error("boom"); } } });
    const onUnavailable = vi.fn();
    await expect(listenSafe("chat://event", () => {}, onUnavailable)).rejects.toThrow("boom");
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it("listenSafe returns the unlisten fn when the bridge is healthy", async () => {
    const unlisten = vi.fn();
    setBridge({ apiVersion: 1, events: { on: () => unlisten } });
    const result = await listenSafe("chat://event", () => {});
    expect(typeof result).toBe("function");
    expect(result?.()).toBeUndefined();
    expect(unlisten).toHaveBeenCalled();
  });
});
