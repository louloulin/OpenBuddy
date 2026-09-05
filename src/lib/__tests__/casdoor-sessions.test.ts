import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../platform/electron-api", () => ({
  invoke: (channel: string, payload?: unknown) => invokeMock(channel, payload),
}));

import { casdoorListUserSessions, casdoorDeleteSession, casdoorDeleteAllSessions } from "../casdoor/casdoor-client";

describe("casdoorListSessions / casdoorDeleteSession client wrappers", () => {
  it("forwards owner + name to the casdoor:list-sessions channel", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        sessionId: "sess-1",
        owner: "acme",
        name: "alice",
        application: "app-builtin",
        deviceName: "MacBook Pro 16",
        ip: "10.0.0.5",
        userAgent: "Mozilla/5.0",
        createdAt: "2024-08-01T00:00:00Z",
        expiresAt: "2024-08-08T00:00:00Z",
        refreshedAt: "2024-08-02T00:00:00Z",
        isOnline: true,
      },
      {
        sessionId: "sess-2",
        application: "app-mobile",
        deviceName: "iPhone 15",
        ip: "10.0.0.6",
        isOnline: false,
      },
    ]);
    const out = await casdoorListUserSessions("acme", "alice");
    expect(invokeMock).toHaveBeenCalledWith("casdoor:list-sessions", { owner: "acme", name: "alice" });
    expect(out).toHaveLength(2);
    expect(out[0].sessionId).toBe("sess-1");
    expect(out[0].application).toBe("app-builtin");
    expect(out[0].isOnline).toBe(true);
    expect(out[1].isOnline).toBe(false);
  });

  it("forwards owner + name + sessionId to casdoor:delete-session", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await casdoorDeleteSession({ owner: "acme", name: "alice", sessionId: "sess-1" });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:delete-session", { owner: "acme", name: "alice", sessionId: "sess-1" });
  });

  it("forwards owner + name to casdoor:delete-all-sessions", async () => {
    invokeMock.mockResolvedValueOnce({ requested: 3, revoked: 3, failed: 0, failures: [] });
    await expect(casdoorDeleteAllSessions("acme", "alice")).resolves.toEqual({ requested: 3, revoked: 3, failed: 0, failures: [] });
    expect(invokeMock).toHaveBeenCalledWith("casdoor:delete-all-sessions", { owner: "acme", name: "alice" });
  });

  it("propagates IPC errors without swallowing them", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/get-sessions 403"));
    await expect(casdoorListUserSessions("acme", "alice")).rejects.toThrow("Casdoor /api/get-sessions 403");
  });

  it("propagates delete-session IPC errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Casdoor /api/delete-session 404"));
    await expect(casdoorDeleteSession({ owner: "acme", name: "alice", sessionId: "sess-bad" })).rejects.toThrow("Casdoor /api/delete-session 404");
  });
});
