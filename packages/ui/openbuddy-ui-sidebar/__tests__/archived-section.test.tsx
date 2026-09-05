/**
 * R2.5 — Sidebar 已归档 group surfaces archived sessions with a 恢复 action.
 * Lightweight unit test: verifies the routing logic only (no full Sidebar render).
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useSessionsStore, selectArchivedCount } from "@/stores/sessions-store";

describe("sessions-store archive routing (R2.5)", () => {
  beforeEach(() => {
    useSessionsStore.setState({
      independent: [],
      workspaces: [],
      workspaceSessions: {},
      currentSessionId: null,
      drafts: {},
      query: "",
      filterStatus: null,
      filterDate: null,
      showArchived: false,
    } as never);
  });

  it("selectArchivedCount sums across independent + workspaceSessions", () => {
    useSessionsStore.setState({
      independent: [
        { sessionId: "a", title: "A", cwd: "", archived: true } as never,
        { sessionId: "b", title: "B", cwd: "" } as never,
      ],
      workspaceSessions: {
        "/ws1": [
          { sessionId: "c", title: "C", cwd: "/ws1", archived: true } as never,
        ],
      },
    } as never);
    expect(selectArchivedCount(useSessionsStore.getState())).toBe(2);
  });

  it("upsert flips the archived flag in place when the session already lives in independent", () => {
    useSessionsStore.setState({
      independent: [
        { sessionId: "a", title: "A", cwd: "" } as never,
      ],
      workspaceSessions: {},
    } as never);
    useSessionsStore.getState().upsert({ sessionId: "a", archived: true });
    const updated = useSessionsStore.getState().independent.find((s) => s.sessionId === "a");
    expect(updated?.archived).toBe(true);
  });

  it("upsert flips the archived flag in place when the session already lives in a 空间 cache", () => {
    useSessionsStore.setState({
      independent: [],
      workspaceSessions: {
        "/ws1": [{ sessionId: "c", title: "C", cwd: "/ws1" } as never],
      },
    } as never);
    useSessionsStore.getState().upsert({ sessionId: "c", archived: true });
    const updated = useSessionsStore.getState().workspaceSessions["/ws1"]?.find((s) => s.sessionId === "c");
    expect(updated?.archived).toBe(true);
  });

  it("setShowArchived toggles the flag", () => {
    expect(useSessionsStore.getState().showArchived).toBe(false);
    useSessionsStore.getState().setShowArchived(true);
    expect(useSessionsStore.getState().showArchived).toBe(true);
  });
});
