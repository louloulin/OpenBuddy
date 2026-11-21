import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  setMode: vi.fn(),
  listeners: [] as Array<(state: { sessionId: string; mode?: string }) => void>,
}));
vi.mock("@openbuddy/client/agent-client", () => ({
  agentSessionInfo: mocks.info,
  agentSetMode: mocks.setMode,
  onSessionModelState: vi.fn(async (callback: (state: { sessionId: string; mode?: string }) => void) => {
    mocks.listeners.push(callback);
    return () => { mocks.listeners.splice(mocks.listeners.indexOf(callback), 1); };
  }),
}));

import { useSessionMode } from "../chat-view/use-session-mode";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.length = 0;
  mocks.info.mockResolvedValue(null);
  mocks.setMode.mockResolvedValue(undefined);
});

describe("useSessionMode (pii W0.5: the renderer shows the restored mode)", () => {
  it("asks a live session for its mode when it is focused", async () => {
    mocks.info.mockResolvedValue({ sessionId: "s1", mode: "ask" });
    const { result } = renderHook(() => useSessionMode("s1", vi.fn()));
    expect(result.current.mode).toBe("craft");
    await waitFor(() => expect(result.current.mode).toBe("ask"));
  });

  it("picks the mode up from the model state the host sends when the session opens or switches branch", async () => {
    const { result, rerender } = renderHook(({ id }) => useSessionMode(id, vi.fn()), { initialProps: { id: "s1" } });
    await waitFor(() => expect(mocks.listeners).toHaveLength(1));
    act(() => mocks.listeners[0]({ sessionId: "s2", mode: "plan" }));
    expect(result.current.mode).toBe("craft");
    rerender({ id: "s2" });
    expect(result.current.mode).toBe("plan");
    act(() => mocks.listeners[0]({ sessionId: "s2", mode: "craft" }));
    expect(result.current.mode).toBe("craft");
  });

  it("sets the mode through the host and reports a failure", async () => {
    const toast = vi.fn();
    const { result } = renderHook(() => useSessionMode("s1", toast));
    await act(() => result.current.changeMode("ask"));
    expect(mocks.setMode).toHaveBeenCalledWith("s1", "ask");
    expect(result.current.mode).toBe("ask");
    mocks.setMode.mockRejectedValueOnce(new Error("会话未加载"));
    await act(() => result.current.changeMode("plan"));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("切换失败"));
    expect(result.current.mode).toBe("ask");
  });
});
