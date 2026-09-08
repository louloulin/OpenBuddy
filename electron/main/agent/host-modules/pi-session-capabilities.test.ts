import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  abortBash,
  abortRetry,
  compactSession,
  forkSession,
  getAvailableThinkingLevels,
  getCompactionSettings,
  getSessionStats,
  getSessionTree,
  setAutoCompactionEnabled,
  setAutoRetryEnabled,
  setFollowUpMode,
  setSteeringMode,
} from "./pi-session-capabilities";
import type { AgentHostState } from "./_state-shape";

/**
 * Build a stub state with a controllable session mock. Each test wires
 * `sessionMock` to the methods it cares about; the helper exposes the
 * `calls` array so tests can assert on what was called.
 */
function makeStubState(): { state: AgentHostState; sessionMock: Record<string, any> } {
  const sessionMock: Record<string, any> = {};
  const state = {
    session: {
      compact: (i?: string) => sessionMock.compact?.(i) ?? { summary: "stub", firstKeptEntryId: "stub" },
      setAutoCompactionEnabled: (e: boolean) => sessionMock.setAutoCompactionEnabled?.(e),
      setAutoRetryEnabled: (e: boolean) => sessionMock.setAutoRetryEnabled?.(e),
      abortRetry: () => sessionMock.abortRetry?.(),
      abortBash: () => sessionMock.abortBash?.(),
      setSteeringMode: (m: any) => sessionMock.setSteeringMode?.(m),
      setFollowUpMode: (m: any) => sessionMock.setFollowUpMode?.(m),
      getSessionStats: () => sessionMock.getSessionStats?.() ?? { tokens: 100 },
      getAvailableThinkingLevels: () => sessionMock.getAvailableThinkingLevels?.() ?? ["low", "medium", "high"],
      sessionManager: {
        getSessionFile: () => sessionMock.sessionFile ?? "/tmp/session.jsonl",
      },
      compactionSettings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
    },
  } as unknown as AgentHostState;
  return { state, sessionMock };
}

describe("host-modules/pi-session-capabilities", () => {
  let cwd: () => string;
  let piSessionDir: (cwd: string) => string;

  beforeEach(() => {
    cwd = () => "/test/cwd";
    piSessionDir = (c: string) => `/test/pi/${c}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compactSession delegates to session.compact", () => {
    const { state } = makeStubState();
    const result = compactSession({ state, cwd, piSessionDir }, "summarize please");
    expect(result).toEqual({ summary: "stub", firstKeptEntryId: "stub" });
  });

  it("compactSession throws CapabilityError when no session is live", () => {
    const state = { session: null } as unknown as AgentHostState;
    expect(() => compactSession({ state, cwd, piSessionDir })).toThrow();
  });

  it("setAutoCompactionEnabled forwards boolean", () => {
    const { state, sessionMock } = makeStubState();
    const spy = vi.fn();
    sessionMock.setAutoCompactionEnabled = spy;
    setAutoCompactionEnabled({ state, cwd, piSessionDir }, true);
    expect(spy).toHaveBeenCalledWith(true);
  });

  it("setAutoRetryEnabled forwards boolean", () => {
    const { state, sessionMock } = makeStubState();
    const spy = vi.fn();
    sessionMock.setAutoRetryEnabled = spy;
    setAutoRetryEnabled({ state, cwd, piSessionDir }, false);
    expect(spy).toHaveBeenCalledWith(false);
  });

  it("abortRetry / abortBash dispatch", () => {
    const { state, sessionMock } = makeStubState();
    const retry = vi.fn();
    const bash = vi.fn();
    sessionMock.abortRetry = retry;
    sessionMock.abortBash = bash;
    abortRetry({ state, cwd, piSessionDir });
    abortBash({ state, cwd, piSessionDir });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(bash).toHaveBeenCalledTimes(1);
  });

  it("setSteeringMode / setFollowUpMode dispatch mode strings", () => {
    const { state, sessionMock } = makeStubState();
    const steer = vi.fn();
    const follow = vi.fn();
    sessionMock.setSteeringMode = steer;
    sessionMock.setFollowUpMode = follow;
    setSteeringMode({ state, cwd, piSessionDir }, "all");
    setFollowUpMode({ state, cwd, piSessionDir }, "one-at-a-time");
    expect(steer).toHaveBeenCalledWith("all");
    expect(follow).toHaveBeenCalledWith("one-at-a-time");
  });

  it("getSessionStats returns session stats", () => {
    const { state, sessionMock } = makeStubState();
    sessionMock.getSessionStats = () => ({ tokens: 12345, cost: 0.42 });
    const stats = getSessionStats({ state, cwd, piSessionDir });
    expect(stats).toEqual({ tokens: 12345, cost: 0.42 });
  });

  it("getAvailableThinkingLevels returns the supported list", () => {
    const { state } = makeStubState();
    const levels = getAvailableThinkingLevels({ state, cwd, piSessionDir });
    expect(levels).toEqual(["low", "medium", "high"]);
  });

  it("getSessionTree returns [] when no session is live", () => {
    const state = { session: null } as unknown as AgentHostState;
    expect(getSessionTree({ state, cwd, piSessionDir })).toEqual([]);
  });

  it("getCompactionSettings returns the session settings", () => {
    const { state } = makeStubState();
    const settings = getCompactionSettings({ state, cwd, piSessionDir });
    expect(settings).toEqual({ enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 });
  });

  it("getCompactionSettings returns null when session has no settings", () => {
    const state = {
      session: { compactionSettings: undefined },
    } as unknown as AgentHostState;
    expect(getCompactionSettings({ state, cwd, piSessionDir })).toBeNull();
  });

  it("forkSession returns source-session-has-no-file error when sessionFile is missing", async () => {
    const { state } = makeStubState();
    (state.session as unknown as { sessionManager: { getSessionFile: () => string | undefined } }).sessionManager.getSessionFile = () => undefined;
    const result = await forkSession({ state, cwd, piSessionDir }, "entry-1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("source-session-has-no-file");
  });
});
