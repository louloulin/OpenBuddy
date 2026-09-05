import { describe, expect, it } from "vitest";
import {
  PI_TELEMETRY_BRIDGE_KIND,
  PI_TELEMETRY_IPC_CHANNEL,
  PI_TELEMETRY_NOOP,
  createMainTelemetrySink,
  createOpenBuddyTelemetryContext,
  createTelemetryBridgeExtension,
  type OpenBuddyTelemetrySink,
  type OpenBuddyTelemetrySinkEvent,
  type PiTelemetryIpcEvent,
} from "./pi-telemetry-bridge";

describe("pi-telemetry-bridge", () => {
  function recordSink(): { sink: OpenBuddyTelemetrySink; events: OpenBuddyTelemetrySinkEvent[] } {
    const events: OpenBuddyTelemetrySinkEvent[] = [];
    return {
      sink: (event) => {
        events.push(event);
      },
      events,
    };
  }

  it("createOpenBuddyTelemetryContext emits start/end with the right namespace", async () => {
    const { sink, events } = recordSink();
    const ctx = createOpenBuddyTelemetryContext(sink);
    const result = await ctx.startSpan({ name: "demo", attributes: { sessionId: "s1" } }, async () => "ok");
    expect(result).toBe("ok");
    const names = events.map((e) => e.name);
    expect(names).toContain("pi.telemetry.span.start");
    expect(names).toContain("pi.telemetry.span.end");
    const start = events.find((e) => e.name === "pi.telemetry.span.start");
    expect(start?.props?.span).toBe("demo");
    expect(start?.props?.sessionId).toBe("s1");
  });

  it("startSpan surfaces addEvent / setAttributes / setStatus via the sink", async () => {
    const { sink, events } = recordSink();
    const ctx = createOpenBuddyTelemetryContext(sink);
    await ctx.startSpan({ name: "tool-call" }, async (span) => {
      span.addEvent("model.received", { tokens: 42 });
      span.setAttributes({ tool: "bash" });
      span.setStatus({ status: "ok" });
    });
    const eventsList = events.map((e) => e.name);
    expect(eventsList).toContain("pi.telemetry.event");
    expect(eventsList).toContain("pi.telemetry.span.end");
    const end = events.find((e) => e.name === "pi.telemetry.span.end");
    expect(end?.level).toBe("info");
    expect(end?.props?.tool).toBe("bash");
    const event = events.find((e) => e.name === "pi.telemetry.event");
    expect(event?.props?.event).toBe("model.received");
    expect(event?.props?.tokens).toBe(42);
  });

  it("startSpan re-throws callback errors and emits error end events", async () => {
    const { sink, events } = recordSink();
    const ctx = createOpenBuddyTelemetryContext(sink);
    await expect(
      ctx.startSpan({ name: "failing" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const end = events.find((e) => e.name === "pi.telemetry.span.end");
    expect(end?.level).toBe("error");
    expect(end?.props?.status).toBe("error");
    const errProp = end?.props?.error as { name?: string; message?: string } | undefined;
    expect(errProp?.message).toBe("boom");
  });

  it("startSpan returns the callback's value transparently", async () => {
    const { sink } = recordSink();
    const ctx = createOpenBuddyTelemetryContext(sink);
    const value = await ctx.startSpan({ name: "value" }, async () => ({ ok: true, payload: [1, 2, 3] }));
    expect(value).toEqual({ ok: true, payload: [1, 2, 3] });
  });

  it("createTelemetryBridgeExtension hooks turn_start and session_shutdown into the sink", () => {
    const { sink, events } = recordSink();
    const factory = createTelemetryBridgeExtension(sink);
    const handlers = new Map<string, (event: unknown) => void>();
    const fakePi = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers.set(event, handler as (event: unknown) => void);
      },
    };
    factory(fakePi as never);
    expect(handlers.has("turn_start")).toBe(true);
    expect(handlers.has("turn_end")).toBe(true);
    expect(handlers.has("session_shutdown")).toBe(true);
    handlers.get("turn_end")?.({ sessionId: "s2", messageCount: 4 });
    handlers.get("session_shutdown")?.({ sessionId: "s2" });
    expect(events.find((e) => e.name === "pi.telemetry.turn.end")?.props?.messageCount).toBe(4);
    expect(events.find((e) => e.name === "pi.telemetry.session.shutdown")?.props?.sessionId).toBe("s2");
  });

  it("PI_TELEMETRY_NOOP is exposed so consumers can wire a safe default", () => {
    expect(PI_TELEMETRY_NOOP).toBeDefined();
    expect(typeof PI_TELEMETRY_NOOP.startSpan).toBe("function");
  });

  it("PI_TELEMETRY_BRIDGE_KIND stays stable for downstream audits", () => {
    expect(PI_TELEMETRY_BRIDGE_KIND).toBe("openbuddy.pi-telemetry-bridge");
  });

  it("createMainTelemetrySink forwards events under the pi.telemetry namespace by default", () => {
    const ipcEvents: PiTelemetryIpcEvent[] = [];
    const sink = createMainTelemetrySink((channel, payload) => {
      ipcEvents.push(payload);
      expect(channel).toBe(PI_TELEMETRY_IPC_CHANNEL);
    });
    sink({ name: "pi.telemetry.span.start", level: "debug", props: { span: "x" } });
    expect(ipcEvents[0]?.name).toBe("pi.telemetry.span.start");
  });

  it("createMainTelemetrySink rewrites to the wb.telemetry namespace when aegisMode is enabled", () => {
    const ipcEvents: PiTelemetryIpcEvent[] = [];
    const sink = createMainTelemetrySink(
      (channel, payload) => {
        ipcEvents.push(payload);
        expect(channel).toBe(PI_TELEMETRY_IPC_CHANNEL);
      },
      { aegisMode: true },
    );
    sink({ name: "pi.telemetry.span.start", level: "debug", props: { span: "turn" } });
    sink({ name: "pi.telemetry.turn.end", level: "info", props: { sessionId: "s1" } });
    sink({ name: "custom.event", level: "info" });
    expect(ipcEvents.map((event) => event.name)).toEqual([
      "wb.telemetry.span.start",
      "wb.telemetry.turn.end",
      "custom.event",
    ]);
  });
});