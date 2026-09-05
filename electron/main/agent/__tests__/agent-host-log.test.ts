import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHostLogger, hostDispatched, hostFailed, hostLog, hostReceived } from "../agent-host-log";

const { write, createMainLogger, withContext } = vi.hoisted(() => ({
  write: vi.fn(),
  createMainLogger: vi.fn(),
  withContext: vi.fn((logger: unknown, context: unknown) => ({ ...(logger as object), context })),
}));

vi.mock("@openbuddy/logging-main", () => ({
  createMainLogger,
  withContext,
}));

describe("agent host logging helpers", () => {
  beforeEach(() => {
    write.mockClear();
    createMainLogger.mockReset();
    createMainLogger.mockReturnValue({ info: write, error: write });
  });

  it("creates a test-safe host logger and scopes child logs", () => {
    const logger = createHostLogger("");
    hostLog(logger, "agent-host.test").info({ msg: "test.received" }, "test.received");

    expect(createMainLogger).toHaveBeenCalledWith(expect.objectContaining({ filePath: "", serviceName: "openbuddy-agent-host" }));
    expect(withContext).toHaveBeenCalledWith(logger, { scope: "agent-host.test" });
    expect(write).toHaveBeenCalledWith({ msg: "test.received" }, "test.received");
  });

  it("writes IPC lifecycle boundaries with the same trace context", () => {
    const logger = createHostLogger("");
    hostReceived("agent:prompt", "trace-1", "session-1");
    hostDispatched("agent:prompt", "trace-1", "session-1");
    hostFailed("agent:prompt", "trace-1", new Error("failed"));

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ msg: "ipc.received", traceId: "trace-1", sessionId: "session-1" }), "agent:prompt received");
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ msg: "ipc.dispatched", traceId: "trace-1", sessionId: "session-1" }), "agent:prompt dispatched");
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ msg: "ipc.failed", traceId: "trace-1", error: { name: "Error", message: "failed" } }), "agent:prompt failed");
  });
});
