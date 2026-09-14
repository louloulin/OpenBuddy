/**
 * useExtensionNeedsReviewApproval.test.tsx — vitest contract spec for
 * the renderer-side hook that drives the needs-review approval modal
 * (plan4.5 §B).
 *
 * The hook wires three IPC surfaces:
 *
 *   - `agentNeedsReviewState()` (one-shot snapshot on mount)
 *   - `agentOnPluginEvent(...)` (live `pi/extension-needs-review-pending`
 *     stream from main)
 *   - `agentApproveNeedsReview(id)` / `agentRejectNeedsReview(id)`
 *     (renderer → main mutators)
 *
 * The hook is the renderer-side counterpart of `useExtensionAuditPanel`
 * (Round 11/16) — same ordering trick (live subscription FIRST, then
 * async snapshot catch-up) so synchronous dispatchers don't lose the
 * first event.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";

import type { OpenBuddyPluginEvent } from "../lib/agent/pi-client";
import type { UseExtensionNeedsReviewApprovalResult } from "./useExtensionNeedsReviewApproval";

const handlers: Array<(event: OpenBuddyPluginEvent) => void> = [];
const disposers: Array<() => void> = [];
let cachedEvents: OpenBuddyPluginEvent[] = [];
let stateCalls = 0;

let approveMock = vi.fn(async (id: string) => ({
  ok: true,
  id,
  state: "allow",
  summary: { pending: [], pendingCount: 0, approvedCount: 1, rejectedCount: 0 },
}));
let rejectMock = vi.fn(async (id: string) => ({
  ok: true,
  id,
  state: "deny",
  summary: { pending: [], pendingCount: 0, approvedCount: 0, rejectedCount: 1 },
}));
let stateMock = vi.fn(async () => ({
  pending: [],
  pendingCount: 0,
  approvedCount: 0,
  rejectedCount: 0,
}));

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
  agentPluginEvents: vi.fn(async () => cachedEvents),
  agentNeedsReviewState: () => {
    stateCalls += 1;
    return stateMock();
  },
  agentApproveNeedsReview: (id: string) => approveMock(id),
  agentRejectNeedsReview: (id: string) => rejectMock(id),
}));

const { useExtensionNeedsReviewApproval } = await import("./useExtensionNeedsReviewApproval");

interface ProbeProps {
  onReady: (api: UseExtensionNeedsReviewApprovalResult) => void;
}

function Probe({ onReady }: ProbeProps) {
  const api = useExtensionNeedsReviewApproval();
  // Capture every render's `api` into a closure-scoped ref so the
  // test can read the latest snapshot without depending on the React
  // useEffect re-run timing. The `useEffect` dep is `api` itself so
  // we get the most recent reference on every state mutation.
  const latestRef = useRef(api);
  latestRef.current = api;
  useEffect(() => {
    onReady(latestRef.current);
  });
  return null;
}

function dispatch(event: OpenBuddyPluginEvent) {
  const handler = handlers[handlers.length - 1];
  expect(handler, "expected hook to have subscribed").toBeDefined();
  act(() => {
    handler(event);
  });
}

const sampleEntry = {
  id: "pi-flagged",
  packageName: "pi-flagged",
  reason: "requires manual review",
  requestedAt: "2026-09-13T02:00:00.000Z",
};

describe("useExtensionNeedsReviewApproval (plan4.5 §B)", () => {
  beforeEach(() => {
    handlers.length = 0;
    disposers.length = 0;
    cachedEvents = [];
    stateCalls = 0;
    approveMock = vi.fn(async (id: string) => ({
      ok: true,
      id,
      state: "allow",
      summary: { pending: [], pendingCount: 0, approvedCount: 1, rejectedCount: 0 },
    }));
    rejectMock = vi.fn(async (id: string) => ({
      ok: true,
      id,
      state: "deny",
      summary: { pending: [], pendingCount: 0, approvedCount: 0, rejectedCount: 1 },
    }));
    stateMock = vi.fn(async () => ({
      pending: [],
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
    }));
  });

  afterEach(() => {
    handlers.length = 0;
    disposers.length = 0;
  });

  it("subscribes to agentOnPluginEvent on mount", async () => {
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    expect(handlers).toHaveLength(1);
    expect(captured).toBeDefined();
  });

  it("hydrates from agentNeedsReviewState on mount", async () => {
    stateMock = vi.fn(async () => ({
      pending: [sampleEntry],
      pendingCount: 1,
      approvedCount: 0,
      rejectedCount: 0,
    }));
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured).toBeDefined();
    expect(stateCalls).toBeGreaterThanOrEqual(1);
    expect(captured!.pending).toHaveLength(1);
    expect(captured!.pendingCount).toBe(1);
  });

  it("updates pending from pi/extension-needs-review-pending events", async () => {
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "pi/extension-needs-review-pending",
      timestamp: "2026-09-13T02:00:00.000Z",
      payload: {
        generatedAt: "2026-09-13T02:00:00.000Z",
        pendingCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
        pending: [sampleEntry],
      },
    });
    expect(captured!.pending).toHaveLength(1);
    expect(captured!.pending[0].id).toBe("pi-flagged");
  });

  it("ignores unrelated event types (defensive)", async () => {
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    dispatch({
      type: "session/input-truncated",
      payload: {},
    });
    expect(captured!.pending).toHaveLength(0);
  });

  it("approve(id) calls agentApproveNeedsReview and reflects the updated summary", async () => {
    approveMock = vi.fn(async (id: string) => ({
      ok: true,
      id,
      state: "allow",
      summary: { pending: [], pendingCount: 0, approvedCount: 1, rejectedCount: 0 },
    }));
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    await act(async () => {
      await captured!.approve("pi-flagged");
    });
    // Flush one more microtask + macrotask so the re-render triggered
    // by the state update is committed before the assertion.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(approveMock).toHaveBeenCalledWith("pi-flagged");
    expect(captured!.approvedCount).toBe(1);
    expect(captured!.pending).toHaveLength(0);
  });

  it("reject(id) calls agentRejectNeedsReview and reflects the updated summary", async () => {
    rejectMock = vi.fn(async (id: string) => ({
      ok: true,
      id,
      state: "deny",
      summary: { pending: [], pendingCount: 0, approvedCount: 0, rejectedCount: 1 },
    }));
    let captured: UseExtensionNeedsReviewApprovalResult | undefined;
    render(<Probe onReady={(api) => (captured = api)} />);
    await act(async () => {
      await captured!.reject("pi-flagged");
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(rejectMock).toHaveBeenCalledWith("pi-flagged");
    expect(captured!.rejectedCount).toBe(1);
    expect(captured!.pending).toHaveLength(0);
  });
});
