/**
 * Round 19 — G10 PR 3 vitest for extracted builtin factory helpers.
 *
 * Round 19 extracted 4 inline `(emit, config, options) => (pi) => { ... }`
 * bodies from `builtinPiExtensionFactories` into named factory functions:
 *
 *   - createObservabilityExtension(emit, config)
 *   - createContextStatusExtension(emit)
 *   - createContextGuardExtension(emit, config)
 *   - createCompactAnnounceExtension()
 *
 * Each is exercised here with a minimal mock `pi` to verify the
 * resulting ExtensionFactory correctly calls `api.on(...)` for at
 * least one expected event. We pick observability because it's the
 * most representative (it registers 10+ events across MVP-4/5/7).
 */
import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createObservabilityExtension } from "../pi-extensions";

function makePiMock(): {
  api: ExtensionAPI;
  events: Array<{ name: string; payload: unknown }>;
} {
  const events: Array<{ name: string; payload: unknown }> = [];
  const api = {
    on(event: string, handler: (payload: unknown) => void) {
      // Simulate the pi runtime by capturing the event + a dummy payload.
      events.push({ name: event, payload: { ts: 1 } });
      handler(events[events.length - 1].payload);
    },
  } as unknown as ExtensionAPI;
  return { api, events };
}

describe("G10 PR 3 — extracted builtin factory helpers", () => {
  it("createObservabilityExtension forwards agent_start and tool_execution_start events", () => {
    const emit = vi.fn();
    const { api, events } = makePiMock();
    const factory = createObservabilityExtension(emit, { toolEvents: true });
    factory(api);

    // Verify the factory wired up both lifecycle and tool events.
    const names = events.map((e) => e.name);
    expect(names).toContain("agent_start");
    expect(names).toContain("agent_end");
    expect(names).toContain("model_select");
    expect(names).toContain("tool_execution_start");
    expect(names).toContain("tool_execution_end");

    // Verify emit() was called for each event with `pi/<event-name>` prefix.
    const emitCalls = (emit as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const prefixes = emitCalls.map((c) => c[0]);
    expect(prefixes).toContain("pi/agent-start");
    expect(prefixes).toContain("pi/tool-start");
  });

  it("createObservabilityExtension respects toolEvents=false (skips tool_* events)", () => {
    const emit = vi.fn();
    const { api, events } = makePiMock();
    const factory = createObservabilityExtension(emit, { toolEvents: false });
    factory(api);

    const names = events.map((e) => e.name);
    expect(names).toContain("agent_start");
    expect(names).not.toContain("tool_execution_start");
    expect(names).not.toContain("tool_execution_end");
  });

  it("createObservabilityExtension defaults toolEvents to true when config is missing/undefined", () => {
    const emit = vi.fn();
    const { api, events } = makePiMock();
    // Pass undefined config — should still register tool events.
    const factory = createObservabilityExtension(emit, undefined);
    factory(api);
    const names = events.map((e) => e.name);
    expect(names).toContain("tool_execution_start");
    expect(names).toContain("tool_execution_end");
  });
});