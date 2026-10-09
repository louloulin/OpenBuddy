import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachHostCoreSessionSearch,
  resetAgentSessionSearchBridge,
  sessionSearchBridgeState,
  sessionSearchViaBridge,
  sessionSetRootViaBridge,
} from "../agent-session-search-bridge";

const {
  callSessionSearch,
  callSessionSetRoot,
} = vi.hoisted(() => ({
  callSessionSearch: vi.fn(),
  callSessionSetRoot: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callSessionSearch,
  callSessionSetRoot,
}));

const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

beforeEach(() => {
  callSessionSearch.mockReset();
  callSessionSetRoot.mockReset();
  resetAgentSessionSearchBridge();
});
afterEach(() => resetAgentSessionSearchBridge());

describe("session-search-bridge — fallback path", () => {
  it("search returns empty array when no host", async () => {
    const result = await sessionSearchViaBridge("test");
    expect(result).toEqual([]);
    expect(callSessionSearch).not.toHaveBeenCalled();
  });

  it("setRoot is a no-op when no host", async () => {
    await sessionSetRootViaBridge("/tmp/sessions");
    expect(callSessionSetRoot).not.toHaveBeenCalled();
  });
});

describe("session-search-bridge — host-core path", () => {
  beforeEach(() => attachHostCoreSessionSearch(fakeHost as never));

  it("search uses host-core on happy path", async () => {
    callSessionSearch.mockResolvedValue({ hits: [{ sessionId: "s1", snippet: "...", rank: 1.0, lineNo: 10, matchedAt: "2026-09-24T00:00:00Z" }] });

    const result = await sessionSearchViaBridge("error", 20);

    expect(result).toEqual([{ sessionId: "s1", snippet: "...", rank: 1.0, lineNo: 10, matchedAt: "2026-09-24T00:00:00Z" }]);
    expect(callSessionSearch).toHaveBeenCalledWith(fakeHost, { query: "error", limit: 20 });
  });

  it("setRoot uses host-core on happy path", async () => {
    callSessionSetRoot.mockResolvedValue({ ok: true });

    await sessionSetRootViaBridge("/tmp/sessions");

    expect(callSessionSetRoot).toHaveBeenCalledWith(fakeHost, { sessionsRoot: "/tmp/sessions" });
  });
});

describe("session-search-bridge — degradation", () => {
  beforeEach(() => attachHostCoreSessionSearch(fakeHost as never));

  it("falls back to empty array when search fails", async () => {
    callSessionSearch.mockRejectedValue(new Error("rpc timeout"));

    const result = await sessionSearchViaBridge("test");

    expect(result).toEqual([]);
  });
});

describe("session-search-bridge — backoff", () => {
  beforeEach(() => attachHostCoreSessionSearch(fakeHost as never));

  it("skips host-core during backoff window after failure", async () => {
    callSessionSearch.mockRejectedValue(new Error("boom"));

    await sessionSearchViaBridge("q1");
    expect(callSessionSearch).toHaveBeenCalledTimes(1);

    await sessionSearchViaBridge("q2");
    expect(callSessionSearch).toHaveBeenCalledTimes(1); // no retry
  });

  it("bridgeState reports inBackoff after failure", async () => {
    callSessionSearch.mockRejectedValue(new Error("boom"));
    await sessionSearchViaBridge("q");

    const s = sessionSearchBridgeState();
    expect(s.hostAttached).toBe(true);
    expect(s.available).toBe(false);
    expect(s.inBackoff).toBe(true);
  });
});
