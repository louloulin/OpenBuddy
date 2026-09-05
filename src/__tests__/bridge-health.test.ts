import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const warnFn = vi.fn();
  const infoFn = vi.fn();
  const errorFn = vi.fn();
  const fatalFn = vi.fn();
  const debugFn = vi.fn();
  const childFn = vi.fn();
  const logger = {
    child: (...args: unknown[]) => {
      childFn(...args);
      return logger;
    },
    info: (msg: string, ctx?: unknown) => infoFn(msg, ctx),
    warn: (msg: string, ctx?: unknown) => warnFn(msg, ctx),
    error: (msg: string, ctx?: unknown) => errorFn(msg, ctx),
    fatal: (msg: string, ctx?: unknown) => fatalFn(msg, ctx),
    debug: (msg: string, ctx?: unknown) => debugFn(msg, ctx),
  };
  return { warnFn, infoFn, errorFn, fatalFn, debugFn, childFn, logger };
});

vi.mock("@openbuddy/logging-renderer", () => ({
  createRendererLogger: () => mocks.logger,
  withTrace: <T,>(l: T) => l,
  generateTrace: () => "trace",
  generateTraceId: () => "trace",
  redactText: (s: string) => s,
}));

import { invoke, getBridgeLogger } from "../lib/platform/electron-api";

function setWindow(value: unknown) {
  // jsdom always provides a `window` global; we override `window.api` instead
  // so the underlying getter remains defined and we can simulate both the
  // "preload-not-loaded" and "unsupported-version" failure modes.
  (globalThis as { window: unknown }).window = value as unknown;
}

function findBridgeUnavailableCall() {
  return mocks.warnFn.mock.calls.find(
    (args: unknown[]) => (args[1] as { msg?: string } | undefined)?.msg === "bridge.unavailable",
  );
}

describe("bridge health detection", () => {
  beforeEach(() => {
    mocks.warnFn.mockClear();
    mocks.infoFn.mockClear();
    mocks.errorFn.mockClear();
    mocks.childFn.mockClear();
    setWindow({});
  });

  it("emits bridge.unavailable(reason=preload-not-loaded) when window.api is missing", async () => {
    setWindow({}); // no `api` key
    await expect(invoke("any:channel")).rejects.toThrow(/preload-not-loaded/);
    const call = findBridgeUnavailableCall();
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ msg: "bridge.unavailable", reason: "preload-not-loaded" });
  });

  it("emits bridge.unavailable(reason=unsupported-version) when apiVersion mismatches", async () => {
    setWindow({
      api: {
        apiVersion: 99,
        invoke: vi.fn(),
        rpc: { request: vi.fn(), onMessage: vi.fn() },
        events: { on: vi.fn(() => () => undefined) },
        clipboard: { readText: vi.fn(), writeText: vi.fn() },
        dialog: { open: vi.fn(), save: vi.fn(), ask: vi.fn(), confirm: vi.fn(), message: vi.fn() },
        window: {
          label: () => "main",
          minimize: vi.fn(),
          toggleMaximize: vi.fn(),
          close: vi.fn(),
          isMaximized: vi.fn(),
          onResized: vi.fn(),
        },
        webview: { label: () => "main", onDragDropEvent: vi.fn() },
        debug: {
          enabled: false,
          toggleDevTools: vi.fn(),
          reload: vi.fn(),
          forceReload: vi.fn(),
          info: vi.fn(),
        },
      },
    });
    await expect(invoke("any:channel")).rejects.toThrow(/unsupported-version/);
    const call = findBridgeUnavailableCall();
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ msg: "bridge.unavailable", reason: "unsupported-version" });
  });

  it("exposes a getBridgeLogger() accessor returning the same instance", () => {
    const a = getBridgeLogger();
    const b = getBridgeLogger();
    expect(a).toBe(b);
    expect(a.warn).toBeTypeOf("function");
  });
});
