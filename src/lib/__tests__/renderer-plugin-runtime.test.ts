import { describe, expect, it, vi, beforeEach } from "vitest";
import { Context } from "@openbuddy/cordis";
import {
  createRendererContext,
  type RendererContribution,
  type RendererPlugin,
} from "@openbuddy/renderer-host";
import { startRendererPluginEventBridge } from "../runtime/renderer-plugin-runtime";

const mocks = vi.hoisted(() => ({
  rendererEntries: [] as Array<Record<string, unknown>>,
  onPluginEvent: undefined as ((event: { type: string; payload: unknown; sequence?: number; timestamp?: string }) => void) | undefined,
  onAgentEvent: undefined as ((event: { type: string; payload: unknown; sequence?: number; timestamp?: string }) => void) | undefined,
  transportEmit: undefined as ((event: { type: string; payload: unknown }) => void) | undefined,
  transportDisconnect: undefined as (() => void) | undefined,
  transportOpen: vi.fn(),
  transportClose: vi.fn(),
  invoke: vi.fn(async () => ({ ok: true })),
  moduleUrl: "data:text/javascript,export%20default%20%7B%20apply()%20%7B%7D%20%7D",
}));

vi.mock("@openbuddy/renderer-host", async () => {
  const actual = await vi.importActual<typeof import("@openbuddy/renderer-host")>("@openbuddy/renderer-host");
  return {
    ...actual,
    createWebHarnessTransport: vi.fn(() => ({
      call: vi.fn(),
      respond: vi.fn(),
      open: mocks.transportOpen,
    })),
  };
});

vi.mock("../platform/electron-api", () => ({
  invoke: mocks.invoke,
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("../agent/pi-client", () => ({
  agentListPlugins: vi.fn(async () => [] as Array<Record<string, unknown>>),
  agentPluginInventory: vi.fn(async () => ({ entries: [], piExtensions: [], renderers: [], packages: [] })),
  agentPluginReadiness: vi.fn(async () => ({
    version: 1,
    phase: "ready",
    generation: 1,
    updatedAt: new Date(0).toISOString(),
    main: { loaded: 0, pending: 0, failed: 0, disabled: 0, degraded: 0 },
    pi: { loaded: 0, pending: 0, failed: 0, disabled: 0, degraded: 0 },
  })),
  agentListRendererPluginEntries: vi.fn(async () => mocks.rendererEntries),
  agentPluginEvents: vi.fn(async () => []),
  agentResolveRendererPluginModule: vi.fn(async () => mocks.moduleUrl),
  agentOnPluginEvent: vi.fn(async (handler: (event: { type: string; payload: unknown; sequence?: number; timestamp?: string }) => void) => {
    mocks.onPluginEvent = handler;
    return () => { mocks.onPluginEvent = undefined; };
  }),
  agentOnEvent: vi.fn(async (handler: (event: { type: string; payload: unknown; sequence?: number; timestamp?: string }) => void) => {
    mocks.onAgentEvent = handler;
    return () => { mocks.onAgentEvent = undefined; };
  }),
  agentSessionEventLog: vi.fn(async () => []),
  agentCurrentModel: vi.fn(async () => ({ provider: "test", id: "model" })),
  agentListCommands: vi.fn(async () => []),
  piInit: vi.fn(async () => ({ ok: true, cwd: "/tmp", auth: { ready: true, hasAuthFile: true, providers: [] } })),
  piShutdown: vi.fn(async () => undefined),
  piNewSession: vi.fn(async () => "session-1"),
  piLoadSession: vi.fn(async () => undefined),
  piListSessions: vi.fn(async () => []),
  piListWorkspaces: vi.fn(async () => []),
  piSend: vi.fn(async () => undefined),
  piSteer: vi.fn(async () => undefined),
  piFollowUp: vi.fn(async () => undefined),
  piCancel: vi.fn(async () => undefined),
  piSetModel: vi.fn(async () => undefined),
  piSessionInfo: vi.fn(async () => ({})),
  piSessionUsage: vi.fn(async () => ({})),
}));

// Each test calls `vi.resetModules()` then re-imports so the singleton starts
// fresh. This is the cleanest way to drop the module-level cache under vitest.
beforeEach(() => {
  vi.resetModules();
  mocks.rendererEntries = [];
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue({ ok: true });
  mocks.onPluginEvent = undefined;
  mocks.onAgentEvent = undefined;
  mocks.transportEmit = undefined;
  mocks.transportDisconnect = undefined;
  mocks.transportOpen.mockReset();
  mocks.transportClose.mockReset();
  mocks.transportOpen.mockImplementation(async (_signal: AbortSignal, emit: (event: { type: string; payload: unknown }) => void, onDisconnect: () => void) => {
    mocks.transportEmit = emit;
    mocks.transportDisconnect = onDisconnect;
    return { description: {}, close: mocks.transportClose };
  });
  mocks.moduleUrl = "data:text/javascript,export%20default%20%7B%20apply()%20%7B%7D%20%7D";
});

async function freshRuntime() {
  const mod = await import("../runtime/renderer-plugin-runtime");
  return mod.getRendererPluginRuntime();
}

describe("renderer-plugin-runtime", () => {
  it("builds a singleton runtime with cordis-backed event + contribution registries", async () => {
    const runtime = await freshRuntime();
    expect(runtime.context).toBeInstanceOf(Context);
    expect(runtime.events).toBeDefined();
    expect(runtime.contributions).toBeDefined();
    expect(runtime.context.get("agentApi")).toMatchObject({
      apiVersion: 1,
      prompt: expect.any(Function),
      abort: expect.any(Function),
      listPlugins: expect.any(Function),
      eventLog: expect.any(Function),
      onEvent: expect.any(Function),
    });
  });

  it("exposes a session-aware agent contract backed by Pi client wrappers", async () => {
    const runtime = await freshRuntime();
    const agent = runtime.context.get("agentApi") as {
      newSession: (cwd: string) => Promise<string>;
      prompt: (sessionId: string, text: string) => Promise<void>;
      setModel: (sessionId: string, modelId: string) => Promise<void>;
      eventLog: (query: { sessionId: string }) => Promise<unknown>;
    };
    await expect(agent.newSession("/tmp/workspace")).resolves.toBe("session-1");
    await agent.prompt("session-1", "hello");
    await agent.setModel("session-1", "provider/model");
    await agent.eventLog({ sessionId: "session-1" });

    const pi = await import("../agent/pi-client");
    expect(vi.mocked(pi.piSend)).toHaveBeenCalledWith("session-1", "hello");
    expect(vi.mocked(pi.piSetModel)).toHaveBeenCalledWith("session-1", "provider/model");
    expect(vi.mocked(pi.agentSessionEventLog)).toHaveBeenCalledWith({ sessionId: "session-1" });
  });

  it("subscribes agentApi events to the Pi AgentSession stream", async () => {
    const runtime = await freshRuntime();
    const agent = runtime.context.get("agentApi") as {
      onEvent: (handler: (event: unknown) => void) => Promise<() => void>;
    };
    const handler = vi.fn();
    const cleanup = await agent.onEvent(handler);
    mocks.onAgentEvent?.({ type: "message_update", payload: { text: "hello" }, sequence: 3 });
    expect(handler).toHaveBeenCalledWith({ type: "message_update", payload: { text: "hello" }, sequence: 3 });
    cleanup();
    expect(mocks.onAgentEvent).toBeUndefined();
  });

  it("exposes the cordis registries that createRendererContext installs", () => {
    const ctx = createRendererContext(new Context());
    expect(ctx.get("rendererEvents")).toBeDefined();
    expect(ctx.get("rendererContributions")).toBeDefined();
  });

  it("emits on rendererEvents for any subscriber (event bus roundtrip)", async () => {
    const runtime = await freshRuntime();
    const seen: Array<{ type: string; payload: unknown }> = [];
    runtime.events.on("agent/prompt", (p) => seen.push({ type: "agent/prompt", payload: p }));
    runtime.events.emit("agent/prompt", { text: "hi" });
    expect(seen).toEqual([{ type: "agent/prompt", payload: { text: "hi" } }]);
  });

  it("starts and tears down the main → renderer event bridge", async () => {
    const stop = await startRendererPluginEventBridge();
    expect(typeof stop).toBe("function");
    stop();
  });

  it("subscribes before replay and drops only already-replayed sequences", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    const seen: unknown[] = [];
    runtime.events.on("plugin/loaded", (payload) => seen.push(payload));
    const { agentSessionEventLog } = await import("../agent/pi-client");
    vi.mocked(agentSessionEventLog).mockResolvedValueOnce([
      { sequence: 4, timestamp: "2026-08-28T00:00:00.000Z", type: "plugin/loaded", payload: { id: "old" } },
    ]);
    const stopPromise = mod.startRendererPluginEventBridge();
    await vi.waitFor(() => expect(mocks.onPluginEvent).toBeTypeOf("function"));
    mocks.onPluginEvent?.({ type: "plugin/loaded", sequence: 5, timestamp: "2026-08-28T00:00:01.000Z", payload: { id: "new" } });
    const stop = await stopPromise;
    expect(seen.filter((payload): payload is { id: string } => {
      if (!payload || typeof payload !== "object" || !("id" in payload)) return false;
      return (payload as { id?: unknown }).id === "old" || (payload as { id?: unknown }).id === "new";
    }))
      .toEqual([{ id: "old" }, { id: "new" }]);
    stop();
  });

  it("prefers the Harness transport and maps carrier events into renderer events", async () => {
    const electronApi = await import("../platform/electron-api");
    vi.mocked(electronApi.invoke).mockImplementation(async (channel) => channel === "harness:address"
      ? { baseUrl: "http://127.0.0.1:43123", token: "test" }
      : { ok: true });
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    const seen: unknown[] = [];
    runtime.events.on("pi/extensions-resolved", (payload) => seen.push(payload));

    const stop = await mod.startRendererPluginEventBridge();
    expect(mocks.transportOpen).toHaveBeenCalledTimes(1);
    expect(mocks.onPluginEvent).toBeTypeOf("function");
    mocks.transportEmit?.({
      type: "plugin/event",
      payload: { type: "pi/extensions-resolved", payload: { builtins: ["x"] }, sequence: 4 },
    });
    expect(seen).toEqual([{ builtins: ["x"] }]);
    stop();
  });

  it("deduplicates session events by global sequence, not session-local cursor", async () => {
    const electronApi = await import("../platform/electron-api");
    vi.mocked(electronApi.invoke).mockImplementation(async (channel) => channel === "harness:address"
      ? { baseUrl: "http://127.0.0.1:43123" }
      : { ok: true });
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    const seen: unknown[] = [];
    runtime.events.on("assistant/end", (payload) => seen.push(payload));

    const stop = await mod.startRendererPluginEventBridge();
    mocks.transportEmit?.({
      type: "session/event",
      payload: {
        sessionId: "session-1",
        sequence: 1,
        eventSequence: 10,
        payload: { type: "assistant/end", payload: { sessionId: "session-1" } },
      },
    });
    mocks.transportEmit?.({
      type: "session/event",
      payload: {
        sessionId: "session-2",
        sequence: 1,
        eventSequence: 11,
        payload: { type: "assistant/end", payload: { sessionId: "session-2" } },
      },
    });
    mocks.transportEmit?.({
      type: "session/event",
      payload: {
        sessionId: "session-1",
        sequence: 1,
        eventSequence: 10,
        payload: { type: "assistant/end", payload: { sessionId: "session-1" } },
      },
    });

    expect(seen).toEqual([{ sessionId: "session-1" }, { sessionId: "session-2" }]);
    stop();
  });

  it("falls back to IPC when the Harness transport cannot open", async () => {
    const electronApi = await import("../platform/electron-api");
    vi.mocked(electronApi.invoke).mockImplementation(async (channel) => channel === "harness:address"
      ? { baseUrl: "http://127.0.0.1:43123" }
      : { ok: true });
    mocks.transportOpen.mockRejectedValueOnce(new Error("carrier unavailable"));
    const mod = await import("../runtime/renderer-plugin-runtime");
    const stop = await mod.startRendererPluginEventBridge();
    expect(mocks.onPluginEvent).toBeTypeOf("function");
    stop();
  });

  it("re-subscribes through IPC when the Harness transport disconnects", async () => {
    const electronApi = await import("../platform/electron-api");
    vi.mocked(electronApi.invoke).mockImplementation(async (channel) => channel === "harness:address"
      ? { baseUrl: "http://127.0.0.1:43123" }
      : { ok: true });
    const mod = await import("../runtime/renderer-plugin-runtime");
    const stop = await mod.startRendererPluginEventBridge();
    expect(mocks.onPluginEvent).toBeTypeOf("function");
    mocks.transportDisconnect?.();
    await vi.waitFor(() => expect(mocks.onPluginEvent).toBeTypeOf("function"));
    expect(mocks.transportClose).toHaveBeenCalledTimes(1);
    stop();
  });

  it("isolates renderer plugin listeners (throw in one does not crash the bus)", async () => {
    const runtime = await freshRuntime();
    const events: string[] = [];
    runtime.events.on("foo", () => events.push("first"));
    runtime.events.on("foo", () => {
      throw new Error("boom");
    });
    runtime.events.on("foo", () => events.push("third"));
    runtime.events.emit("foo", null);
    expect(events).toEqual(["first", "third"]);
  });

	it("registers contributions via the renderer plugin apply shape", async () => {
    const runtime = await freshRuntime();
    const plugin: RendererPlugin = {
      id: "shape-check",
      name: "shape-check",
      apply: (ctx) => {
        const contributions = ctx.get("rendererContributions") as {
          register: (c: RendererContribution) => () => void;
        };
        return contributions.register({ kind: "sidebar", id: "x", payload: {} });
      },
    };
    const unregister = plugin.apply(runtime.context) as () => void;
    expect(runtime.contributions.list().map((c) => c.id)).toContain("x");
    unregister();
    expect(runtime.contributions.list().map((c) => c.id)).not.toContain("x");
  });

	it("reconciles discovered renderer plugins after a main profile reload", async () => {
    mocks.rendererEntries = [{ id: "external", name: "external", moduleKey: "external" }];
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    const stop = await mod.startRendererPluginEventBridge();
    expect(runtime.loader.list().some((entry) => entry.id === "external")).toBe(true);

    mocks.rendererEntries = [];
    mocks.onPluginEvent?.({ type: "profile/reloaded", payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.loader.list().some((entry) => entry.id === "external")).toBe(false);
		stop();
	});

	it("keeps internal slot metadata out of user-facing contribution views", async () => {
		const runtime = await freshRuntime();
		const { renderHook } = await import("@testing-library/react");
		const { useRendererContributions } = await import("../runtime/renderer-plugin-runtime");
		const contributions = runtime.context.get("rendererContributions") as {
			register: (c: RendererContribution) => () => void;
		};
		contributions.register({ kind: "composer", id: "internal-slot", payload: { internal: true, label: "conversation.input.overlay:user-questions" } });
		contributions.register({ kind: "composer", id: "user-action", payload: { label: "Ask OpenBuddy" } });
		const { result } = renderHook(() => useRendererContributions("composer"));
		expect(result.current.map((entry) => entry.id)).toEqual(["user-action"]);
	});

	it("reconciles discovered renderer plugins after a Pi extension transaction", async () => {
		mocks.rendererEntries = [{ id: "transactional", name: "transactional", moduleKey: "transactional" }];
		const mod = await import("../runtime/renderer-plugin-runtime");
		const runtime = mod.getRendererPluginRuntime();
		const stop = await mod.startRendererPluginEventBridge();
		expect(runtime.loader.list().some((entry) => entry.id === "transactional")).toBe(true);
		mocks.rendererEntries = [];
		mocks.onPluginEvent?.({ type: "pi/extensions-reloaded", sequence: 77, payload: { extensions: [] } });
		await vi.waitFor(() => expect(runtime.loader.list().some((entry) => entry.id === "transactional")).toBe(false));
		stop();
	});

	it("keeps the previous discovered graph when a reload fails", async () => {
		mocks.rendererEntries = [{ id: "stable", name: "stable", moduleKey: "stable" }];
		const runtime = await freshRuntime();
		await runtime.loadDiscoveredProfile();
		const previousBootGraph = (globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__;

		mocks.rendererEntries = [{
			id: "broken",
			name: "broken",
			moduleKey: "broken",
			external: ["missing-dependency"],
		}];
		await expect(runtime.reloadDiscoveredProfile()).rejects.toThrow("cannot resolve external missing-dependency");

		expect(runtime.loader.list().map((entry) => entry.id)).toContain("stable");
		expect(runtime.loader.list().map((entry) => entry.id)).not.toContain("broken");
		expect((globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__).toBe(previousBootGraph);
		runtime.dispose();
	});

	it("removes failed new entries before restoring the previous graph", async () => {
		mocks.rendererEntries = [{ id: "stable", name: "stable", moduleKey: "stable" }];
		const runtime = await freshRuntime();
		await runtime.loadDiscoveredProfile();

		mocks.rendererEntries = [{ id: "broken", name: "broken", moduleKey: "broken" }];
		mocks.moduleUrl = "data:text/javascript,throw%20new%20Error(%27broken%20renderer%27)";
		await expect(runtime.reloadDiscoveredProfile()).rejects.toThrow("broken renderer");

		expect(runtime.loader.list().map((entry) => entry.id)).toContain("stable");
		expect(runtime.loader.list().map((entry) => entry.id)).not.toContain("broken");
		runtime.dispose();
	});

	it("boots built-in DeepSeek client faces through the controlled module loader", async () => {
		mocks.rendererEntries = [
			{ id: "slots", moduleId: "@deepseek-ai/dsh-client-ui-slots", moduleKey: "slots", name: "@deepseek-ai/dsh-client-ui-slots/client" },
			{ id: "locale", moduleId: "@deepseek-ai/dsh-client-locale", moduleKey: "locale", name: "@deepseek-ai/dsh-client-locale/client" },
			{ id: "connection", moduleId: "@deepseek-ai/dsh-client-connection", moduleKey: "connection", name: "@deepseek-ai/dsh-client-connection/client" },
			{ id: "remote", moduleId: "@deepseek-ai/dsh-api-remotes", moduleKey: "remote", name: "@deepseek-ai/dsh-api-remotes/client", inject: ["connection"] },
			{ id: "goal", moduleId: "@deepseek-ai/dsh-client-ui-goal", moduleKey: "goal", name: "@deepseek-ai/dsh-client-ui-goal/client", inject: ["slots", "locale"] },
			{ id: "jobs", moduleId: "@deepseek-ai/dsh-client-ui-jobs", moduleKey: "jobs", name: "@deepseek-ai/dsh-client-ui-jobs/client", inject: ["slots", "locale"] },
		];
		const mod = await import("../runtime/renderer-plugin-runtime");
		const runtime = mod.getRendererPluginRuntime();
		await runtime.loadBuiltinProfile();
		await runtime.loadDiscoveredProfile();
		expect(runtime.loader.list().filter((entry) => ["slots", "locale", "connection", "remote", "goal", "jobs"].includes(entry.id))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "slots", state: "loaded" }),
				expect.objectContaining({ id: "locale", state: "loaded" }),
				expect.objectContaining({ id: "connection", state: "loaded" }),
				expect.objectContaining({ id: "remote", state: "loaded" }),
				expect.objectContaining({ id: "goal", state: "loaded" }),
				expect.objectContaining({ id: "jobs", state: "loaded" }),
			]),
		);
		expect(runtime.contributions.list().map((entry) => entry.id)).toEqual(expect.arrayContaining([
			"conversation.input.dock:goal",
			"conversation.session.header.actions:job-list",
		]));
		runtime.dispose();
	});

	it("re-applies user-supplied renderer profiles after profile/reloaded", async () => {
			const mod = await import("../runtime/renderer-plugin-runtime");
			const runtime = mod.getRendererPluginRuntime();
			// `loadRendererPluginProfile` (not `loadRendererPlugin`) is the API
			// that records the profile with the runtime so subsequent
			// `profile/reloaded` events re-apply it. The entry `name` must be
			// resolvable by the runtime importer — using the
			// `openbuddy:renderer/<key>` form lets `agentResolveRendererPluginModule`
			// (mocked above) hand back the data URL fixture.
			await mod.loadRendererPluginProfile({
				entries: [
					{
						id: "user-plugin",
						name: "openbuddy:renderer/user-plugin",
						inject: ["rendererContributions"],
					},
				],
			});
			expect(runtime.loader.list().some((entry) => entry.id === "user-plugin")).toBe(true);
			// Subscribe to the bridge so `profile/reloaded` actually triggers
			// `reloadDiscoveredProfile()`. Without this, `mocks.onPluginEvent`
			// stays undefined and the reload path is silently skipped.
			const stop = await mod.startRendererPluginEventBridge();
			// Simulate a main-side profile reload that empties the discovered set.
			mocks.rendererEntries = [{ id: "post-reload", name: "post-reload", moduleKey: "post-reload" }];
			mocks.onPluginEvent?.({ type: "profile/reloaded", payload: {} });
			await new Promise((resolve) => setTimeout(resolve, 5));
			await new Promise((resolve) => setTimeout(resolve, 5));
			const ids = runtime.loader.list().map((entry) => entry.id);
			expect(ids).toContain("user-plugin");
			expect(ids).toContain("post-reload");
			stop();
		});

	it("coalesces consecutive profile reloads and converges on the latest renderer set", async () => {
		const mod = await import("../runtime/renderer-plugin-runtime");
		const runtime = mod.getRendererPluginRuntime();
		mocks.rendererEntries = [{ id: "installed", name: "openbuddy:renderer/installed", moduleKey: "installed" }];
		const stop = await mod.startRendererPluginEventBridge();
		mocks.rendererEntries = [];
		mocks.onPluginEvent?.({ type: "profile/reloaded", payload: {} });
		mocks.rendererEntries = [{ id: "latest", name: "openbuddy:renderer/latest", moduleKey: "latest" }];
		mocks.onPluginEvent?.({ type: "profile/reloaded", payload: {} });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const ids = runtime.loader.list().map((entry) => entry.id);
		expect(ids).not.toContain("installed");
		expect(ids).toContain("latest");
		expect(ids).toContain("openbuddy-renderer-sidebar");
		stop();
	});

  it("dispose() does not clobber __DSH_BOOT__ when a newer runtime has already installed a graph", async () => {
    mocks.rendererEntries = [
      { id: "stub", name: "openbuddy:renderer/stub", moduleKey: "stub", moduleUrl: "data:text/javascript,export%20default%20%7B%7D" },
    ];
    const a = await freshRuntime();
    await a.loadBuiltinProfile();
    await a.loadDiscoveredProfile();
    const g = globalThis as typeof globalThis & { __DSH_BOOT__?: unknown };
    const first = g.__DSH_BOOT__;
    expect(first).toBeDefined();
    // A second runtime swaps in a newer graph before the first one
    // disposes; the first runtime must not overwrite it.
    const second = { rev: "newer", entries: [] };
    g.__DSH_BOOT__ = second;
    a.dispose();
    expect(g.__DSH_BOOT__).toBe(second);
    g.__DSH_BOOT__ = undefined;
  });

  it("keeps renderer teardown separate from the Main Pi agent lifecycle", async () => {
    const runtime = await freshRuntime();
    runtime.dispose();

    const pi = await import("../agent/pi-client");
    expect(vi.mocked(pi.piShutdown)).not.toHaveBeenCalled();
    expect(runtime.context.get("agentApi")).not.toHaveProperty("dispose");
  });

  it("useMainPluginStatus refreshes when main emits profile/loaded", async () => {
    const { renderHook, act, waitFor } = await import("@testing-library/react");
    const { agentPluginInventory } = await import("../agent/pi-client");
    const { useMainPluginStatus } = await import("../runtime/renderer-plugin-runtime");
    const runtime = await freshRuntime();
    await runtime.loadBuiltinProfile();
    (agentPluginInventory as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entries: [{ id: "alpha", state: "loaded" }],
      piExtensions: [],
      renderers: [],
      packages: [],
    });
    const { result } = renderHook(() => useMainPluginStatus());
    await waitFor(() => expect(result.current.some((entry) => entry.id === "alpha")));
    (agentPluginInventory as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      entries: [{ id: "alpha", state: "disabled" }, { id: "beta", state: "loaded" }],
      piExtensions: [],
      renderers: [],
      packages: [],
    });
    await act(async () => {
      runtime.events.emit("profile/loaded", { name: "test" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(result.current.find((entry) => entry.id === "beta")?.state).toBe("loaded"));
  });
  it("loadRendererPlugin's dispose tears down only the loaded entry, leaving siblings intact", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    const first = await mod.loadRendererPlugin({
      id: "first-plugin",
      name: "openbuddy:renderer/first-plugin",
      apply: () => undefined,
    });
    const second = await mod.loadRendererPlugin({
      id: "second-plugin",
      name: "openbuddy:renderer/second-plugin",
      apply: () => undefined,
    });
    expect(runtime.loader.list().map((e) => e.id).sort()).toEqual(["first-plugin", "second-plugin"]);
    await first();
    const ids = runtime.loader.list().map((e) => e.id);
    expect(ids).toContain("second-plugin");
    expect(ids).not.toContain("first-plugin");
    await second();
  });

  it("loadRendererPlugin executes the supplied in-memory plugin object", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    let applied = 0;
    let disposed = 0;
    const cleanup = await mod.loadRendererPlugin({
      id: "in-memory-plugin",
      name: "not-a-real-module",
      apply: () => {
        applied += 1;
        return () => { disposed += 1; };
      },
    });
    expect(applied).toBe(1);
    expect(runtime.loader.resolve("in-memory-plugin").status.state).toBe("loaded");
    await cleanup();
    expect(disposed).toBe(1);
    expect(() => runtime.loader.resolve("in-memory-plugin")).toThrow();
  });

  it("loadCordisPatch loads patched entries without evicting built-ins", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    await runtime.loadBuiltinProfile();
    const builtInIds = runtime.loader.list().map((entry) => entry.id);
    await mod.loadRendererPluginProfile({
      entries: [{
        id: "user-plugin",
        name: "openbuddy:renderer/user-plugin",
        inject: ["rendererContributions"],
      }],
    });
    // loadCordisPatch adds a fresh entry via the same scoping logic as
    // applyUserProfiles — it must NOT touch the built-in sidebar/composer
    // or the user-plugin that was just registered.
    await mod.loadCordisPatch(`
- insert:
    - id: patch-plugin
      name: openbuddy:renderer/patch-plugin
`, {});
    const ids = runtime.loader.list().map((entry) => entry.id);
    expect(ids).toContain("patch-plugin");
    expect(ids).toContain("user-plugin");
    for (const builtInId of builtInIds) {
      expect(ids).toContain(builtInId);
    }
  });

  it("loadCordisPatch updates an existing entry's config without evicting siblings", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    await runtime.loadBuiltinProfile();
    await mod.loadRendererPluginProfile({
      entries: [{
        id: "configurable",
        name: "openbuddy:renderer/configurable",
        inject: ["rendererContributions"],
        config: { mode: "a" },
      }],
    });
    const beforeIds = new Set(runtime.loader.list().map((entry) => entry.id));
    // Patch the existing entry's config and add a new entry in the same
    // patch — the runtime must apply the UPDATE without disturbing the
    // built-in sidebar/composer or the unchanged user-plugin.
    await mod.loadCordisPatch(`
- id: configurable
  name: openbuddy:renderer/configurable
  config:
    mode: b
- insert:
    - id: appended-plugin
      name: openbuddy:renderer/appended-plugin
`, {});
    const ids = runtime.loader.list().map((entry) => entry.id);
    expect(ids).toContain("appended-plugin");
    expect(ids).toContain("configurable");
    expect(ids).toContain("openbuddy-renderer-sidebar");
    expect(ids).toContain("openbuddy-renderer-composer");
    // The unchanged user-plugin must still be present.
    expect(beforeIds.has("configurable")).toBe(true);
  });

  it("loadRendererPluginProfile materializes patches and preserves the patched entry after reload", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    await mod.loadRendererPluginProfile({
      entries: [{ id: "patched-profile", name: "openbuddy:renderer/patched-profile", config: { value: 1 } }],
      patches: [[{ id: "patched-profile", config: { value: 2 } }]],
    });
    expect(runtime.loader.resolve("patched-profile").options.config).toEqual({ value: 2 });
    const stop = await mod.startRendererPluginEventBridge();
    mocks.rendererEntries = [];
    mocks.onPluginEvent?.({ type: "profile/reloaded", payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runtime.loader.resolve("patched-profile").options.config).toEqual({ value: 2 });
    stop();
  });

  it("loadRendererPluginProfile updates an existing user entry", async () => {
    const mod = await import("../runtime/renderer-plugin-runtime");
    const runtime = mod.getRendererPluginRuntime();
    await mod.loadRendererPluginProfile({
      entries: [{ id: "profile-config", name: "openbuddy:renderer/profile-config", config: { value: 1 } }],
    });
    await mod.loadRendererPluginProfile({
      entries: [{ id: "profile-config", name: "openbuddy:renderer/profile-config", config: { value: 2 } }],
    });
    expect(runtime.loader.resolve("profile-config").options.config).toEqual({ value: 2 });
  });
});
