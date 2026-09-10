import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pluginListeners = new Set<(event: { type: string }) => void>();
  return {
    sessionInfo: vi.fn(),
    sessionUsage: vi.fn(),
    pluginListeners,
    subscribe: vi.fn(async (handler: (event: { type: string }) => void) => {
      pluginListeners.add(handler);
      return () => pluginListeners.delete(handler);
    }),
  };
});
const { sessionInfo, sessionUsage, pluginListeners, subscribe } = mocks;

vi.mock("@/lib/agent/pi-client", () => ({
  piSessionInfo: mocks.sessionInfo,
  piSessionUsage: mocks.sessionUsage,
  agentOnPluginEvent: mocks.subscribe,
}));

import { ContextUsagePill } from "../ContextUsagePill";

const context = (used: number, usagePct = Math.round((used / 100_000) * 100)) => ({
  used,
  total: 100_000,
  usagePct,
  systemPromptTokens: 10_000,
  toolDefinitionsCount: 2,
  toolDefinitionsTokens: 5_000,
  messageCount: 3,
  messageTokens: used - 15_000,
  turnCount: 1,
  toolCallCount: 0,
  compactionCount: 0,
  freeTokens: 100_000 - used,
});

function info(sessionId: string, used: number) {
  return { sessionId, cwd: "/tmp/fixture", context: context(used) };
}

describe("ContextUsagePill Pi event lifecycle", () => {
  beforeEach(() => {
    sessionInfo.mockReset();
    sessionUsage.mockReset();
    subscribe.mockClear();
    pluginListeners.clear();
    sessionUsage.mockResolvedValue(null);
  });

  it("refreshes the displayed snapshot for Pi context and compaction events", async () => {
    sessionInfo.mockResolvedValueOnce(info("s-1", 20_000)).mockResolvedValueOnce(info("s-1", 45_000));
    render(<ContextUsagePill sessionId="s-1" />);

    await waitFor(() => expect(screen.getByText("20%")).toBeTruthy());
    expect(subscribe).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const event of ["pi/context", "pi/context-status", "pi/context-compacted", "pi/context-compaction-requested"]) {
        for (const listener of pluginListeners) listener({ type: event });
      }
    });
    await waitFor(() => expect(screen.getByText("45%")).toBeTruthy());
    expect(sessionInfo).toHaveBeenCalledTimes(5);
  });

  it("unsubscribes on unmount and ignores late events", async () => {
    sessionInfo.mockResolvedValue(info("s-1", 20_000));
    const { unmount } = render(<ContextUsagePill sessionId="s-1" />);
    await waitFor(() => expect(screen.getByText("20%")).toBeTruthy());
    expect(pluginListeners.size).toBe(1);

    unmount();
    expect(pluginListeners.size).toBe(0);
    await act(async () => {
      for (const listener of pluginListeners) listener({ type: "pi/context" });
    });
    expect(sessionInfo).toHaveBeenCalledTimes(1);
  });

  it("preserves the last snapshot across refresh failure and resets safely on reload", async () => {
    sessionInfo.mockResolvedValueOnce(info("s-1", 20_000)).mockRejectedValueOnce(new Error("agent reloading"));
    const { rerender } = render(<ContextUsagePill sessionId="s-1" />);
    await waitFor(() => expect(screen.getByText("20%")).toBeTruthy());

    await act(async () => {
      for (const listener of pluginListeners) listener({ type: "pi/context-compacted" });
    });
    await waitFor(() => expect(sessionInfo).toHaveBeenCalledTimes(2));
    expect(screen.getByText("20%")).toBeTruthy();

    sessionInfo.mockResolvedValueOnce(info("s-2", 60_000));
    rerender(<ContextUsagePill sessionId="s-2" />);
    await waitFor(() => expect(screen.getByText("60%")).toBeTruthy());
    expect(screen.queryByText("20%")).toBeNull();
  });
});
