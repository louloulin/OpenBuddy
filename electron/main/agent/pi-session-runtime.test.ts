import { describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentSessionEvent, ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { PiSessionRuntime, type PiSessionRuntimeFactory } from "./pi-session-runtime";

type FakeSession = AgentSession & {
  emit: (event: AgentSessionEvent) => void;
  abortCalls: number;
  disposeCalls: number;
  bindCoreCalls: number;
};

function createFakeSession(id: string): FakeSession {
  const handlers = new Set<(event: AgentSessionEvent) => void>();
  const session = {
    sessionId: id,
    abortCalls: 0,
    disposeCalls: 0,
    bindCoreCalls: 0,
    subscribe: (handler: (event: AgentSessionEvent) => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emit: (event: AgentSessionEvent) => {
      for (const handler of [...handlers]) handler(event);
    },
    abort: async () => { session.abortCalls += 1; },
    dispose: () => { session.disposeCalls += 1; },
    extensionRunner: {
      bindCore: () => { session.bindCoreCalls += 1; },
    } as unknown as ExtensionRunner,
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

  it("drops events from the replaced session and disposes both generations", async () => {
    const first = createFakeSession("first");
    const second = createFakeSession("second");
    const runtime = new PiSessionRuntime({ factory: factory([first, second]) });
    await runtime.create({});
    const received: string[] = [];
    runtime.subscribe((event, session) => received.push(`${session.sessionId}:${event.type}`));
    const firstGeneration = runtime.currentGeneration;

    await runtime.replace({});
    expect(runtime.currentGeneration).toBeGreaterThan(firstGeneration);
    first.emit({ type: "agent_end" } as AgentSessionEvent);
    second.emit({ type: "agent_start" } as AgentSessionEvent);
    await runtime.dispose({ abort: false });
    second.emit({ type: "agent_end" } as AgentSessionEvent);

    expect(received).toEqual(["second:agent_start"]);
    expect(first.disposeCalls).toBe(1);
    expect(second.disposeCalls).toBe(1);
    expect(runtime.currentGeneration).toBeGreaterThan(firstGeneration + 1);
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

describe("PiSessionRuntime (Phase B.2 — bindCore integration)", () => {
  function makeHostBridge() {
    return {
      prompt: vi.fn(async () => true),
      setModel: vi.fn(async () => undefined),
      getModel: vi.fn(() => ({ id: "test-model" })),
      getSession: vi.fn(() => ({ sessionId: "test-session" })),
      abort: vi.fn(async () => undefined),
    };
  }

  it("does NOT call bindCore when no hostBridge is installed (backward compat)", async () => {
    const first = createFakeSession("first");
    const runtime = new PiSessionRuntime({ factory: factory([first]) });
    await runtime.create({});
    expect(first.bindCoreCalls).toBe(0);
  });

  it("calls bindCore on the new session when hostBridge is preinstalled", async () => {
    const first = createFakeSession("first");
    const hostBridge = makeHostBridge();
    const runtime = new PiSessionRuntime({
      factory: factory([first]),
      hostBridge,
    });
    await runtime.create({});
    expect(first.bindCoreCalls).toBe(1);
  });

  it("calls bindCore on the replacement session too (not just the first)", async () => {
    const first = createFakeSession("first");
    const second = createFakeSession("second");
    const runtime = new PiSessionRuntime({
      factory: factory([first, second]),
      hostBridge: makeHostBridge(),
    });
    await runtime.create({});
    expect(first.bindCoreCalls).toBe(1);
    await runtime.replace({});
    expect(second.bindCoreCalls).toBe(1);
  });

  it("installHostBridge binds immediately when a session is already active", async () => {
    const first = createFakeSession("first");
    const runtime = new PiSessionRuntime({ factory: factory([first]) });
    await runtime.create({});
    expect(first.bindCoreCalls).toBe(0);

    runtime.installHostBridge(makeHostBridge());
    expect(first.bindCoreCalls).toBe(1);
  });

  it("installHostBridge is a no-op for bindCore when no session is active", () => {
    const runtime = new PiSessionRuntime({ factory: factory([]) });
    // No throw; bindCoreIfReady short-circuits when current is null.
    expect(() => runtime.installHostBridge(makeHostBridge())).not.toThrow();
  });

  it("logs but does not throw when bindCore fails", async () => {
    const first = createFakeSession("first");
    // Force the bindCore to throw.
    first.extensionRunner.bindCore = () => { throw new Error("boom"); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = new PiSessionRuntime({
      factory: factory([first]),
      hostBridge: makeHostBridge(),
    });
    await expect(runtime.create({})).resolves.toBe(first);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("PiSessionRuntime (Phase 5 — reload listener leak gate)", () => {
  it("20 sequential session replacements keep the active subscription set at exactly one handler", async () => {
    // Pre-build 21 sessions so create + 20 replaces is fully covered.
    const sessions = Array.from({ length: 21 }, (_, i) => createFakeSession(`session-${i}`));
    const runtime = new PiSessionRuntime({ factory: factory(sessions) });
    await runtime.create({});

    // Track every event the *active* subscriber actually receives.
    const received: string[] = [];
    runtime.subscribe((event, session) => received.push(`${session.sessionId}:${event.type}`));

    // Establish the baseline: the session created above is live.
    (runtime.session as FakeSession).emit({ type: "agent_start" } as AgentSessionEvent);

    for (let i = 0; i < 20; i += 1) {
      await runtime.replace({});
      const live = runtime.session as FakeSession;
      live.emit({ type: "agent_start" } as AgentSessionEvent);
    }

    // 21 distinct agent_start events — one per session, none duplicated.
    expect(received).toHaveLength(21);
    expect(new Set(received).size).toBe(21);

    // Every replaced session must have been disposed exactly once (no orphan
    // sessions left holding their subscription set alive).
    for (const session of sessions) {
      expect(session.disposeCalls).toBe(1);
      expect(session.abortCalls).toBe(1);
    }

    await runtime.dispose({ abort: false });
  });

  it("unsubscribe before replacement leaves the new session with zero subscribers", async () => {
    const sessions = [createFakeSession("first"), createFakeSession("second")];
    const runtime = new PiSessionRuntime({ factory: factory(sessions) });
    await runtime.create({});
    const received: string[] = [];
    const unsubscribe = runtime.subscribe((event, session) => received.push(session.sessionId));
    unsubscribe();
    await runtime.replace({});
    const live = runtime.session as FakeSession;
    live.emit({ type: "agent_start" } as AgentSessionEvent);
    expect(received).toEqual([]);
  });
});
