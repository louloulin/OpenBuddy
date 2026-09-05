import { describe, expect, it } from "vitest";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { PiSessionRuntime, type PiSessionRuntimeFactory } from "./pi-session-runtime";

type FakeSession = AgentSession & {
  emit: (event: AgentSessionEvent) => void;
  abortCalls: number;
  disposeCalls: number;
};

function createFakeSession(id: string): FakeSession {
  const handlers = new Set<(event: AgentSessionEvent) => void>();
  const session = {
    sessionId: id,
    abortCalls: 0,
    disposeCalls: 0,
    subscribe: (handler: (event: AgentSessionEvent) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: (event: AgentSessionEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
    abort: async () => { session.abortCalls += 1; },
    dispose: () => { session.disposeCalls += 1; },
  } as unknown as FakeSession;
  return session;
}

function factory(sessions: FakeSession[]): PiSessionRuntimeFactory {
  return { create: async () => ({ session: sessions.shift()! }) };
}

describe("PiSessionRuntime", () => {
  it("owns creation and rejects a second active session", async () => {
    const first = createFakeSession("first");
    const runtime = new PiSessionRuntime({ factory: factory([first]) });
    await runtime.create({});
    await expect(runtime.create({})).rejects.toThrow("already active");
    expect(runtime.session).toBe(first);
    expect(runtime.sessionId).toBe("first");
  });

  it("attaches one guarded subscription and ignores events after disposal", async () => {
    const first = createFakeSession("first");
    const runtime = new PiSessionRuntime({ factory: factory([first]) });
    await runtime.create({});
    const received: string[] = [];
    runtime.subscribe((event, session) => received.push(`${session.sessionId}:${event.type}`));
    first.emit({ type: "agent_start" } as AgentSessionEvent);
    await runtime.dispose();
    first.emit({ type: "agent_end" } as AgentSessionEvent);
    expect(received).toEqual(["first:agent_start"]);
    expect(first.abortCalls).toBe(1);
    expect(first.disposeCalls).toBe(1);
    expect(runtime.session).toBeNull();
  });

  it("replaces a subscription without duplicating callbacks", async () => {
    const first = createFakeSession("first");
    const runtime = new PiSessionRuntime({ factory: factory([first]) });
    await runtime.create({});
    const received: string[] = [];
    runtime.subscribe(() => received.push("old"));
    runtime.subscribe(() => received.push("new"));
    first.emit({ type: "agent_start" } as AgentSessionEvent);
    expect(received).toEqual(["new"]);
  });

  it("does not publish a session when creation fails", async () => {
    const failingFactory: PiSessionRuntimeFactory = {
      create: async () => { throw new Error("create failed"); },
    };
    const runtime = new PiSessionRuntime({ factory: failingFactory });
    await expect(runtime.create({})).rejects.toThrow("create failed");
    expect(runtime.session).toBeNull();
    expect(runtime.currentGeneration).toBe(0);
  });

  it("creates the replacement before disposing the previous session", async () => {
    const first = createFakeSession("first");
    const second = createFakeSession("second");
    const runtime = new PiSessionRuntime({ factory: factory([first, second]) });
    await runtime.create({});
    const received: string[] = [];
    runtime.subscribe((event, session) => received.push(`${session.sessionId}:${event.type}`));
    await runtime.replace({});
    first.emit({ type: "agent_start" } as AgentSessionEvent);
    second.emit({ type: "agent_start" } as AgentSessionEvent);
    expect(received).toEqual(["second:agent_start"]);
    expect(first.abortCalls).toBe(1);
    expect(first.disposeCalls).toBe(1);
    expect(runtime.sessionId).toBe("second");
  });
});
