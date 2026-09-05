import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Context } from "@openbuddy/cordis";
import { ClientModuleSystem, createDeepSeekClientCompatibilityModules, DeepSeekLayoutController, DeepSeekSessionsService, DeepSeekSlotRegistry, DeepSeekThemeService, DeepSeekWorkspaceService, RendererContributionRegistry, RendererPluginLoader, createRendererContext, DeepSeekSlotCore, type RendererAgentEvent } from "./index";

describe("RendererPluginLoader", () => {
  it("serializes concurrent load and dispose without disposing a half-started plugin", async () => {
    const ctx = createRendererContext(new Context());
    let releaseApply!: () => void;
    const applied = new Promise<void>((resolve) => { releaseApply = resolve; });
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const lifecycle: string[] = [];
    const plugin = {
      name: "slow",
      apply: async () => {
        lifecycle.push("apply:start");
        resolveStarted();
        await applied;
        lifecycle.push("apply:end");
        return () => { lifecycle.push("cleanup"); };
      },
    };
    const loader = new RendererPluginLoader(ctx, async () => plugin);
    const loading = loader.load([{ id: "slow", name: "slow" }]);
    const disposing = loader.dispose();
    await started;
    expect(lifecycle).toEqual(["apply:start"]);
    releaseApply();
    await Promise.all([loading, disposing]);
    expect(lifecycle).toEqual(["apply:start", "apply:end", "cleanup"]);
    expect(loader.list()).toEqual([]);
  });

  it("cleans effects registered before a failed apply", async () => {
    const context = createRendererContext(new Context());
    let disposed = 0;
    const loader = new RendererPluginLoader(context, async () => ({
      apply: (ctx: Context) => {
        ctx.effect(() => () => { disposed += 1; });
        throw new Error("apply failed after registration");
      },
    }));

    await expect(loader.load([{ id: "broken", name: "broken" }])).rejects.toThrow("apply failed after registration");
    expect(disposed).toBe(1);
    expect(loader.list()).toEqual([]);
  });

  it("resolves standard DeepSeek Harness client subpaths", () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    expect(modules["@deepseek-ai/dsh-session/types"]).toMatchObject({ SessionId: expect.any(Function), SESSION_FORMAT_VERSION: 0 });
    expect(modules["@deepseek-ai/dsh-session/surface"]).toMatchObject({
      isSurfaceEligibleType: expect.any(Function),
      isSurfaceEvent: expect.any(Function),
      foldSurface: expect.any(Function),
    });
    expect(modules["@deepseek-ai/dsh-session-query/types"]).toMatchObject({ SessionSearchCursor: expect.any(Function) });
    expect(modules["@deepseek-ai/dsh-workspace/client"]).toMatchObject({ WorkspaceId: expect.any(Function) });
    expect(modules["@deepseek-ai/dsh-api-gateway/client"]).toMatchObject({ apply: expect.any(Function) });
    expect(modules["@deepseek-ai/dsh-api-remotes/client"]).toMatchObject({ apply: expect.any(Function) });
    for (const specifier of [
      "@deepseek-ai/dsh-client-runtime/client",
      "@deepseek-ai/dsh-client-ui-attachment/client",
      "@deepseek-ai/dsh-client-ui-deliverables/client",
      "@deepseek-ai/dsh-client-ui-input-trigger/client",
      "@deepseek-ai/dsh-client-ui-message-feedback/client",
      "@deepseek-ai/dsh-client-ui-subagent/client",
      "@deepseek-ai/dsh-client-ui-user-questions/client",
      "@deepseek-ai/dsh-client-ui-trajectory/client",
      "@deepseek-ai/dsh-client-ui-agent-preset/client",
      "@deepseek-ai/dsh-client-ui-settings-plugins/client",
      "@deepseek-ai/dsh-client-ui-settings-plugin-inventory/client",
      "@deepseek-ai/dsh-client-ui-permission-presets/client",
      "@deepseek-ai/dsh-client-ui-directory-picker-native/client",
      "@deepseek-ai/dsh-client-ui-directory-picker-browse/client",
    ]) expect(modules[specifier]).toBeDefined();
  });

  it("provides conversation registries and session scope primitives", () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const runtime = modules["@deepseek-ai/dsh-client-runtime/client"] as {
      ConversationEventRegistry: new () => { register: (definition: { kind: string }) => () => void; entries: () => readonly unknown[] };
      createScope: (ctx: Context, sessionId: string) => { ctx: Context; dispose: () => void };
      scopeOf: (ctx: Context) => string | undefined;
    };
    const registry = new runtime.ConversationEventRegistry();
    const dispose = registry.register({ kind: "fixture" });
    expect(registry.entries()).toHaveLength(1);
    expect(() => registry.register({ kind: "fixture" })).toThrow(/already registered/);
    expect(() => registry.register({ kind: "invalid", target: "chat" })).toThrow(/target and buildViewNode/);
    const fallbackDispose = registry.registerFallback({ kind: "fallback", target: "chat", buildViewNode: () => ({}) });
    expect(registry.fallbackEntry?.()).toMatchObject({ kind: "fallback" });
    fallbackDispose();
    expect(registry.fallbackEntry?.()).toBeUndefined();
    dispose();
    expect(registry.entries()).toHaveLength(0);
    const views = new (runtime as unknown as { ConversationViewRegistry: new () => { register: (definition: { target: string }) => () => void; entries: () => readonly unknown[] } }).ConversationViewRegistry();
    const viewDispose = views.register({ target: "chat" });
    expect(views.entries()).toHaveLength(1);
    expect(() => views.register({ target: "chat" })).toThrow(/already registered/);
    viewDispose();
    const scope = runtime.createScope(new Context(), "s1");
    expect(runtime.scopeOf(scope.ctx)).toBe("s1");
    scope.dispose();
  });

  it("folds the standard session surface operations through the compatibility module", () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const surface = modules["@deepseek-ai/dsh-session/surface"] as {
      foldSurface: (events: readonly unknown[]) => { nodes: number[]; replacements: unknown[] };
    };
    expect(surface.foldSurface([
      { seq: 0, type: "user/message", surfaceOp: "append" },
      { seq: 1, type: "assistant/message", surfaceOp: "append" },
      { seq: 2, type: "assistant/message", surfaceOp: { op: "replace", start: 0, end: 1 } },
    ])).toMatchObject({ nodes: [2], replacements: [{ seq: 2, shadowedSeqs: [0, 1] }] });
  });

  it("provides DeepSeek runtime store and slot-core contracts", () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: (name, props, ...children) => ({ name, props, children }) });
    expect(modules["@deepseek-ai/dsh-client-modules"]).toBe(modules["@deepseek-ai/dsh-client-modules/client"]);
    expect(modules["@deepseek-ai/dsh-client-runtime"]).toBe(modules["@deepseek-ai/dsh-client-runtime/client"]);
    const runtime = modules["@deepseek-ai/dsh-client-runtime/client"] as {
      createSnapshotStore: <T>(value: T) => { getSnapshot: () => T; update: (mutator: (draft: T) => void) => void; subscribe: (listener: () => void) => () => void };
      shallowEqual: (left: unknown, right: unknown) => boolean;
    };
    const store = runtime.createSnapshotStore({ count: 0 });
    let changes = 0;
    store.subscribe(() => { changes += 1; });
    store.update((draft) => { draft.count += 1; });
    expect(store.getSnapshot()).toEqual({ count: 1 });
    expect(changes).toBe(1);
    expect(runtime.shallowEqual({ value: 1 }, { value: 1 })).toBe(true);
    expect(runtime.shallowEqual({ value: 1 }, { value: 2 })).toBe(false);

    const core = new (modules["@deepseek-ai/dsh-client-ui-slots"] as { SlotCore: new () => { register: Function; entries: (name: string) => unknown[]; spec: (name: string) => unknown } }).SlotCore();
    const dispose = core.register({ name: "sidebar.brand", id: "brand", order: 1 }, () => null);
    expect(core.spec("sidebar.brand")).toEqual({ name: "sidebar.brand" });
    expect(core.entries("sidebar.brand")).toHaveLength(1);
    dispose();
    expect(core.entries("sidebar.brand")).toHaveLength(0);
  });

  it("provides public command, conversation, and locale client entry points", () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: (name, props, ...children) => ({ name, props, children }) });
    const commands = modules["@deepseek-ai/dsh-client-ui-commands/client"] as {
      CommandDirectory: new () => { register(value: { name: string }): () => void; list(): unknown[] };
      filterOptions: <T extends { label?: string }>(options: readonly T[], search: string) => readonly T[];
    };
    const directory = new commands.CommandDirectory();
    const dispose = directory.register({ name: "compact" });
    expect(directory.list()).toHaveLength(1);
    expect(commands.filterOptions([{ label: "Compact" }, { label: "Plan" }], "comp")).toEqual([{ label: "Compact" }]);
    dispose();
    expect(directory.list()).toHaveLength(0);
    expect(modules["@deepseek-ai/dsh-client-ui-conversation/client"]).toMatchObject({
      ConversationController: expect.any(Function),
      apply: expect.any(Function),
    });
    expect(modules["@deepseek-ai/dsh-client-locale/client"]).toMatchObject({ FALLBACK_LOCALE: "en" });
  });

  it("loads the built-in DeepSeek client profile through the renderer loader", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        calls.push({ channel, args });
        return { ok: true };
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const importer = async (specifier: string): Promise<unknown> => {
      const module = modules[specifier] ?? modules[specifier.replace(/\/client$/u, "")];
      if (module === undefined) throw new Error(`missing client module ${specifier}`);
      return module;
    };
    const loader = new RendererPluginLoader(context, importer);
    await loader.load([
      { id: "slots", name: "@deepseek-ai/dsh-client-ui-slots/client" },
      { id: "locale", name: "@deepseek-ai/dsh-client-locale/client" },
      { id: "connection", name: "@deepseek-ai/dsh-client-connection/client" },
      { id: "remote", name: "@deepseek-ai/dsh-api-remotes/client", inject: ["connection"] },
      { id: "goal", name: "@deepseek-ai/dsh-client-ui-goal/client", inject: ["slots", "locale"] },
      { id: "skill", name: "@deepseek-ai/dsh-client-ui-skill/client", inject: ["slots", "locale"] },
      { id: "jobs", name: "@deepseek-ai/dsh-client-ui-jobs/client", inject: ["slots", "locale"] },
      { id: "workflow", name: "@deepseek-ai/dsh-client-ui-workflow-run/client", inject: ["slots", "locale"] },
      { id: "settings", name: "@deepseek-ai/dsh-client-ui-settings/client", inject: ["connection", "remote"] },
    ]);
    const contributions = (context.get("rendererContributions") as RendererContributionRegistry).list();
    expect(contributions.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["composer", "message"]));
    expect(contributions.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "conversation.input.dock:goal",
      "tool.call.toolview:skill",
      "conversation.session.header.actions:job-list",
      "conversation.chat.node:workflow-run",
    ]));
    expect(context.get("settingsScope")).toBeDefined();
    expect(calls.filter((call) => call.channel === "dsh:remote-register").length).toBeGreaterThan(0);
    await loader.dispose();
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toEqual([]);
    expect(calls.filter((call) => call.channel === "dsh:remote-unregister").length).toBeGreaterThan(0);
  });

  it("fails loudly when an external dsh-client package is not implemented", async () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const system = new ClientModuleSystem({
      entries: [{ id: "external", name: "@scope/external/client" }],
      staticModules: modules,
      resolveModuleUrl: () => "file:///plugins/external/client.js",
      loadBundle: async () => undefined,
      importModule: async () => ({
        registration: {
          id: "external",
          factory: (require: (specifier: string) => unknown) => ({
          facade: require("@deepseek-ai/dsh-client-ui-hmr/client"),
          }),
        },
      }),
    });
    await expect(system.import("@scope/external/client")).rejects.toThrow("require(@deepseek-ai/dsh-client-ui-hmr/client) missed the module table");
  });

  it("loads and unloads the layout, sidebar, and model-selection client faces", async () => {
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        if (channel === "agent:providers-list") return { providers: [{ id: "pi", name: "Pi" }], models: [{ providerId: "pi", modelId: "deepseek-chat", name: "DeepSeek Chat" }] };
        if (channel === "agent:set-model") return { ok: true, args };
        return { ok: true };
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const connection = modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown };
    const layout = modules["@deepseek-ai/dsh-client-ui-layout/client"] as { apply: (ctx: Context) => unknown };
    const sidebar = modules["@deepseek-ai/dsh-client-ui-sidebar/client"] as { apply: (ctx: Context) => unknown };
    const commands = modules["@deepseek-ai/dsh-client-ui-commands/client"] as { apply: (ctx: Context) => unknown };
    const model = modules["@deepseek-ai/dsh-client-ui-model-selection/client"] as { apply: (ctx: Context) => unknown };
    const slotsModule = modules["@deepseek-ai/dsh-client-ui-slots/client"] as { apply: (ctx: Context) => unknown };
    connection.apply(context);
    slotsModule.apply(context);
    commands.apply(context);
    await context.start();
    const layoutCleanup = layout.apply(context) as (() => void) | undefined;
    const sidebarCleanup = sidebar.apply(context) as (() => void) | undefined;
    const modelCleanup = model.apply(context) as (() => void) | undefined;
    const slots = context.get("slots") as DeepSeekSlotRegistry;
    expect(slots.entries("root")).toHaveLength(1);
    expect(slots.entries("sidebar")).toHaveLength(1);
    const commandUi = context.get("commandUi") as { get: (name: string) => { ui?: { options: () => Promise<unknown> } } | undefined };
    const command = commandUi.get("model");
    await expect(command?.ui?.options()).resolves.toEqual([{ provider: "pi", name: "Pi", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }] }]);
    (context.get("layout") as { toggleSidebar: () => void }).toggleSidebar();
    expect((context.get("layout") as { getSnapshot: () => { sidebarCollapsed: boolean } }).getSnapshot().sidebarCollapsed).toBe(true);
    modelCleanup?.();
    sidebarCleanup?.();
    layoutCleanup?.();
    expect(slots.entries("root")).toHaveLength(0);
    expect(slots.entries("sidebar")).toHaveLength(0);
    expect(commandUi.get("model")).toBeUndefined();
  });

  it("exposes the workspace client facade and removes its slots on cleanup", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        calls.push({ channel, args });
        if (channel === "dsh:rpc") {
          const request = args as { method?: string };
          if (request.method === "session.create") return { rpcId: "session-create", result: { ok: true, value: { sessionId: "s2", cwd: "/workspace" } } };
          const method = args && typeof args === "object" && typeof (args as { method?: unknown }).method === "string" ? (args as { method: string }).method : "";
          if (method === "workspace.create") return { rpcId: "workspace-create", result: { ok: true, value: { workspace: { workspaceId: "w2", path: "/new" }, created: true } } };
          return { rpcId: `rpc-${method}`, result: { ok: true, value: { items: [{ workspaceId: "w1", path: "/workspace", sessionIds: ["s1"] }] } } };
        }
        if (channel === "agent:load-session") return { ok: true };
        return { ok: true };
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const slots = modules["@deepseek-ai/dsh-client-ui-slots/client"] as { apply: (ctx: Context) => unknown };
    const connection = modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown };
    const runtime = modules["@deepseek-ai/dsh-client-runtime/client"] as { apply: (ctx: Context) => unknown };
    const workspace = modules["@deepseek-ai/dsh-client-ui-workspace/client"] as { apply: (ctx: Context) => unknown };
    slots.apply(context);
    connection.apply(context);
    runtime.apply(context);
    await context.start();
    const cleanup = workspace.apply(context) as (() => void) | undefined;
    const service = context.get("workspaces") as { list: () => Promise<unknown>; create: (path: string) => Promise<unknown>; startSession: (workspaceId?: string) => Promise<unknown>; open: (sessionId: string) => Promise<unknown> };
    await expect(service.list()).resolves.toEqual([{ workspaceId: "w1", path: "/workspace", sessionIds: ["s1"] }]);
    await expect(service.create("/new")).resolves.toEqual({ workspaceId: "w2", path: "/new" });
    await expect(service.startSession("w1")).resolves.toBe("s2");
    expect(calls).toEqual(expect.arrayContaining([
      { channel: "dsh:rpc", args: expect.objectContaining({ method: "session.create", payload: { workspaceId: "w1", cwd: "/workspace" } }) },
    ]));
    await service.open("s1");
    expect(calls.map((call) => call.channel)).toEqual(expect.arrayContaining(["dsh:rpc", "agent:load-session"]));
    expect((context.get("slots") as DeepSeekSlotRegistry).entries("sidebar.workspaces")).toHaveLength(1);
    cleanup?.();
    expect((context.get("slots") as DeepSeekSlotRegistry).entries("sidebar.workspaces")).toHaveLength(0);
  });

  it("exposes Harness session bindings, scopes, projections, and behavior verbs", async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        if (channel === "dsh:rpc") {
          const request = args as { method?: string; payload?: unknown };
          const method = request.method ?? "";
          calls.push({ method, payload: request.payload });
          if (method === "host.describe") return { rpcId: "describe", result: { ok: true, value: { product: "OpenBuddy", runtime: "pi" } } };
          if (method === "session.list") return { rpcId: method, result: { ok: true, value: { items: [{ sessionId: "s1", cwd: "/workspace", title: "Demo" }] } } };
          if (method === "session.history") return { rpcId: method, result: { ok: true, value: { entries: [{ sequence: 1, type: "assistant/end", text: "ready" }], hasMore: false } } };
          if (method === "subagent.list") {
            const parentSessionId = (request.payload as { parentSessionId?: string }).parentSessionId;
            const child = parentSessionId === "child-1"
              ? { kind: "child", id: "child-2", activity: "inactive", mode: "continuable", label: "Nested", hasChildren: false }
              : { kind: "child", id: "child-1", activity: "inactive", mode: "continuable", label: "Research", hasChildren: true };
            return { rpcId: method, result: { ok: true, value: { entries: [child], parentAvailable: true } } };
          }
          if (method === "subagent.history") {
            const childSessionId = (request.payload as { childSessionId?: string }).childSessionId;
            return { rpcId: method, result: { ok: true, value: { entries: [{ sequence: childSessionId === "child-2" ? 3 : 2, type: "assistant/end", text: childSessionId === "child-2" ? "nested-ready" : "child-ready" }], hasMore: false } } };
          }
          if (method === "subagent.prompt") return { rpcId: method, result: { ok: true, value: { messageId: "message-1" } } };
          if (method === "session.rename") return { rpcId: method, result: { ok: true, value: { title: "Renamed", seq: 2 } } };
          return { rpcId: method, result: { ok: true, value: { accepted: true } } };
        }
        if (channel === "agent:load-session") return { ok: true };
        return { ok: true };
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    const runtime = modules["@deepseek-ai/dsh-client-runtime/client"] as { apply: (ctx: Context) => unknown };
    runtime.apply(context);
    await context.start();
    const sessions = context.get("sessions") as DeepSeekSessionsService & {
      bindingOf: (id: string) => { session: { getSnapshot: () => { events: readonly unknown[] }; projections: { faceOf: (key: string) => { getSnapshot: () => unknown } }; prompt: (text: string, mode?: "queue" | "steer") => Promise<unknown>; rename: (title: string) => Promise<unknown> } } | undefined;
      scope: (id: string) => Context | undefined;
      sessionOf: (ctx: Context) => { sessionId: string } | undefined;
      provide: (descriptor: { hooks: readonly string[]; resolve: () => { hooks: { current: string } } }) => () => void;
    };
    await sessions.refresh();
    expect(sessions.list.getSnapshot()).toMatchObject({
      phase: "ready",
      byId: { s1: { sessionId: "s1", title: "Demo" } },
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    });
    const binding = sessions.bindingOf("s1");
    expect(binding).toBeDefined();
    const scoped = sessions.scope("s1");
    expect(scoped).toBeDefined();
    expect(sessions.sessionOf(scoped!)).toMatchObject({ sessionId: "s1" });
    const dispose = sessions.provide({ hooks: ["current"], resolve: () => ({ hooks: { current: "s1" } }) });
    expect(sessions.currentProvideInfo.getSnapshot()).toMatchObject({ sessionId: undefined });
    sessions.open("s1");
    await vi.waitFor(() => expect(binding?.session.getSnapshot().events).toEqual([{ sequence: 1, type: "assistant/end", text: "ready" }]));
    const titleFace = binding?.session.projections.faceOf("title");
    sessions.handleMuxEnvelope({ payload: { type: "session/event", sessionId: "s1", event: { type: "session/projection", key: "title", sequence: 4, value: "new" } } });
    expect(titleFace?.getSnapshot()).toBe("new");
    sessions.handleMuxEnvelope({ payload: { type: "session/event", sessionId: "s1", event: { type: "session/projection", key: "title", sequence: 3, value: "stale" } } });
    expect(titleFace?.getSnapshot()).toBe("new");
    sessions.handleMuxEnvelope({ payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 3 } });
    expect(titleFace?.getSnapshot()).toBeUndefined();
    expect(sessions.currentProvideInfo.getSnapshot()).toMatchObject({ sessionId: "s1", hooks: { current: "s1" } });
    const parentCatalog = sessions.list.getSnapshot().subagentsByParent.s1;
    expect(parentCatalog?.entries).toHaveLength(1);
    sessions.openSubagent({ parentSessionId: "s1", childSessionId: "child-1", mode: "continuable" });
    await vi.waitFor(() => expect(sessions.list.getSnapshot().currentAddress).toEqual({ parentSessionId: "s1", childSessionId: "child-1", mode: "continuable" }));
    const child = sessions.bindingOf("child-1");
    await vi.waitFor(() => expect(child?.session.getSnapshot().events).toEqual([{ sequence: 2, type: "assistant/end", text: "child-ready" }]));
    await child?.session.prompt("follow up");
    expect(calls).toContainEqual({ method: "subagent.prompt", payload: { parentSessionId: "s1", childSessionId: "child-1", mode: "continuable", content: [{ type: "text", text: "follow up" }] } });
    const historyCallsBeforeRouteOnly = calls.filter((call) => call.method === "subagent.history").length;
    sessions.openSubagent(
      { parentSessionId: "s1", childSessionId: "child-1", mode: "continuable" },
      { loadConversation: false },
    );
    await vi.waitFor(() => expect(sessions.list.getSnapshot().currentAddress).toEqual({ parentSessionId: "s1", childSessionId: "child-1", mode: "continuable" }));
    expect(calls.filter((call) => call.method === "subagent.history").length).toBe(historyCallsBeforeRouteOnly);
    sessions.openSubagent({ parentSessionId: "child-1", childSessionId: "child-2", mode: "continuable" });
    await vi.waitFor(() => expect(sessions.list.getSnapshot().subagentBreadcrumb).toEqual([
      { parentSessionId: "s1", childSessionId: "child-1", mode: "continuable" },
      { parentSessionId: "child-1", childSessionId: "child-2", mode: "continuable" },
    ]));
    const nested = sessions.bindingOf("child-2");
    await vi.waitFor(() => expect(nested?.session.getSnapshot().events).toEqual([{ sequence: 3, type: "assistant/end", text: "nested-ready" }]));
    await nested?.session.prompt("nested follow up");
    expect(calls).toContainEqual({ method: "subagent.prompt", payload: { parentSessionId: "child-1", childSessionId: "child-2", mode: "continuable", content: [{ type: "text", text: "nested follow up" }] } });
    sessions.open("s1");
    await vi.waitFor(() => expect(sessions.list.getSnapshot()).toMatchObject({ currentAddress: undefined, subagentBreadcrumb: [] }));
    await binding?.session.prompt("continue", "steer");
    await binding?.session.prompt([{ type: "text", text: "with image" }, { type: "image", mediaType: "image/png", data: "AAAA" }], "queue");
    await binding?.session.rename("Renamed");
    expect(calls).toEqual(expect.arrayContaining([
      { method: "session.prompt", payload: { sessionId: "s1", text: "continue", mode: "steer" } },
      { method: "session.prompt", payload: { sessionId: "s1", content: [{ type: "text", text: "with image" }, { type: "image", mediaType: "image/png", data: "AAAA" }], mode: "queue" } },
      { method: "session.rename", payload: { sessionId: "s1", title: "Renamed" } },
    ]));
    sessions.handleHostEnvelope({ payload: { type: "host/session-status", sessionId: "s1", running: true } });
    expect(sessions.list.getSnapshot().byId.s1?.running).toBe(true);
    sessions.handleHostEnvelope({ payload: { type: "host/session-added", sessionId: "s2", blank: false, cwd: "/workspace" } });
    expect(sessions.list.getSnapshot().byId.s2?.cwd).toBe("/workspace");
    sessions.handleHostEnvelope({ payload: { type: "host/session-removed", sessionId: "s2" } });
    expect(sessions.list.getSnapshot().byId.s2).toBeUndefined();
    dispose();
  });

  it("reloads the runtime services without retaining the previous instance", async () => {
    const context = createRendererContext(new Context(), { apiVersion: 1, invoke: async () => ({ ok: true }) });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const runtime = modules["@deepseek-ai/dsh-client-runtime/client"] as { apply: (ctx: Context) => unknown };
    const firstCleanup = runtime.apply(context) as (() => void) | undefined;
    const first = context.get("workspaces");
    expect(first).toBeInstanceOf(DeepSeekWorkspaceService);
    firstCleanup?.();
    const secondCleanup = runtime.apply(context) as (() => void) | undefined;
    expect(context.get("workspaces")).toBeInstanceOf(DeepSeekWorkspaceService);
    expect(context.get("workspaces")).not.toBeUndefined();
    secondCleanup?.();
    expect(context.get("sessions")).toBeDefined();
  });

  it("provides the Harness theme runtime contract", async () => {
    const context = createRendererContext(new Context());
    const slotsModule = createDeepSeekClientCompatibilityModules({ createElement: () => null })["@deepseek-ai/dsh-client-ui-slots/client"] as { apply: (ctx: Context) => unknown };
    const themeModule = createDeepSeekClientCompatibilityModules({ createElement: () => null })["@deepseek-ai/dsh-client-ui-theme/client"] as { apply: (ctx: Context) => unknown };
    slotsModule.apply(context);
    themeModule.apply(context);
    await context.start();
    const theme = context.get("theme") as { getTheme: () => { preference: string; active: { colorScheme: string }; revision: number }; setTheme: (id: string) => void; register: (theme: { id: string; colorScheme: "light" | "dark"; tokens: Record<string, string> }) => () => void };
    expect(theme.getTheme()).toMatchObject({ preference: "system", active: { colorScheme: expect.stringMatching(/light|dark/) } });
    const dispose = theme.register({ id: "openbuddy-high-contrast", colorScheme: "dark", tokens: { "--accent": "#fff" } });
    theme.setTheme("openbuddy-high-contrast");
    expect(theme.getTheme()).toMatchObject({ preference: "openbuddy-high-contrast", active: { id: "openbuddy-high-contrast" } });
    dispose();
    expect(() => theme.setTheme("openbuddy-high-contrast")).toThrow("not registered");
  });

  it("declares conversation seats for dependent Harness UI plugins", async () => {
    const context = createRendererContext(new Context());
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    await context.plugin(DeepSeekSlotRegistry);
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    (modules["@deepseek-ai/dsh-client-ui-layout/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    const cleanup = ((modules["@deepseek-ai/dsh-client-ui-conversation/client"] as { apply: (ctx: Context) => unknown }).apply(context)) as (() => void) | undefined;
    const slots = context.get("slots") as DeepSeekSlotRegistry;
    expect(slots.spec("conversation.input.dock")).toMatchObject({ kind: "list", scope: "session" });
    expect(slots.spec("conversation.input.model")).toMatchObject({ kind: "single", scope: "session" });
    expect(slots.spec("conversation.view")).toMatchObject({ kind: "list", scope: "session" });
    cleanup?.();
    expect(slots.entries("conversation")).toHaveLength(0);
  });

  it("loads settings shell, general, and model sections with reversible slots", async () => {
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel) => channel === "agent:providers-list"
        ? { providers: [{ id: "pi", name: "Pi" }], models: [{ providerId: "pi", modelId: "deepseek-chat", name: "DeepSeek Chat" }] }
        : { ok: true },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    await context.plugin(DeepSeekSlotRegistry);
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const settings = modules["@deepseek-ai/dsh-client-ui-settings/client"] as { apply: (ctx: Context) => unknown };
    const general = modules["@deepseek-ai/dsh-client-ui-settings-general/client"] as { apply: (ctx: Context) => unknown };
    const models = modules["@deepseek-ai/dsh-client-ui-settings-models/client"] as { apply: (ctx: Context) => unknown };
    const settingsCleanup = settings.apply(context) as (() => void) | undefined;
    const generalCleanup = general.apply(context) as (() => void) | undefined;
    const modelsCleanup = models.apply(context) as (() => void) | undefined;
    const slots = context.get("slots") as DeepSeekSlotRegistry;
    expect(slots.entries("settings.section").map((entry) => entry.options.id)).toEqual(["general", "models"]);
    expect(slots.entries("settings.general.item").map((entry) => entry.options.id)).toContain("openbuddy-runtime");
    const settingsModels = context.get("settingsModels") as { list: () => Promise<unknown> };
    await expect(settingsModels.list()).resolves.toEqual([{ provider: "pi", name: "Pi", models: [{ id: "deepseek-chat", name: "DeepSeek Chat" }] }]);
    modelsCleanup?.();
    generalCleanup?.();
    settingsCleanup?.();
    expect(slots.entries("settings.section")).toHaveLength(0);
    expect(slots.entries("settings.general.item")).toHaveLength(0);
  });

  it("bridges DeepSeek client connection and Remote calls through the Pi IPC API", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    let eventHandler: ((event: { type: string; payload?: unknown }) => void) | undefined;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        calls.push({ channel, args });
        if (channel === "agent:providers-list") return { providers: [{ id: "pi", name: "Pi" }], models: [] };
        return { ok: true };
      },
      onEvent: async (handler) => { eventHandler = handler as typeof eventHandler; return () => { eventHandler = undefined; }; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    const connection = modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown };
    const gateway = modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown };
    const remotes = modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown };
    connection.apply(context);
    gateway.apply(context);
    remotes.apply(context);
    await context.start();

    const api = context.get("connection") as { api: { llm: { providers: (payload: unknown) => Promise<{ result: { ok: boolean; value?: unknown } }> } } };
    await expect(api.api.llm.providers({})).resolves.toMatchObject({ result: { ok: true, value: { providers: [{ provider: "pi" }] } } });
    expect(calls).toContainEqual({ channel: "agent:providers-list", args: {} });

    const gatewayService = context.get("typertGateway") as { invoke: (request: unknown) => Promise<{ ok: boolean; value?: unknown }> };
    await expect(gatewayService.invoke({ namespace: "demo", method: "ping", args: { value: "hello" } })).resolves.toMatchObject({ ok: true, value: { ok: true } });
    expect(calls).toContainEqual({ channel: "dsh:remote", args: { namespace: "demo", method: "ping", args: { value: "hello" } } });
    await expect(gatewayService.invoke({ namespace: "demo", method: "ping", args: ["invalid"] })).resolves.toMatchObject({ ok: false, error: { code: "arguments-invalid" } });
    await expect(gatewayService.invoke({ namespace: "demo", method: "ping", args: {}, extra: true })).resolves.toMatchObject({ ok: false, error: { code: "input-invalid" } });
    await expect(gatewayService.invoke({ namespace: "demo", method: "ping", args: {}, package: 42 })).resolves.toMatchObject({ ok: false, error: { code: "input-invalid" } });

    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>>; demo?: { ping?: (...args: unknown[]) => Promise<unknown> } };
    const dispose = await remote.$mount({ package: "fixture", descriptors: [{ namespace: "demo", method: "ping" }] });
    await expect(remote.demo?.ping?.("hello")).resolves.toMatchObject({ ok: true });
    expect(calls).toContainEqual({ channel: "dsh:remote", args: { package: "fixture", namespace: "demo", method: "ping", args: ["hello"] } });
    eventHandler?.({ type: "session/event", payload: { sessionId: "s1", event: { type: "turn/end" } } });
    await dispose();
    expect(calls).toContainEqual({ channel: "dsh:remote-unregister", args: { package: "fixture" } });
  });

  it("keeps connection generations isolated and start/stop idempotent", async () => {
    const eventHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const pluginHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const states: string[] = [];
    const connected: unknown[] = [];
    const envelopes: unknown[] = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async () => ({ ok: true }),
      onEvent: async (handler) => { eventHandlers.push(handler as typeof eventHandlers[number]); return () => undefined; },
      onPluginEvent: async (handler) => { pluginHandlers.push(handler as typeof pluginHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      start: (sinks: { onMuxEnvelope: (value: unknown) => void; onHostEnvelope: (value: unknown) => void; onConnected: (value: unknown) => void; onStateChange: (value: string) => void }) => { generation: number; stop: () => void };
      getSnapshot: () => { generation: number; state?: string; started: boolean };
    };
    const sinks = { onMuxEnvelope: (value: unknown) => envelopes.push(value), onHostEnvelope: (value: unknown) => envelopes.push(value), onConnected: (value: unknown) => connected.push(value), onStateChange: (value: string) => states.push(value) };
    const first = connection.start(sinks);
    const same = connection.start(sinks);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(same).toBe(first);
    expect(first.generation).toBe(1);
    first.stop();
    first.stop();
    const second = connection.start(sinks);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(second.generation).toBeGreaterThan(first.generation);
    eventHandlers.at(-1)?.({ type: "session/event", payload: { sessionId: "current" } });
    pluginHandlers.at(-1)?.({ type: "plugin/event", payload: { changed: true } });
    expect(envelopes).toHaveLength(eventHandlers.length + pluginHandlers.length > 0 ? 2 : 0);
    if (envelopes.length > 0) expect((envelopes.at(-1) as { payload?: { type?: string } }).payload?.type).toBe("plugin/event");
    expect(connected).toHaveLength(2);
    expect(states).toEqual(["connected", "reconnecting", "connected"]);
    expect(connection.getSnapshot()).toMatchObject({ generation: second.generation, state: "connected", started: true });
    second.stop();
  });

  it("replays events after reconnect and deduplicates live overlap", async () => {
    const eventHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => {
        calls.push({ channel, args });
        if (channel === "agent:event-log" && calls.filter((call) => call.channel === "agent:event-log").length > 0) return [{ sequence: 2, timestamp: "2026-08-29T00:00:02.000Z", type: "agent/end", payload: { sessionId: "s1" } }];
        return { ok: true };
      },
      onEvent: async (handler) => { eventHandlers.push(handler as typeof eventHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      start: (sinks: { onMuxEnvelope: (value: unknown) => void; onHostEnvelope: (value: unknown) => void }) => { stop: () => void };
    };
    const envelopes: unknown[] = [];
    const first = connection.start({ onMuxEnvelope: (value) => envelopes.push(value), onHostEnvelope: (value) => envelopes.push(value) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    eventHandlers.at(-1)?.({ type: "agent/start", sequence: 1, payload: { sessionId: "s1" } } as { type: string; payload?: unknown });
    first.stop();
    const second = connection.start({ onMuxEnvelope: (value) => envelopes.push(value), onHostEnvelope: (value) => envelopes.push(value) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    eventHandlers.at(-1)?.({ type: "agent/end", sequence: 2, payload: { sessionId: "s1" } } as { type: string; payload?: unknown });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContainEqual({ channel: "agent:event-log", args: { sinceSequence: 1, limit: 2000 } });
    expect(envelopes.filter((entry) => (entry as { payload?: { event?: { sequence?: number } } }).payload?.event?.sequence === 2)).toHaveLength(1);
    second.stop();
  });

  it("exposes live session and host event streams to Harness plugins", async () => {
    const eventHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const pluginHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async () => ({ ok: true }),
      onEvent: async (handler) => { eventHandlers.push(handler as typeof eventHandlers[number]); return () => undefined; },
      onPluginEvent: async (handler) => { pluginHandlers.push(handler as typeof pluginHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      api: {
        events: {
          mux: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ payload: unknown }>;
          host: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ payload: unknown }>;
        };
      };
      start: (sinks: { onMuxEnvelope?: (value: unknown) => void; onHostEnvelope?: (value: unknown) => void }) => { stop: () => void };
    };
    const mux = connection.api.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]();
    const host = connection.api.events.host({}, new AbortController().signal)[Symbol.asyncIterator]();
    const muxNext = mux.next();
    const hostNext = host.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    eventHandlers.at(-1)?.({ type: "agent/start", payload: { sequence: 9, sessionId: "s1", text: "hello" } });
    pluginHandlers.at(-1)?.({ type: "plugin/loaded", payload: { sequence: 10, sessionId: "s1", id: "fixture" } });
    await expect(muxNext).resolves.toMatchObject({ done: false, value: { payload: { type: "session/event", sessionId: "s1", event: { sequence: 9, text: "hello" } } } });
    await expect(hostNext).resolves.toMatchObject({ done: false, value: { payload: { type: "host/remote-event", event: "plugin/loaded", args: [{ sequence: 10, sessionId: "s1", id: "fixture" }] } } });
    connection.start({}).stop();
  });

  it("maps Harness control frames, preserves interaction rpcIds, and honors since", async () => {
    const eventHandlers: Array<(event: { type: string; payload?: unknown; rpcId?: string }) => void> = [];
    const pluginHandlers: Array<(event: { type: string; payload?: unknown; rpcId?: string }) => void> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel) => channel === "agent:event-log"
        ? [{ sequence: 4, timestamp: "2026-08-29T00:00:04.000Z", sessionId: "s1", type: "agent/end", payload: { sessionId: "s1" } }]
        : { ok: true },
      onEvent: async (handler) => { eventHandlers.push(handler as typeof eventHandlers[number]); return () => undefined; },
      onPluginEvent: async (handler) => { pluginHandlers.push(handler as typeof pluginHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      api: { events: { mux: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ rpcId: string; payload: unknown }>; host: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ rpcId: string; payload: unknown }> } };
      start: (sinks: Record<string, (value: unknown) => void>) => { stop: () => void };
    };
    const mux = connection.api.events.mux({ payload: { since: { s1: 4 } } }, new AbortController().signal)[Symbol.asyncIterator]();
    const host = connection.api.events.host({}, new AbortController().signal)[Symbol.asyncIterator]();
    const subscribed = mux.next();
    const hostNext = host.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await subscribed).value).toMatchObject({ payload: { type: "session/subscribed", sessionId: "s1", lastSeq: 4 } });
    pluginHandlers.at(-1)?.({ type: "session/permission", rpcId: "permission-1", payload: { sessionId: "s1", requestId: "permission-1", title: "Allow" } });
    const interaction = (await mux.next()).value;
    expect(interaction).toMatchObject({ rpcId: "permission-1", payload: { type: "approval/requested", sessionId: "s1", approvalId: "permission-1" } });
    pluginHandlers.at(-1)?.({ type: "session/created", rpcId: "created-1", payload: { sessionId: "s2", cwd: "/tmp/s2" } });
    expect(await hostNext).toMatchObject({ value: { rpcId: "created-1", payload: { type: "host/session-added", sessionId: "s2", cwd: "/tmp/s2" } } });
    connection.start({}).stop();
  });

  it("replays host plugin events without a session identity", async () => {
    const pluginHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel) => channel === "agent:plugin-events"
        ? [{ sequence: 12, timestamp: "2026-08-29T00:00:12.000Z", type: "commands/change", payload: { command: "compact" } }]
        : { ok: true },
      onPluginEvent: async (handler) => { pluginHandlers.push(handler as typeof pluginHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      api: { events: { host: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ payload: unknown }> } };
      start: (sinks: Record<string, (value: unknown) => void>) => { stop: () => void };
    };
    const host = connection.api.events.host({}, new AbortController().signal)[Symbol.asyncIterator]();
    const frame = host.next();
    await expect(frame).resolves.toMatchObject({ value: { payload: { type: "host/remote-event", event: "commands/change", args: [{ command: "compact" }] } } });
    expect(pluginHandlers).toHaveLength(1);
    connection.start({}).stop();
  });

  it("publishes replay frames to Harness event streams", async () => {
    const eventHandlers: Array<(event: { type: string; payload?: unknown }) => void> = [];
    let eventLogCalls = 0;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel) => {
        if (channel === "agent:event-log") {
          eventLogCalls += 1;
          return [{ sequence: 2, timestamp: "2026-08-29T00:00:02.000Z", type: "agent/end", payload: { sessionId: "s1" } }];
        }
        return { ok: true };
      },
      onEvent: async (handler) => { eventHandlers.push(handler as typeof eventHandlers[number]); return () => undefined; },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      api: { events: { mux: (request?: unknown, signal?: AbortSignal) => AsyncIterable<{ payload: unknown }> } };
      start: (sinks: Record<string, (value: unknown) => void>) => { stop: () => void };
    };
    const first = connection.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    eventHandlers.at(-1)?.({ type: "agent/start", sequence: 1, payload: { sessionId: "s1" } } as { type: string; payload?: unknown });
    first.stop();
    const mux = connection.api.events.mux({}, new AbortController().signal)[Symbol.asyncIterator]();
    const replayFrame = mux.next();
    connection.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(replayFrame).resolves.toMatchObject({ done: false, value: { payload: { type: "session/event", event: { sessionId: "s1" } } } });
    const duplicate = await Promise.race([
      mux.next().then(() => "duplicate" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 10)),
    ]);
    expect(duplicate).toBe("timeout");
    expect(eventLogCalls).toBeGreaterThan(0);
    connection.start({}).stop();
  });

  it("cancels pending unary RPCs when the connection generation stops", async () => {
    let release: (() => void) | undefined;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async () => new Promise((resolve) => { release = () => resolve({ ok: true, value: "late" }); }),
      onEvent: async () => () => undefined,
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; error?: { code?: string } }> };
      start: (sinks: { onStateChange: (state: string) => void }) => { stop: () => void };
    };
    const loop = connection.start({ onStateChange: () => undefined });
    const pending = connection.rpc.call("/api", "demo/ping", { args: {} });
    loop.stop();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "connection-lost" } });
    release?.();
  });

  it("replays only idempotent read RPCs after a connection generation changes", async () => {
    const disconnects: Array<() => void> = [];
    const calls: string[] = [];
    const requestIds: string[] = [];
    let resolveFirst: (() => void) | undefined;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      transport: {
        call: async (_channel, endpoint, _payload, _signal, requestId) => {
          calls.push(endpoint);
          requestIds.push(requestId ?? "");
          if (calls.length === 1) {
            await new Promise<void>((resolve) => { resolveFirst = resolve; });
            return { ok: true, value: { stale: true } };
          }
          return { ok: true, value: { providers: ["pi"] } };
        },
        respond: async () => undefined,
        open: async (_signal, _emit, onDisconnect) => {
          disconnects.push(onDisconnect);
          return { description: { transport: "test" }, close: () => undefined };
        },
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code?: string } }> };
      start: (sinks: Record<string, (value: unknown) => void>) => { stop: () => void };
    };
    const loop = connection.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = connection.rpc.call("/api", "llm.providers", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    disconnects[0]?.();
    await expect(pending).resolves.toMatchObject({ ok: true, value: { providers: ["pi"] } });
    expect(calls).toEqual(["llm.providers", "llm.providers"]);
    expect(requestIds[1]).toBe(requestIds[0]);
    resolveFirst?.();

    const sideEffect = connection.rpc.call("/api", "session.prompt", { args: { sessionId: "s1", text: "hello" } });
    disconnects.at(-1)?.();
    await expect(sideEffect).resolves.toMatchObject({ ok: false, error: { code: "connection-lost" } });
    expect(calls).toEqual(["llm.providers", "llm.providers", "session.prompt"]);
    loop.stop();
  });

  it("cancels a replayable RPC when the connection is explicitly stopped", async () => {
    let release: (() => void) | undefined;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      transport: {
        call: async () => new Promise((resolve) => { release = () => resolve({ ok: true, value: [] }); }),
        respond: async () => undefined,
        open: async () => ({ description: {}, close: () => undefined }),
      },
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const connection = context.get("connection") as {
      rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; error?: { code?: string } }> };
      start: (sinks: Record<string, (value: unknown) => void>) => { stop: () => void };
    };
    const loop = connection.start({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = connection.rpc.call("/api", "workspace.list", {});
    loop.stop();
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: "connection-lost" } });
    release?.();
  });

	it("maps named Remote descriptors and forwards allowlisted event arguments", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    let pluginHandler: ((event: RendererAgentEvent) => void) | undefined;
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true, value: "ok" }; },
      onEvent: async () => () => undefined,
      onPluginEvent: async (handler) => { pluginHandler = handler; return () => { pluginHandler = undefined; }; },
	});

    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>>; demo?: { run?: (...args: unknown[]) => Promise<unknown> } };
    const dispose = await remote.$mount({ package: "fixture", descriptors: [{ namespace: "demo", method: "run", parameters: [{ name: "value", wire: "value" }] }] });
    await remote.demo?.run?.("payload");
    expect(calls).toContainEqual({ channel: "dsh:remote", args: { package: "fixture", namespace: "demo", method: "run", args: { value: "payload" } } });
    let received: unknown[] | undefined;
    remote.demo;
    const eventRemote = context.get("remote") as { $on: (event: string, listener: (...args: unknown[]) => void) => () => void };
    eventRemote.$on("commands/change", (...args) => { received = args; });
    pluginHandler?.({ type: "commands/change", payload: { args: ["first", 2] } });
    expect(received).toEqual(["first", 2]);
    await dispose();
  });

	it("serializes generated runtime codecs before crossing the renderer bridge", async () => {
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
		const calls: Array<{ channel: string; args: unknown }> = [];
		const context = createRendererContext(new Context(), { apiVersion: 1, invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true }; } });
		const gateway = modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown };
		gateway.apply(context);
		const remotes = modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown };
		await remotes.apply(context);
		await context.start();
		const remote = context.get("remote") as { $mount: (contribution: unknown) => Promise<() => Promise<void>> };
		const { z } = await import("../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js");
		const stop = await remote.$mount({
			package: "strict-fixture",
			descriptors: [{
				namespace: "demo",
				method: "echo",
				parameters: [{ name: "request", wire: "request", codec: { mode: "strict", typeSymbol: "fixture/Request", schema: z.object({ value: z.string() }) } }],
				result: { mode: "strict", typeSymbol: "fixture/Result", schema: z.object({ ok: z.boolean() }) },
			}],
		});
		const registration = calls.filter((call) => call.channel === "dsh:remote-register").at(-1)?.args as { package: string; descriptors: Array<{ parameters: Array<{ codec: unknown }> }> };
		expect(registration.package).toBe("strict-fixture");
		expect(registration.descriptors[0]?.parameters[0]?.codec).toEqual({ mode: "strict", typeSymbol: "fixture/Request", schema: { type: "object", properties: { value: { schema: { type: "string" } } } } });
		await stop();
	});

  it("projects Client Context identities into scoped Remote calls and disposes them", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true, value: "scoped" }; },
      onEvent: async () => () => undefined,
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();

    const typert = context.get("typert") as { contexts: { registerClient: (key: string, binder: { identity: () => unknown }) => () => void }; remotes: { list: () => string[] } };
    const disposeContext = typert.contexts.registerClient("agent", { identity: () => "agent-1" });
    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>>; goals?: { inspect?: (...args: unknown[]) => Promise<unknown> } };
    const disposeRemote = await remote.$mount({ package: "scoped-fixture", descriptors: [{ namespace: "goals", method: "inspect", invocation: { kind: "context", context: "agent", wire: "agentId" }, parameters: [{ name: "value", wire: "value" }] }] });
    expect(typert.remotes.list()).toContainEqual(expect.objectContaining({ package: "scoped-fixture", namespace: "goals", method: "inspect" }));
    await remote.goals?.inspect?.("payload");
    expect(calls).toContainEqual({ channel: "dsh:remote", args: { package: "scoped-fixture", namespace: "goals", method: "inspect", args: { agentId: "agent-1", value: "payload" } } });
    await disposeRemote();
    disposeContext();
    expect(typert.remotes.list()).not.toContainEqual(expect.objectContaining({ package: "scoped-fixture" }));
    expect(remote.goals?.inspect).toBeUndefined();
  });

  it("rejects duplicate renderer Remote endpoints atomically", async () => {
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async () => ({ ok: true, value: "ok" }),
      onEvent: async () => () => undefined,
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>> };
    const first = await remote.$mount({ package: "first", descriptors: [{ namespace: "demo", method: "run" }] });
    await expect(remote.$mount({ package: "second", descriptors: [{ namespace: "demo", method: "run" }, { namespace: "demo", method: "other" }] })).rejects.toThrow("already registered");
    await first();
  });

  it("validates strict Remote codecs before IPC and on returned values", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true, value: { accepted: true } }; },
      onEvent: async () => () => undefined,
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>>; demo?: { echo?: (...args: unknown[]) => Promise<unknown> } };
    const codec = { mode: "strict", typeSymbol: "fixture/Count", schema: { type: "integer" } };
    const resultCodec = { mode: "strict", typeSymbol: "fixture/Result", schema: { type: "object", properties: { accepted: { schema: { type: "boolean" } } } } };
    const dispose = await remote.$mount({ package: "strict-fixture", descriptors: [{ namespace: "demo", method: "echo", parameters: [{ name: "value", codec }], result: resultCodec }] });
    await expect(remote.demo?.echo?.(2)).resolves.toEqual({ ok: true, value: { accepted: true } });
    expect(calls.filter((call) => call.channel === "dsh:remote").at(-1)?.args).toMatchObject({ args: { value: 2 } });
    await expect(remote.demo?.echo?.("bad")).rejects.toThrow("does not match integer");
    await dispose();
  });

  it("projects direct Remote scopes into client context identities", async () => {
    const calls: Array<{ channel: string; args: unknown }> = [];
    const context = createRendererContext(new Context(), {
      apiVersion: 1,
      invoke: async (channel, args) => { calls.push({ channel, args }); return { ok: true, value: "ok" }; },
      onEvent: async () => () => undefined,
    });
    const modules = createDeepSeekClientCompatibilityModules({ createElement: () => null });
    (modules["@deepseek-ai/dsh-client-connection/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-gateway/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    (modules["@deepseek-ai/dsh-api-remotes/client"] as { apply: (ctx: Context) => unknown }).apply(context);
    await context.start();
    const typert = context.get("typert") as { contexts: { registerClient: (key: string, binder: { identity: () => unknown }) => () => void } };
    const disposeContext = typert.contexts.registerClient("agent", { identity: () => "agent-1" });
    const remote = context.get("remote") as { $mount: (value: unknown) => Promise<() => Promise<void>>; scoped?: { echo?: (...args: unknown[]) => Promise<unknown> } };
    const codec = { mode: "strict", typeSymbol: "fixture/AgentId", schema: { type: "string" } };
    const dispose = await remote.$mount({
      package: "scoped-fixture",
      descriptors: [{
        namespace: "scoped",
        method: "echo",
        parameters: [{ name: "agent", wire: "agentId", codec }, { name: "request", wire: "request", codec: { mode: "src-json" } }],
        scope: { context: "agent", wire: "agentId" },
      }],
    });
    await expect(remote.scoped?.echo?.({ text: "hello" })).resolves.toEqual({ ok: true, value: "ok" });
    expect(calls.findLast((call) => call.channel === "dsh:remote" && (call.args as { namespace?: unknown })?.namespace === "scoped")?.args)
      .toMatchObject({ args: { agentId: "agent-1", request: { text: "hello" } } });
    await dispose();
    disposeContext();
  });

  it("keeps Harness slot declarations, winners, and declaration listeners", () => {
    const core = new DeepSeekSlotCore();
    const declarations: string[] = [];
    core.subscribeDeclaration("toolbar", () => declarations.push(core.spec("toolbar") ? "declared" : "collapsed"));
    const disposeOwner = core.register({ name: "root", kind: "single", children: {
      toolbar: { kind: "list", scope: "global" },
    } }, () => null);
    const disposeFirst = core.register({ name: "toolbar", id: "first", order: 2 }, () => null);
    const disposeWinner = core.register({ name: "toolbar", id: "first", order: 1, priority: 1 }, () => null);
    expect(core.entriesOfSlot("toolbar")).toHaveLength(1);
    expect(core.entriesOfSlot("toolbar")[0]?.options.order).toBe(2);
    expect(declarations).toEqual(["declared"]);
    disposeFirst();
    disposeWinner();
    disposeOwner();
    expect(core.spec("toolbar")).toBeUndefined();
    expect(declarations).toEqual(["declared", "collapsed"]);
  });

  it("supports DeepSeek chain selectors and fail-loud slot cells", () => {
    const core = new DeepSeekSlotCore();
    const first = { name: "message.render", kind: "chain" as const, priority: 10, select: (owner: unknown) => (owner === "special" ? "special-match" : null) };
    const fallback = { name: "message.render", kind: "chain" as const, priority: 20, select: () => "fallback-match" };
    core.register(first, "first");
    core.register(fallback, "fallback");
    expect(core.selectChain("message.render", "special")).toEqual({ entry: expect.objectContaining({ component: "first" }), matched: "special-match" });
    expect(core.selectChain("message.render", "ordinary")).toEqual({ entry: expect.objectContaining({ component: "fallback" }), matched: "fallback-match" });
    expect(() => core.register({ name: "message.render", kind: "chain", priority: 10, select: () => "duplicate" }, "duplicate"))
      .toThrow(/already has a registration/);
  });

  it("rejects undeclared child collisions and collapses child declarations", () => {
    const core = new DeepSeekSlotCore();
    const dispose = core.register({ name: "root", kind: "single", children: { "shell.overlay": { kind: "list", scope: "global" } } }, "root");
    expect(() => core.register({ name: "shell.overlay", id: "overlay" }, "overlay")).not.toThrow();
    expect(() => core.register({ name: "shell.overlay", id: "overlay" }, "duplicate")).toThrow(/already has a registration/);
    dispose();
    expect(core.spec("shell.overlay")).toBeUndefined();
    expect(core.entries("shell.overlay")).toEqual([]);
  });

  it("upgrades an implicit legacy slot when its parent declares the explicit shape", () => {
    const core = new DeepSeekSlotCore();
    core.register({ name: "settings.section", id: "general" }, "general");
    expect(() => core.register({
      name: "settings",
      kind: "single",
      children: { "settings.section": { kind: "list", scope: "root" } },
    }, "settings")).not.toThrow();
    expect(core.spec("settings.section")).toEqual({ name: "settings.section", kind: "list", scope: "root" });
  });

  it("allows a child slot to be registered after its parent declared it", () => {
    const core = new DeepSeekSlotCore();
    core.register({
      name: "conversation",
      kind: "single",
      children: { "conversation.hero.workspace": { kind: "single", scope: "root" } },
    }, "conversation");
    expect(() => core.register({
      name: "conversation.hero.workspace",
      kind: "single",
      id: "workspace",
    }, "workspace")).not.toThrow();
  });

  it("keeps layout and theme snapshot callbacks bound to their services", async () => {
    const context = new Context();
    const layout = new DeepSeekLayoutController(context);
    const theme = new DeepSeekThemeService(context);
    const readLayout = layout.getSnapshot;
    const readTheme = theme.getTheme;
    expect(readLayout()).toEqual({ sidebarCollapsed: false, detailsOpen: false });
    expect(readTheme().preference).toBe("system");
  });

  it("clears core declarations and listeners during renderer service disposal", () => {
    const core = new DeepSeekSlotCore();
    let changes = 0;
    core.subscribe("root", () => { changes += 1; });
    core.register({ name: "root", kind: "single" }, "root-entry");
    core.register({ name: "root", kind: "single", priority: 1 }, "shadow");
    core.clear();
    expect(core.entries("root")).toEqual([]);
    expect(core.snapshot()).toHaveLength(1);
    core.register({ name: "root", kind: "single" }, "fresh");
    expect(core.entries("root")).toHaveLength(1);
    expect(changes).toBe(2);
  });

  it("adapts DeepSeek slot registrations into WorkBuddy contributions", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["slots"],
      apply: (ctx: Context) => {
        const slots = ctx.get("slots") as DeepSeekSlotRegistry;
        return slots.register({ name: "sidebar.brand.name", id: "brand", label: "DeepSeek" }, () => null);
      },
    }));
    await context.plugin(DeepSeekSlotRegistry);
    await loader.load([{ id: "deepseek", name: "deepseek" }]);
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toEqual([
      expect.objectContaining({
        kind: "sidebar",
        id: "sidebar.brand.name:brand",
        payload: expect.objectContaining({ internal: true }),
      }),
    ]);
    await loader.remove("deepseek");
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toEqual([]);
  });

  it("maps DeepSeek settings, commands, and message slots", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["slots"],
      apply: (ctx: Context) => {
        const slots = ctx.get("slots") as DeepSeekSlotRegistry;
        const disposers = [
          slots.register({ name: "settings.general.item", id: "settings" }, () => null),
          slots.register({ name: "command.palette", id: "command" }, () => null),
          slots.register({ name: "conversation.message.footer", id: "message" }, () => null),
        ];
        return () => disposers.forEach((dispose) => dispose());
      },
    }));
    await context.plugin(DeepSeekSlotRegistry);
    await loader.load([{ id: "slot-kinds", name: "slot-kinds" }]);
    expect((context.get("rendererContributions") as RendererContributionRegistry).list().map((entry) => entry.kind)).toEqual([
      "settings", "command", "message",
    ]);
  });

  it("cleans generator-based DeepSeek slot injections on plugin removal", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["slots"],
      apply: (ctx: Context) => {
        const slots = ctx.get("slots") as DeepSeekSlotRegistry;
        return slots.inject("sidebar.tools", function* () {
          yield slots.register({ name: "sidebar.tools", id: "tools", label: "Tools" }, () => null);
        });
      },
    }));
    await context.plugin(DeepSeekSlotRegistry);
    await loader.load([{ id: "generator-plugin", name: "generator-plugin" }]);
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toHaveLength(1);
    await loader.remove("generator-plugin");
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toHaveLength(0);
    expect((context.get("slots") as DeepSeekSlotRegistry).entries("sidebar.tools")).toHaveLength(0);
  });
  it("does not let a replaced contribution disposer remove the replacement", () => {
    const registry = new RendererContributionRegistry();
    const revisions: number[] = [];
    const unsubscribe = registry.subscribe(() => revisions.push(registry.getVersion()));
    const first = { kind: "sidebar" as const, id: "same", payload: { label: "first" } };
    const second = { kind: "sidebar" as const, id: "same", payload: { label: "second" } };
    const disposeFirst = registry.register(first);
    registry.register(second);
    disposeFirst();
    unsubscribe();
    expect(registry.list()).toEqual([second]);
    expect(revisions).toEqual([1, 2]);
  });

  it("validates assistant contributions as explicit 助理 submenus", () => {
    const registry = new RendererContributionRegistry();
    expect(() => registry.register({ kind: "assistant", id: "missing-route", payload: { label: "扩展" } })).toThrow("assistant contribution route");
    expect(() => registry.register({ kind: "assistant", id: "root-route", payload: { label: "扩展", route: "助理" } })).toThrow("assistant contribution route");
    expect(() => registry.register({ kind: "assistant", id: "reserved-route", payload: { label: "扩展", route: "助理·日程" } })).toThrow("reserved");
    expect(() => registry.register({ kind: "assistant", id: "missing-label", payload: { route: "助理·扩展" } })).toThrow("label or title");
    const dispose = registry.register({ kind: "assistant", id: "valid", payload: { label: "扩展", route: "助理·研究 Buddy", order: 240, modes: ["network"], requiredTrust: "known_peer", capabilityIds: ["directory"] } });
    expect(() => registry.register({ kind: "assistant", id: "duplicate-route", payload: { label: "重复", route: "助理·研究 Buddy" } })).toThrow("already registered");
    expect(registry.list()).toEqual([expect.objectContaining({ kind: "assistant", id: "valid", payload: expect.objectContaining({ order: 240, modes: ["network"], requiredTrust: "known_peer" }) })]);
    dispose();
  });
  it("validates project contributions as unique project tabs", () => {
    const registry = new RendererContributionRegistry();
    expect(() => registry.register({ kind: "project", id: "missing-tab", payload: { label: "扩展" } })).toThrow("project contribution tab");
    expect(() => registry.register({ kind: "project", id: "missing-label", payload: { projectTab: "协作" } })).toThrow("label or title");
    const dispose = registry.register({ kind: "project", id: "valid", payload: { label: "协作面板", projectTab: "collaboration", order: 80, modes: ["organization"], requiredTrust: "org" } });
    expect(() => registry.register({ kind: "project", id: "duplicate", payload: { label: "重复", projectTab: "collaboration" } })).toThrow("already registered");
    expect(registry.list()).toEqual([expect.objectContaining({ kind: "project", id: "valid", payload: expect.objectContaining({ order: 80, modes: ["organization"], requiredTrust: "org" }) })]);
    dispose();
  });
  it("loads Harness-shaped plugins and cleans contributions", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["rendererContributions"],
      apply: (ctx: Context) => (ctx.get("rendererContributions") as { register: (value: any) => () => void }).register({
        kind: "sidebar", id: "example", payload: { label: "Example" },
      }),
    }));
    await loader.load([{ id: "example", name: "example" }]);
    expect(loader.list()[0].state).toBe("loaded");
    expect((context.get("rendererContributions") as { list: () => unknown[] }).list()).toHaveLength(1);
    await loader.dispose();
    expect((context.get("rendererContributions") as { list: () => unknown[] }).list()).toHaveLength(0);
  });

  it("loads the external dsh client face and registers a WorkBuddy contribution", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context);
    const module = await import(pathToFileURL(join(
      process.cwd(),
      "packages/runtime/openbuddy-plugin-host/src/__fixtures__/external-dsh-plugin/client.js",
    )).href);
    await loader.load([{ id: "external-dsh", name: "@fixture/external-dsh-plugin/client", inject: ["rendererContributions"] }], new Map([
      ["external-dsh", module.default],
    ]));
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toEqual([expect.objectContaining({
      id: "external-dsh-plugin/settings",
      kind: "settings",
    })]);
    await loader.remove("external-dsh");
    expect((context.get("rendererContributions") as RendererContributionRegistry).list()).toEqual([]);
  });

  it("disposes Cordis effects registered by a function plugin", async () => {
    const context = createRendererContext(new Context());
    let disposed = 0;
    const loader = new RendererPluginLoader(context, async () => ({
      apply: (ctx: Context) => {
        ctx.effect(() => () => { disposed += 1; });
      },
    }));
    await loader.load([{ id: "effects", name: "effects" }]);
    expect(disposed).toBe(0);
    await loader.remove("effects");
    expect(disposed).toBe(1);
  });

  it("preserves function-plugin inject metadata and awaits async cleanup", async () => {
    const context = createRendererContext(new Context());
    let releaseCleanup: (() => void) | undefined;
    let cleanupFinished = false;
    const loaded: string[] = [];
    const loader = new RendererPluginLoader(context, async (name) => name === "provider"
      ? { provide: "provider", apply: (ctx: Context) => { ctx.provide("provider", { ready: true }); loaded.push(name); } }
      : {
          inject: ["provider"],
          apply: (ctx: Context) => {
            expect(ctx.get("provider")).toEqual({ ready: true });
            loaded.push(name);
            return async () => {
              await new Promise<void>((resolve) => { releaseCleanup = resolve; });
              cleanupFinished = true;
            };
          },
        });
    await loader.load([
      { id: "consumer", name: "consumer" },
      { id: "provider", name: "provider" },
    ]);
    expect(loaded).toEqual(["provider", "consumer"]);
    const disposing = loader.dispose();
    await vi.waitFor(() => expect(releaseCleanup).toBeDefined());
    expect(cleanupFinished).toBe(false);
    releaseCleanup?.();
    await disposing;
    expect(cleanupFinished).toBe(true);
  });

  it("namespaces group child dependencies and removes descendants with the group", async () => {
    const context = createRendererContext(new Context());
    const loaded: string[] = [];
    const loader = new RendererPluginLoader(context, async (name) => {
      if (name === "child-a") return { apply: () => { loaded.push("a"); } };
      if (name === "child-b") return {
        inject: ["group:a"],
        apply: () => { loaded.push("b"); },
      };
      return { apply: () => { loaded.push("group"); } };
    });
    await loader.load([{
      id: "group",
      name: "group",
      group: true,
      children: [
        { id: "a", name: "child-a" },
        { id: "b", name: "child-b", inject: ["a"] },
      ],
    }]);
    expect(loaded).toEqual(["group", "a", "b"]);
    expect(loader.listGroup("group").map((entry) => entry.id)).toEqual(["group:a", "group:b"]);
    expect([...loader.entries()].map((entry) => entry.id)).toEqual(["group", "group:a", "group:b"]);
    await loader.remove("group");
    expect(loader.list()).toEqual([]);
    expect(loader.listGroups()).toEqual([]);
  });

  it("reconciles profile patches without duplicating renderer entries", async () => {
    let version = 0;
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      apply: () => { version += 1; return () => { version -= 1; }; },
    }));
    await loader.loadProfile({ entries: [{ id: "plugin", name: "plugin", config: { value: 1 } }] });
    await loader.loadProfile({
      entries: [{ id: "plugin", name: "plugin", config: { value: 2 } }],
    });
    expect(loader.resolve("plugin").options.config).toEqual({ value: 2 });
    expect(version).toBe(1);
  });

  it("orders known external module dependencies while ignoring static externals", async () => {
    const context = createRendererContext(new Context());
    const loaded: string[] = [];
    const loader = new RendererPluginLoader(context, async (name) => ({
      apply: () => { loaded.push(name); },
    }));
    await loader.load([
      { id: "consumer", name: "consumer/client", external: ["provider/client", "react"] },
      { id: "provider", name: "provider/client", moduleId: "provider" },
    ]);
    expect(loaded).toEqual(["provider/client", "consumer/client"]);
  });

  it("allows incremental entries to inject an already-loaded renderer plugin", async () => {
    const context = createRendererContext(new Context());
    const loaded: string[] = [];
    const loader = new RendererPluginLoader(context, async (name) => ({
      inject: name === "consumer" ? ["provider"] : undefined,
      apply: () => { loaded.push(name); },
    }));
    await loader.load([{ id: "provider", name: "provider" }]);
    await loader.load([{ id: "consumer", name: "consumer" }]);
    expect(loaded).toEqual(["provider", "consumer"]);
  });

  it("retains provided service aliases for incremental renderer loads", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async (name) => name === "provider"
      ? { provide: "provider-service", apply: (ctx: Context) => { ctx.provide("provider-service", { ready: true }); } }
      : { inject: ["provider-service"], apply: (ctx: Context) => { expect(ctx.get("provider-service")).toEqual({ ready: true }); } });
    await loader.load([{ id: "provider-entry", name: "provider" }]);
    await loader.load([{ id: "consumer", name: "consumer" }]);
    expect(loader.resolve("consumer").status.state).toBe("loaded");
  });

  it("rejects cycles in known external module dependencies", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({ apply: () => undefined }));
    await expect(loader.load([
      { id: "a", name: "a/client", external: ["b/client"] },
      { id: "b", name: "b/client", external: ["a/client"] },
    ])).rejects.toThrow("unresolved inject dependencies");
  });

  it("rolls back entries and contributions when a batch fails", async () => {
    const context = createRendererContext(new Context());
    const contributions = context.get("rendererContributions") as { register: (value: any) => () => void; list: () => unknown[] };
    const loader = new RendererPluginLoader(context, async (name) => {
      if (name === "broken") throw new Error("module import failed");
      return {
        apply: () => contributions.register({ kind: "sidebar", id: "transient", payload: {} }),
      };
    });

    await expect(loader.load([
      { id: "working", name: "working" },
      { id: "broken", name: "broken" },
    ])).rejects.toThrow("module import failed");
    expect(loader.list()).toEqual([]);
    expect([...loader.entries()]).toEqual([]);
    expect(contributions.list()).toEqual([]);
  });

  it("exposes the loader and forwards lifecycle events through ctx.on()", async () => {
    const context = createRendererContext(new Context());
    const seen: string[] = [];
    context.on("loader/entry-init", (payload: { id: string }) => seen.push(payload.id));
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["loader"],
      apply: (ctx: Context) => {
        expect(ctx.get("loader")).toMatchObject({ load: expect.any(Function), list: expect.any(Function) });
      },
    }));
    expect(context.get("loader")).toMatchObject({ load: expect.any(Function), list: expect.any(Function) });
    expect(context.get("loaderEvents")).toMatchObject({ on: expect.any(Function), emit: expect.any(Function) });
    await loader.load([{ id: "renderer-loader", name: "renderer-loader", inject: ["loader"] }]);
    expect(seen).toEqual(["renderer-loader"]);
  });

  it("supports DeepSeek client-loader create and fiber lifecycle calls", async () => {
    const context = createRendererContext(new Context());
    const lifecycle: string[] = [];
    const loader = new RendererPluginLoader(context, async () => ({
      apply: () => {
        lifecycle.push("loaded");
        return () => { lifecycle.push("disposed"); };
      },
    }));
    const id = await loader.create({ name: "@scope/dynamic/client" });
    const fiber = loader.resolve(id).fiber;
    expect(id).toBe("@scope/dynamic/client");
    expect(fiber).toMatchObject({ state: "loaded", ctx: context });
    await fiber?.await();
    expect(lifecycle).toEqual(["loaded"]);
    await loader.remove(id);
    expect(lifecycle).toEqual(["loaded", "disposed"]);
  });

  it("rolls back a group when a child plugin fails", async () => {
    const context = createRendererContext(new Context());
    const contributions = context.get("rendererContributions") as { register: (value: any) => () => void; list: () => unknown[] };
    const loader = new RendererPluginLoader(context, async (name) => {
      if (name === "broken-child") throw new Error("child import failed");
      return {
        apply: () => contributions.register({ kind: "sidebar", id: name, payload: {} }),
      };
    });

    await expect(loader.load([{
      id: "group",
      name: "group",
      group: true,
      children: [
        { id: "working", name: "working-child" },
        { id: "broken", name: "broken-child" },
      ],
    }])).rejects.toThrow("child import failed");
    expect(loader.list()).toEqual([]);
    expect(contributions.list()).toEqual([]);
  });
});

  it("loadCordisPatch accepts a deepseek-harness `cordis.patch.yml` source", async () => {
    const context = createRendererContext(new Context());
    const loader = new RendererPluginLoader(context, async () => ({
      inject: ["rendererContributions"],
      apply: (ctx: Context) => (ctx.get("rendererContributions") as { register: (value: any) => () => void }).register({
        kind: "sidebar", id: "x", payload: { label: "x" },
      }),
    }));
    await loader.loadCordisPatch(
      `
- insert:
    - id: sidebar-plugin
      name: '@scope/sidebar'
      config:
        title: !!js scopeTitle
- id: disabled-plugin
  name: '@scope/disabled'
  disabled: true
`,
      { scopeTitle: "OpenBuddy" },
    );
    const list = loader.list();
    const sidebar = list.find((entry) => entry.id === "sidebar-plugin");
    const disabled = list.find((entry) => entry.id === "disabled-plugin");
    expect(sidebar?.state).toBe("loaded");
    expect(disabled?.state).toBe("disabled");
  });

  it("loadCordisPatch updates the current entry tree instead of rebuilding from empty", async () => {
    const context = createRendererContext(new Context());
    const loaded: string[] = [];
    const loader = new RendererPluginLoader(context, async (name) => ({
      apply: (_ctx: Context, config?: unknown) => {
        loaded.push(`${name}:${JSON.stringify(config)}`);
        return () => undefined;
      },
    }));
    await loader.load([{ id: "existing", name: "@scope/existing", config: { value: 1 } }]);
    await loader.loadCordisPatch(`
- id: existing
  config:
    value: 2
- insert:
    - id: appended
      name: '@scope/appended'
`);
    expect(loader.resolve("existing").options).toMatchObject({
      name: "@scope/existing",
      config: { value: 2 },
    });
    expect(loader.resolve("appended").options.name).toBe("@scope/appended");
    expect(loaded).toEqual([
      "@scope/existing:{\"value\":1}",
      "@scope/existing:{\"value\":2}",
      "@scope/appended:{}",
    ]);
  });

  it("rolls back a renderer plugin when its update import fails", async () => {
    const context = createRendererContext(new Context());
    const applies: string[] = [];
    const failingNames = new Set<string>();
    const loader = new RendererPluginLoader(context, async (name) => {
      if (failingNames.has(name)) throw new Error("simulated banner reload failure");
      return {
        apply: (_ctx: Context, config?: unknown) => {
          applies.push(name + ":" + JSON.stringify(config ?? null));
          return () => undefined;
        },
      };
    });
    await loader.load([{ id: "sidebar", name: "@scope/sidebar", config: { value: 1 } }]);
    expect(loader.resolve("sidebar").options.config).toEqual({ value: 1 });
    expect(applies).toEqual(["@scope/sidebar:{\"value\":1}"]);

    failingNames.add("@scope/reloaded");
    const appliesBeforeUpdate = applies.length;
    await expect(
      loader.update("sidebar", { name: "@scope/reloaded", config: { value: 2 } }),
    ).rejects.toThrow("simulated banner reload failure");

    const rolled = loader.resolve("sidebar").options;
    expect(rolled.name).toBe("@scope/sidebar");
    expect(rolled.config).toEqual({ value: 1 });
    expect(applies.slice(appliesBeforeUpdate)).toEqual(["@scope/sidebar:{\"value\":1}"]);
    expect(loader.list().some((entry) => entry.name === "@scope/reloaded")).toBe(false);

    failingNames.delete("@scope/reloaded");
    await loader.update("sidebar", { config: { value: 3 } });
    expect(loader.resolve("sidebar").options.config).toEqual({ value: 3 });
  });


describe("Service-class plugins (renderer side)", () => {
  it("loads a class-shaped renderer plugin via the deepseek-harness `Service` convention", async () => {
    const context = createRendererContext(new Context());
    class SidebarService {
      static inject = ["rendererContributions"] as const;
      public ctx: Context;
      constructor(ctx: Context, _config?: unknown) {
        this.ctx = ctx;
        (ctx.get("rendererContributions") as { register: (value: any) => () => void }).register({
          kind: "sidebar", id: "service-sidebar", payload: { label: "Service" },
        });
      }
    }
    const loader = new RendererPluginLoader(context, async () => ({ default: SidebarService }));
    await loader.load([{ id: "service-sidebar", name: "@scope/service-sidebar" }]);
    expect(loader.list()[0]?.state).toBe("loaded");
    // The constructor's `register` call against `rendererContributions`
    // proves the class was invoked with `new`, not as a plain function
    // (which would have thrown `Class constructor cannot be invoked
    // without 'new'`).
    const contributions = (context.get("rendererContributions") as { list: () => unknown[] }).list();
    expect(contributions).toHaveLength(1);
  });

  it("loads a namespace export whose apply field is a Service class", async () => {
    const context = createRendererContext(new Context());
    class NamespaceService {
      static inject = ["rendererContributions"] as const;
      constructor(ctx: Context) {
        (ctx.get("rendererContributions") as { register: (value: any) => () => void }).register({
          kind: "sidebar", id: "namespace-service", payload: {},
        });
      }
    }
    const loader = new RendererPluginLoader(context, async () => ({ apply: NamespaceService }));
    await loader.load([{ id: "namespace-service", name: "@scope/namespace-service" }]);
    expect(loader.resolve("namespace-service").status.state).toBe("loaded");
    expect((context.get("rendererContributions") as { list: () => unknown[] }).list()).toHaveLength(1);
  });

  it("calls a class plugin disposer when its entry is removed", async () => {
    const context = createRendererContext(new Context());
    let disposed = 0;
    class DisposableService {
      static inject = ["rendererContributions"] as const;
      constructor(_ctx: Context) {}
      dispose() { disposed += 1; }
    }
    const loader = new RendererPluginLoader(context, async () => ({ default: DisposableService }));
    await loader.load([{ id: "service", name: "@scope/service" }]);
    await loader.remove("service");
    expect(disposed).toBe(1);
  });
});
