import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PinnedSection } from "../src/PinnedSection";
import { useSessionsStore } from "@/stores/sessions-store";

// Mock pi-client — we only care about whether the section calls it
// on unpin, not about the IPC round-trip itself.
vi.mock("@/lib/agent/pi-client", () => ({
  piSetSessionPinned: vi.fn().mockResolvedValue(undefined),
}));

// i18n stub so useT returns the key unchanged.
vi.mock("@/lib/platform/i18n", () => ({
  useT: (key: string) => key,
}));

function resetStore() {
  useSessionsStore.setState({
    independent: [],
    workspaces: [],
    workspaceSessions: {},
    currentSessionId: null,
  });
}

function setSessions(sessions: Array<{ sessionId: string; title: string; pinned?: boolean; archived?: boolean; cwd?: string; updatedAt?: string }>) {
  const independent = sessions.filter((s) => !s.cwd);
  const byCwd: Record<string, typeof sessions> = {};
  for (const s of sessions.filter((s) => s.cwd)) {
    byCwd[s.cwd!] = byCwd[s.cwd!] ?? [];
    byCwd[s.cwd!].push(s);
  }
  useSessionsStore.setState({
    independent,
    workspaceSessions: byCwd,
  });
}

describe("PinnedSection", () => {
  beforeEach(() => {
    resetStore();
  });

  test("renders the empty placeholder when nothing is pinned", () => {
    setSessions([{ sessionId: "a", title: "A", cwd: "/tmp" }]);
    render(<PinnedSection />);
    expect(screen.getByText("conversation.pinnedSection.empty")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  test("filters pinned-only sessions from both independent and workspace groups", () => {
    setSessions([
      { sessionId: "x", title: "Independent Pinned", pinned: true, updatedAt: "2026-01-01T00:00:00Z" },
      { sessionId: "y", title: "Workspace Pinned", pinned: true, cwd: "/tmp", updatedAt: "2026-01-02T00:00:00Z" },
      { sessionId: "z", title: "Workspace Unpinned", cwd: "/tmp" },
      { sessionId: "w", title: "Archived", pinned: true, archived: true },
    ]);
    render(<PinnedSection />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Sorted most-recent first by updatedAt
    expect(items[0]).toHaveTextContent("Workspace Pinned");
    expect(items[1]).toHaveTextContent("Independent Pinned");
  });

  test("clicking a row sets the current session", () => {
    setSessions([{ sessionId: "x", title: "Pick me", pinned: true, cwd: "/tmp" }]);
    render(<PinnedSection />);
    fireEvent.click(screen.getByRole("button", { name: /Pick me/i }));
    expect(useSessionsStore.getState().currentSessionId).toBe("x");
  });

  test("clicking unpin optimistically removes the row and calls piSetSessionPinned", async () => {
    const { piSetSessionPinned } = await import("@/lib/agent/pi-client");
    setSessions([
      { sessionId: "p1", title: "Pin me", pinned: true, cwd: "/tmp" },
      { sessionId: "p2", title: "Stay", pinned: true, cwd: "/tmp" },
    ]);
    render(<PinnedSection />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const unpinBtn = within(rows[0]).getByRole("button", { name: /conversation.unpin/i });
    fireEvent.click(unpinBtn);
    // Optimistic update removes the row.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(piSetSessionPinned).toHaveBeenCalledWith("p1", false);
  });

  test("rolls back when piSetSessionPinned rejects", async () => {
    const piClient = await import("@/lib/agent/pi-client");
    vi.mocked(piClient.piSetSessionPinned).mockRejectedValueOnce(new Error("nope"));
    setSessions([{ sessionId: "p1", title: "Pin me", pinned: true, cwd: "/tmp" }]);
    render(<PinnedSection />);
    fireEvent.click(screen.getByRole("button", { name: /conversation.unpin/i }));
    // Wait microtask queue to flush the rejection handler. The session lives
    // in workspaceSessions["/tmp"] (setSessions routes by cwd) so the rollback
    // must look there — `independent` is for cwd-less rows.
    await vi.waitFor(() => {
      const state = useSessionsStore.getState();
      const inWorkspace = state.workspaceSessions["/tmp"]?.find((s) => s.sessionId === "p1");
      expect(inWorkspace?.pinned).toBe(true);
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});
