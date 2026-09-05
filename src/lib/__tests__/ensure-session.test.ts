import { describe, it, expect, beforeEach, vi } from "vitest";

const piNewSessionMock = vi.fn();
vi.mock("../agent/pi-client", () => ({
  piNewSession: (...args: unknown[]) => piNewSessionMock(...args),
}));

const sessionStoreState: { sessionId: string | null; setSession: (id: string | null) => void } = {
  sessionId: null,
  setSession: (id) => {
    sessionStoreState.sessionId = id;
  },
};
vi.mock("@/stores/session-store", () => ({
  useSessionStore: {
    getState: () => sessionStoreState,
  },
}));

const sessionsStoreState = {
  homeCwd: "" as string,
  currentSessionId: null as string | null,
  setCurrent: (id: string | null) => {
    sessionsStoreState.currentSessionId = id;
  },
  upsert: (entry: { sessionId: string }) => {
    sessionsStoreState.currentSessionId = entry.sessionId;
  },
};
vi.mock("@/stores/sessions-store", () => ({
  useSessionsStore: {
    getState: () => sessionsStoreState,
  },
}));

import { ensureSession } from "../agent/ensure-session";

describe("ensureSession", () => {
  beforeEach(() => {
    piNewSessionMock.mockReset();
    sessionStoreState.sessionId = null;
    sessionsStoreState.homeCwd = "";
    sessionsStoreState.currentSessionId = null;
  });

  it("returns the existing session id without creating a new one", async () => {
    sessionStoreState.sessionId = "session-existing";
    const id = await ensureSession();
    expect(id).toBe("session-existing");
    expect(piNewSessionMock).not.toHaveBeenCalled();
  });

  it("throws when no existing session and homeCwd is empty", async () => {
    await expect(ensureSession()).rejects.toThrow(/工作目录/);
    expect(piNewSessionMock).not.toHaveBeenCalled();
  });

  it("creates a new session, registers it in stores, and returns the new id", async () => {
    sessionsStoreState.homeCwd = "/tmp/work";
    piNewSessionMock.mockResolvedValueOnce("session-new");

    const id = await ensureSession();
    expect(id).toBe("session-new");
    expect(piNewSessionMock).toHaveBeenCalledWith("/tmp/work");
    expect(sessionsStoreState.currentSessionId).toBe("session-new");
    expect(sessionStoreState.sessionId).toBe("session-new");
  });
});
