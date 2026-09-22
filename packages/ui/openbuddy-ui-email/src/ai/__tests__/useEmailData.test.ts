import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEmailData, type EmailDataProvider } from "../hooks/useEmailData";
import type { AiInboxAccount, AiInboxThread, RailCounts } from "../components/AiInboxShell";

function makeProvider(overrides: Partial<EmailDataProvider> = {}): EmailDataProvider {
  return {
    listAccounts: overrides.listAccounts ?? vi.fn().mockImplementation(async () => []),
    listThreads: overrides.listThreads ?? vi.fn().mockImplementation(async () => []),
    counts: overrides.counts ?? vi.fn().mockImplementation(async () => ({
      today: 0, later: 0, done: 0, inbox: 0, drafts: 0, scheduled: 0, snoozed: 0,
    })),
    triage: overrides.triage ?? vi.fn().mockImplementation(async () => ({})),
    ...overrides,
  };
}

const baseFilters = {
  view: "today" as const,
  folder: "inbox" as const,
};

describe("useEmailData", () => {
  it("fetches accounts + counts + threads on mount", async () => {
    const accounts: AiInboxAccount[] = [
      { id: "a1", address: "me@openbuddy.ai", name: "Work", status: "connected" },
    ];
    const threads: AiInboxThread[] = [
      {
        id: "t1", accountId: "a1", subject: "Q4",
        from: { name: "Lin", address: "lin@x" }, date: "2026-09-21T09:00:00Z",
        snippet: "x", unread: true, messageCount: 1, labels: [],
      },
    ];
    const provider = makeProvider({
      listAccounts: vi.fn().mockResolvedValue(accounts),
      listThreads: vi.fn().mockResolvedValue(threads),
      counts: vi.fn().mockResolvedValue({ today: 1, later: 0, done: 0, inbox: 1, drafts: 0, scheduled: 0, snoozed: 0 }),
    });
    const { result } = renderHook(() => useEmailData({ provider, filters: baseFilters }));
    await waitFor(() => expect(result.current.accounts).toEqual(accounts));
    expect(result.current.threads).toEqual(threads);
    expect(result.current.counts.today).toBe(1);
  });

  it("calls onProviderError when accounts fails", async () => {
    const onProviderError = vi.fn();
    const provider = makeProvider({ listAccounts: vi.fn().mockRejectedValue(new Error("offline")) });
    renderHook(() => useEmailData({ provider, filters: baseFilters, onProviderError }));
    await waitFor(() => expect(onProviderError).toHaveBeenCalledWith({ message: "offline" }));
  });

  it("re-fetches when filters change", async () => {
    const listThreads = vi.fn().mockImplementation(async () => []);
    const provider = makeProvider({ listThreads });
    const { rerender } = renderHook(
      ({ filters }) => useEmailData({ provider, filters }),
      { initialProps: { filters: { ...baseFilters, folder: "inbox" as const } } },
    );
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(1));
    rerender({ filters: { ...baseFilters, folder: "inbox" as const } });
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
  });

  it("merges triage chips into threads", async () => {
    const provider = makeProvider({
      listThreads: vi.fn().mockResolvedValue([
        { id: "t1", accountId: "a1", subject: "Q4", from: { address: "lin@x" }, date: "2026-09-21", snippet: "x", unread: true, messageCount: 1, labels: [] },
      ]),
      triage: vi.fn().mockResolvedValue({ t1: ["priority", "reply"] }),
    });
    const { result } = renderHook(() => useEmailData({ provider, filters: baseFilters }));
    await waitFor(() => expect(result.current.threads[0].aiChips).toEqual(["priority", "reply"]));
  });

  it("does not crash when triage fails", async () => {
    const onProviderError = vi.fn();
    const provider = makeProvider({
      listThreads: vi.fn().mockResolvedValue([
        { id: "t1", accountId: "a1", subject: "Q4", from: { address: "lin@x" }, date: "2026-09-21", snippet: "x", unread: false, messageCount: 1, labels: [] },
      ]),
      triage: vi.fn().mockRejectedValue(new Error("triage down")),
    });
    const { result } = renderHook(() => useEmailData({ provider, filters: baseFilters, onProviderError }));
    await waitFor(() => expect(onProviderError).toHaveBeenCalledWith({ message: "triage down" }));
    expect(result.current.threads).toHaveLength(1);
  });

  it("refresh forces refetch", async () => {
    const listAccounts = vi.fn().mockImplementation(async () => []);
    const provider = makeProvider({ listAccounts });
    const { result } = renderHook(() => useEmailData({ provider, filters: baseFilters }));
    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(listAccounts).toHaveBeenCalledTimes(2));
  });

  it("respects enabled = false", async () => {
    const listAccounts = vi.fn().mockImplementation(async () => []);
    const provider = makeProvider({ listAccounts });
    renderHook(() => useEmailData({ provider, filters: baseFilters, enabled: false }));
    // Wait a tick — listAccounts should not be called
    await new Promise((r) => setTimeout(r, 30));
    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("cancels stale request when filters change mid-flight", async () => {
    let resolveFirst: ((v: AiInboxThread[]) => void) | null = null;
    const listThreads = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    listThreads.mockResolvedValueOnce([] as AiInboxThread[]);
    const provider = makeProvider({ listThreads });
    const { rerender } = renderHook(
      ({ filters }) => useEmailData({ provider, filters }),
      { initialProps: { filters: { ...baseFilters, folder: "inbox" as const } } },
    );
    rerender({ filters: { ...baseFilters, folder: "inbox" as const } });
    // Resolve first request — should be ignored.
    await act(async () => {
      if (resolveFirst) resolveFirst([]);
    });
    await waitFor(() => expect(listThreads).toHaveBeenCalledTimes(2));
  });
});
