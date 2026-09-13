/**
 * useExtensionAuditPanel.test.ts — vitest contract spec for the
 * Extension Audit panel renderer hook (plan4.5 §A).
 *
 * Verifies the renderer-side pipeline end-to-end without booting
 * Electron:
 *
 *   IPC event  →  useExtensionAuditPanel  →  { reports, summary, clear }
 *
 * The test mocks `agentOnPluginEvent` (the IPC bridge imported by the
 * hook) to capture the handler and feed synthetic `pi/extension-policy-report`
 * events through it. That lets us pin the hook's contract down to:
 *
 *   1. First report populates `reports[0]` and the summary tile.
 *   2. Second report (latest) supersedes the first in the summary.
 *   3. `clear()` empties the log and resets the summary.
 *   4. Unrelated event types (e.g. `session/input-truncated`) are
 *      ignored.
 *   5. Malformed payloads are silently dropped (the audit panel never
 *      crashes on a corrupt upstream event).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import type { OpenBuddyPluginEvent } from "../lib/agent/pi-client";
import type { UseExtensionAuditPanelResult } from "./useExtensionAuditPanel";

// We capture the handler installed by `agentOnPluginEvent` so the test
// can dispatch synthetic events back into the hook without going through
// the real `openbuddy://plugin-event` IPC channel.
const handlers: Array<(event: OpenBuddyPluginEvent) => void> = [];
const disposers: Array<() => void> = [];
// `agentPluginEvents` is the on-demand cached-event read used by the
// hook on mount to catch up on reports emitted before the panel
// subscribed. Tests control its return value via `setCachedEvents`.
let cachedEvents: OpenBuddyPluginEvent[] = [];
let pluginEventsCalls = 0;

vi.mock("../lib/agent/pi-client", () => ({
  agentOnPluginEvent: vi.fn(async (handler: (event: OpenBuddyPluginEvent) => void) => {
    handlers.push(handler);
    const dispose = () => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    };
    disposers.push(dispose);
    return dispose;
  }),
  agentPluginEvents: vi.fn(async () => {
    pluginEventsCalls += 1;
    return cachedEvents;
  }),
}));

// Imported after the mock so it picks up the mocked pi-client.
const { useExtensionAuditPanel } = await import("./useExtensionAuditPanel");

interface ProbeProps {
  onReady: (api: UseExtensionAuditPanelResult) => void;
}

function Probe({ onReady }: ProbeProps) {
  const api = useExtensionAuditPanel();
  useEffect(() => {
    onReady(api);
  }, [api, onReady]);
  return null;
}

const sampleReport = {
  generatedAt: "2026-09-13T02:00:00.000Z",
  total: 2,
  allowed: 1,
  denied: 1,
  needsReview: 0,
  decisions: [
    {
      id: "openbuddy-apply-patch",
      builtIn: true,
      action: "allow",
      reason: "OpenBuddy builtin extension",
    },
    {
      id: "pi-sketchy",
      packageName: "pi-sketchy",
      builtIn: false,
      action: "deny",
      reason: "extension is not allowlisted",
    },
  ],
};

function dispatch(event: OpenBuddyPluginEvent) {
  // The hook installs exactly one handler per <Probe>; tests render one
  // probe at a time so we know which handler to invoke.
  const handler = handlers[handlers.length - 1];
  expect(handler, "expected useExtensionAuditPanel to have subscribed").toBeDefined();
  act(() => {
    handler(event);
  });
}

describe("useExtensionAuditPanel (plan4.5 §A — renderer hook for pi/extension-policy-report)", () => {
  beforeEach(() => {
    handlers.length = 0;
    disposers.length = 0;
    cachedEvents = [];
    pluginEventsCalls = 0;
  });

  afterEach(() => {
    // Render cleanup unmounts the component which calls the disposer;
    // if a test forgot to unmount, clear handlers defensively.
    handlers.length = 0;
    disposers.length = 0;
  });

  it("subscribes to agentOnPluginEvent on mount", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    expect(handlers).toHaveLength(1);
    expect(captured).toBeDefined();
  });

  it("populates reports + summary from a well-formed pi/extension-policy-report", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "pi/extension-policy-report",
      timestamp: "2026-09-13T02:00:00.000Z",
      payload: sampleReport,
    });
    expect(captured).toBeDefined();
    expect(captured!.reports).toHaveLength(1);
    expect(captured!.reports[0].total).toBe(2);
    expect(captured!.summary.totalAllowed).toBe(1);
    expect(captured!.summary.totalDenied).toBe(1);
    expect(captured!.summary.totalNeedsReview).toBe(0);
    expect(captured!.summary.latest).toBe("2026-09-13T02:00:00.000Z");
    expect(captured!.summary.lastDecisionCount).toBe(2);
  });

  it("ignores unrelated event types (defensive)", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "session/input-truncated",
      payload: {},
    });
    expect(captured!.reports).toHaveLength(0);
    expect(captured!.summary.latest).toBeNull();
  });

  it("ignores malformed payloads (defensive)", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "pi/extension-policy-report",
      payload: null,
    });
    dispatch({
      type: "pi/extension-policy-report",
      payload: {},
    });
    dispatch({
      type: "pi/extension-policy-report",
      payload: { ...sampleReport, total: -1 },
    });
    expect(captured!.reports).toHaveLength(0);
  });

  it("summary reflects the LATEST report (a re-resolve supersedes)", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "pi/extension-policy-report",
      timestamp: "2026-09-13T02:00:00.000Z",
      payload: { ...sampleReport, total: 2, allowed: 1, denied: 1, needsReview: 0 },
    });
    dispatch({
      type: "pi/extension-policy-report",
      timestamp: "2026-09-13T02:30:00.000Z",
      payload: {
        ...sampleReport,
        generatedAt: "2026-09-13T02:30:00.000Z",
        total: 5,
        allowed: 4,
        denied: 0,
        needsReview: 1,
      },
    });
    expect(captured!.reports).toHaveLength(2);
    expect(captured!.summary.latest).toBe("2026-09-13T02:30:00.000Z");
    expect(captured!.summary.totalAllowed).toBe(4);
    expect(captured!.summary.totalDenied).toBe(0);
    expect(captured!.summary.totalNeedsReview).toBe(1);
    expect(captured!.summary.lastDecisionCount).toBe(5);
    expect(captured!.summary.reports).toBe(2);
  });

  it("clear() empties the log and resets the summary", async () => {
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "pi/extension-policy-report",
      timestamp: "2026-09-13T02:00:00.000Z",
      payload: sampleReport,
    });
    expect(captured!.reports).toHaveLength(1);
    act(() => {
      captured!.clear();
    });
    expect(captured!.reports).toHaveLength(0);
    expect(captured!.summary.latest).toBeNull();
  });

  it("catches up on reports emitted before mount via agentPluginEvents()", async () => {
    // The main-side ring buffer may already contain one or more
    // `pi/extension-policy-report` events by the time the renderer
    // mounts the panel. The hook must hydrate from that cache so the
    // user doesn't see an empty panel until the next resolve.
    cachedEvents = [
      {
        type: "session/input-truncated",
        timestamp: "2026-09-13T01:59:00.000Z",
        payload: {},
      },
      {
        type: "pi/extension-policy-report",
        timestamp: "2026-09-13T02:00:00.000Z",
        payload: sampleReport,
      },
    ];
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    // Catch-up is async — wait for the next microtask + promise chain.
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured).toBeDefined();
    expect(pluginEventsCalls).toBeGreaterThanOrEqual(1);
    // Only the policy-report is hydrated; session/input-truncated is
    // filtered by the accumulator.
    expect(captured!.reports).toHaveLength(1);
    expect(captured!.summary.totalAllowed).toBe(1);
    expect(captured!.summary.totalDenied).toBe(1);
    expect(captured!.summary.latest).toBe("2026-09-13T02:00:00.000Z");
  });

  it("does not crash when agentPluginEvents() rejects (graceful)", async () => {
    // The on-demand IPC call may fail (bridge down, etc.). The hook
    // must NOT crash the host — it should still subscribe to live
    // events and start from an empty log.
    const failingModule = await import("../lib/agent/pi-client");
    (failingModule.agentPluginEvents as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async () => {
        throw new Error("bridge down");
      },
    );
    let captured: UseExtensionAuditPanelResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured).toBeDefined();
    expect(captured!.reports).toHaveLength(0);
    // Live subscription still works.
    dispatch({
      type: "pi/extension-policy-report",
      timestamp: "2026-09-13T02:00:00.000Z",
      payload: sampleReport,
    });
    expect(captured!.reports).toHaveLength(1);
  });
});
