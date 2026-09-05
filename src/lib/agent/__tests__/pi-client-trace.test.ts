import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const invokeMock = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === "agent:new-session") {
      const obj = payload as { cwd?: string } | undefined;
      return { sessionId: "session-from-new", cwd: obj?.cwd };
    }
    return { ok: true };
  });
  const traceGenerator = vi.fn(() => "auto-generated-trace-id-0001");
  const stubLogger = {
    child: () => stubLogger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
  return { invokeMock, traceGenerator, stubLogger };
});

vi.mock("@/lib/platform/electron-api", () => ({
  invoke: mocks.invokeMock,
  listen: vi.fn(async () => () => undefined),
  ensureRendererRpcChannel: vi.fn(),
  resolveRendererRpcInteraction: vi.fn(),
}));

vi.mock("@openbuddy/logging-renderer", () => ({
  createRendererLogger: () => mocks.stubLogger,
  withTrace: () => mocks.stubLogger,
  generateTrace: mocks.traceGenerator,
  generateTraceId: () => "shared-trace-id",
  redactText: (s: string) => s,
}));

import {
  piSend,
  piCancel,
  piSteer,
  piFollowUp,
  piNewSession,
  piLoadSession,
  piSetModel,
  piInit,
} from "../pi-client";

const FIXED = "fixed-trace-id-1234";

function callsFor(channel: string) {
  return mocks.invokeMock.mock.calls.filter(([ch]) => ch === channel);
}

describe("pi-client trace propagation", () => {
  beforeEach(() => {
    mocks.invokeMock.mockClear();
    mocks.traceGenerator.mockClear();
  });

  it("piInit: provided traceId is preserved (payload untouched for backward compat)", async () => {
    await piInit("/tmp/work", { traceId: FIXED });
    const matches = callsFor("agent:init");
    expect(matches).toHaveLength(1);
    // piInit preserves the existing bare-string payload for `agent:init`
    // because the main process handler currently expects a string. The
    // traceId is captured by the renderer-side logger only.
    expect(matches[0][1]).toBe("/tmp/work");
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piInit: generates a traceId when none is provided", async () => {
    await piInit("/tmp/work");
    expect(mocks.traceGenerator).toHaveBeenCalled();
  });

  it("piNewSession: provided traceId flows into IPC payload", async () => {
    await piNewSession("/tmp/work", "model-x", { traceId: FIXED });
    const matches = callsFor("agent:new-session");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ cwd: "/tmp/work", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piNewSession: auto-generates traceId when missing", async () => {
    await piNewSession("/tmp/work");
    const matches = callsFor("agent:new-session");
    expect(matches[0][1]).toMatchObject({ cwd: "/tmp/work" });
    expect(typeof (matches[0][1] as { traceId?: string }).traceId).toBe("string");
    expect(mocks.traceGenerator).toHaveBeenCalled();
  });

  it("piLoadSession: provided traceId flows into IPC payload", async () => {
    await piLoadSession("s-1", "/tmp/work", { traceId: FIXED });
    const matches = callsFor("agent:load-session");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", cwd: "/tmp/work", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piSetModel: provided traceId flows into IPC payload", async () => {
    await piSetModel("s-1", "model-x", { traceId: FIXED });
    const matches = callsFor("agent:set-model");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", modelId: "model-x", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piSend: provided traceId flows into IPC payload", async () => {
    await piSend("s-1", "hello world", { traceId: FIXED });
    const matches = callsFor("agent:prompt");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", text: "hello world", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piSteer: provided traceId flows into IPC payload", async () => {
    await piSteer("s-1", "steer me", { traceId: FIXED });
    const matches = callsFor("agent:steer");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", text: "steer me", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piFollowUp: provided traceId flows into IPC payload", async () => {
    await piFollowUp("s-1", "follow up", { traceId: FIXED });
    const matches = callsFor("agent:follow-up");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", text: "follow up", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });

  it("piCancel: provided traceId flows into IPC payload", async () => {
    await piCancel("s-1", { traceId: FIXED });
    const matches = callsFor("agent:abort");
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toMatchObject({ sessionId: "s-1", traceId: FIXED });
    expect(mocks.traceGenerator).not.toHaveBeenCalled();
  });
});
