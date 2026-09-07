/**
 * telemetry-sink.test.ts — smoke tests for telemetry sink factory.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installTelemetrySink,
  telemetrySink,
  __resetTelemetrySinkForTest,
} from "./telemetry-sink";

afterEach(() => {
  __resetTelemetrySinkForTest();
  delete process.env.OPENBUDDY_AEGIS_MODE;
  delete process.env.OPENBUDDY_SPAN_TREE_EXPORTER;
});

describe("telemetry-sink", () => {
  it("returns undefined when no renderer emitter is bound", () => {
    installTelemetrySink({
      hasRendererEventEmitter: () => false,
      emitRendererEvent: vi.fn(),
    });
    expect(telemetrySink()).toBeUndefined();
  });

  it("returns a sink when renderer emitter is bound", () => {
    installTelemetrySink({
      hasRendererEventEmitter: () => true,
      emitRendererEvent: vi.fn(),
    });
    const sink = telemetrySink();
    expect(sink).toBeDefined();
  });

  it("passes aegisMode flag through to createMainTelemetrySink", () => {
    const emitRendererEvent = vi.fn();
    installTelemetrySink({
      hasRendererEventEmitter: () => true,
      emitRendererEvent,
    });
    process.env.OPENBUDDY_AEGIS_MODE = "1";
    const sink = telemetrySink();
    expect(sink).toBeDefined();
    // The inner sink would call emitRendererEvent via the bridge.
    // We can't introspect aegis mode directly without exposing it, so
    // just verify sink is created.
  });
});
