import { expect, it, vi } from "vitest";

it("keeps unsent drafts across a restart (U4.8)", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("openbuddy.drafts", JSON.stringify({ s1: "写到一半", bad: 3 }));
    vi.resetModules();
    const { useSessionsStore } = await import("../sessions-store");
    expect(useSessionsStore.getState().drafts).toEqual({ s1: "写到一半" });
    useSessionsStore.getState().setDraft("s2", "另一个");
    useSessionsStore.getState().setDraft("s1", "");
    vi.advanceTimersByTime(500);
    expect(JSON.parse(localStorage.getItem("openbuddy.drafts")!)).toEqual({ s2: "另一个" });
  } finally {
    vi.useRealTimers();
  }
});
