import { describe, expect, it } from "vitest";
import { Context, OpenBuddyService } from "@openbuddy/cordis";
import { HarnessPluginLoader, composePluginBundles, composePluginPatches, parseCordisProfile, type PluginEntryOptions } from "./index";
import { readFile } from "node:fs/promises";

function loaderFor(modules: Record<string, unknown>) {
  return new HarnessPluginLoader({
    context: new Context(),
    importer: async (specifier) => modules[specifier],
  });
}

describe("HarnessPluginLoader", () => {
  it("bridges Pi tools and session events through a disposable plugin fiber", async () => {
    const events: unknown[] = [];
    const tools = new Map<string, unknown>();
    const context = new Context();
    context.provide("pi", {
      tools: {
        registerTool(tool: { name: string }) {
          tools.set(tool.name, tool);
          return () => tools.delete(tool.name);
        },
      },
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async () => ({
        inject: ["pi"],
        apply: (ctx: Context) => {
          const pi = ctx.get("pi") as {
            tools: { registerTool: (tool: { name: string }) => () => void };
          };
          const unregister = pi.tools.registerTool({ name: "deepseek_tool" });
          ctx.on("session/event", (_session: unknown, event: unknown) => events.push(event));
          return unregister;
        },
      }),
    });

    await loader.load([{ id: "deepseek-plugin", name: "deepseek-plugin", inject: ["pi"] }]);
    const session = { sessionId: "session-1" };
    const event = { type: "turn_start" };
    context.emit("session/event", session, event);
    expect(tools.has("deepseek_tool")).toBe(true);
    expect(events).toEqual([event]);

    await loader.dispose();
    expect(tools.has("deepseek_tool")).toBe(false);
  });

  it("serializes concurrent public mutations without interleaving fibers", async () => {
    const lifecycle: string[] = [];
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => ({
        apply: async () => {
          lifecycle.push(`load:${specifier}`);
          if (specifier === "first") await firstReady;
          return () => lifecycle.push(`dispose:${specifier}`);
        },
      }),
    });

    const first = loader.load([{ id: "first", name: "first" }]);
    const second = loader.load([{ id: "second", name: "second" }]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lifecycle).toEqual(["load:first"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(lifecycle).toEqual(["load:first", "load:second"]);
    await loader.dispose();
  });

  it("runs DeepSeek-style Service classes with inject, events, effects, and disposal", async () => {
    const calls: string[] = [];
    class HarnessStyleService extends OpenBuddyService {
      static inject = ["dependency"];
      static Config = {};

      constructor(ctx: Context) {
        super(ctx, "harnessStyle");
        expect(ctx.get("dependency")).toEqual({ ready: true });
        ctx.on("harness/ping", () => calls.push("event"));
        ctx.effect(() => () => calls.push("effect-dispose"));
      }
    }
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => specifier === "provider"
        ? { provide: "dependency", apply: (ctx: Context) => { ctx.provide("dependency", { ready: true }); } }
        : HarnessStyleService,
    });

    await loader.load([
      { id: "provider", name: "provider" },
      { id: "service", name: "service" },
    ]);
    context.emit("harness/ping");
    expect(calls).toEqual(["event"]);
    await loader.dispose();
    expect(calls).toEqual(["event", "effect-dispose"]);
  });

  it("prefers a default Service export over a non-callable namespace apply field", async () => {
    class GoalService extends OpenBuddyService {
      static inject = [] as const;
      constructor(ctx: Context) {
        super(ctx, "goals");
      }
    }
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async () => ({ default: GoalService, apply: { generated: true } }),
    });

    await loader.load([{ id: "goal", name: "@deepseek-ai/dsh-goal" }]);
    expect(loader.resolve("goal").status.state).toBe("loaded");
    expect(context.get("goals")).toBeDefined();
    await loader.dispose();
    expect(context.get("goals")).toBeUndefined();
  });

  it("loads name/inject/apply modules and disposes their fibers", async () => {
    const calls: string[] = [];
    const entries: PluginEntryOptions[] = [
      { id: "provider", name: "provider" },
      { id: "consumer", name: "consumer", inject: ["provider"] },
    ];
    const loader = loaderFor({
      provider: { name: "provider", provide: "provider", apply: (ctx: Context) => { ctx.provide("provider", { ready: true }); calls.push("load:provider"); return () => calls.push("dispose:provider"); } },
      consumer: { name: "consumer", inject: ["provider"], apply: (ctx: Context) => { expect(ctx.get("provider")).toEqual({ ready: true }); calls.push("load:consumer"); return () => calls.push("dispose:consumer"); } },
    });
    await loader.load(entries);
    expect(loader.list().map((entry) => entry.state)).toEqual(["loaded", "loaded"]);
    await loader.dispose();
    expect(calls).toEqual(["load:provider", "load:consumer", "dispose:consumer", "dispose:provider"]);
  });

  it("disposes changed dependency graphs in reverse dependency order during profile replacement", async () => {
    const calls: string[] = [];
    const loader = loaderFor({
      provider: { provide: "provider", apply: (ctx: Context) => { ctx.set("provider", { version: 1 }); calls.push("load:provider:1"); return () => calls.push("dispose:provider:1"); } },
      consumer: { inject: ["provider"], apply: (ctx: Context) => { const version = (ctx.get("provider") as { version: number }).version; calls.push(`load:consumer:${version}`); return () => calls.push(`dispose:consumer:${version}`); } },
      providerV2: { provide: "provider", apply: (ctx: Context) => { ctx.set("provider", { version: 2 }); calls.push("load:provider:2"); return () => calls.push("dispose:provider:2"); } },
    });

    await loader.load([
      { id: "provider", name: "provider" },
      { id: "consumer", name: "consumer", inject: ["provider"] },
    ]);
    await loader.replaceProfile({ entries: [
      { id: "provider", name: "providerV2" },
      { id: "consumer", name: "consumer", inject: ["provider"] },
    ] });

    expect(calls).toEqual([
      "load:provider:1",
      "load:consumer:1",
      "dispose:consumer:1",
      "dispose:provider:1",
      "load:provider:2",
      "load:consumer:2",
    ]);
    await loader.dispose();
  });

  it("keeps function plugin inject metadata on the Cordis fiber", async () => {
    let observed: unknown;
    const loader = loaderFor({
      provider: { provide: "provider", apply: (ctx: Context) => { ctx.provide("provider", { ready: true }); } },
      consumer: {
        inject: ["provider"],
        apply: (ctx: Context) => { observed = ctx.get("provider"); },
      },
    });
    await loader.load([
      { id: "consumer", name: "consumer" },
      { id: "provider", name: "provider" },
    ]);
    expect(observed).toEqual({ ready: true });
  });

  it("awaits asynchronous function-plugin cleanup during dispose", async () => {
    let releaseCleanup: (() => void) | undefined;
    let cleanupFinished = false;
    const loader = loaderFor({
      asyncCleanup: {
        apply: () => async () => {
          await new Promise<void>((resolve) => { releaseCleanup = resolve; });
          cleanupFinished = true;
        },
      },
    });
    await loader.load([{ id: "async-cleanup", name: "asyncCleanup" }]);
    const disposing = loader.dispose();
    await Promise.resolve();
    expect(cleanupFinished).toBe(false);
    releaseCleanup?.();
    await disposing;
    expect(cleanupFinished).toBe(true);
  });

  it("cleans effects registered before a failed apply", async () => {
    const context = new Context();
    let disposed = 0;
    const loader = new HarnessPluginLoader({
      context,
      importer: async () => ({
        apply: (ctx: Context) => {
          ctx.effect(() => () => { disposed += 1; });
          throw new Error("apply failed after registration");
        },
      }),
    });

    await expect(loader.load([{ id: "broken", name: "broken" }])).rejects.toThrow("apply failed after registration");
    expect(disposed).toBe(1);
    expect(loader.list()).toEqual([]);
  });

  it("awaits asynchronous Service stop during dispose", async () => {
    let releaseStop: (() => void) | undefined;
    let stopFinished = false;
    class AsyncService extends OpenBuddyService {
      static inject = [] as const;
      async stop(): Promise<void> {
        await new Promise<void>((resolve) => { releaseStop = resolve; });
        stopFinished = true;
      }
    }
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => AsyncService,
    });
    await loader.load([{ id: "async-service", name: "async-service" }]);
    const disposing = loader.dispose();
    await Promise.resolve();
    expect(stopFinished).toBe(false);
    releaseStop?.();
    await disposing;
    expect(stopFinished).toBe(true);
  });

  it("orders modules from their Harness inject metadata", async () => {
    const calls: string[] = [];
    const loader = loaderFor({
      consumer: { name: "consumer", inject: ["provider"], apply: () => { calls.push("consumer"); } },
      provider: { name: "provider", provide: "provider", apply: (ctx: Context) => { ctx.provide("provider", { ready: true }); calls.push("provider"); } },
    });
    await loader.load([
      { id: "consumer", name: "consumer" },
      { id: "provider", name: "provider" },
    ]);
    expect(calls).toEqual(["provider", "consumer"]);
  });

  it("reports missing and cyclic module dependencies", async () => {
    const loader = loaderFor({
      a: { inject: ["b"], apply: () => undefined },
      b: { inject: ["a"], apply: () => undefined },
    });
    await expect(loader.load([{ id: "a", name: "a" }, { id: "b", name: "b" }]))
      .rejects.toThrow("unresolved inject dependencies");
  });

  it("allows incremental entries to inject an already-loaded provider", async () => {
    const calls: string[] = [];
    const loader = loaderFor({
      provider: { provide: "provider-service", apply: (ctx: Context) => { ctx.provide("provider-service", { ready: true }); calls.push("provider"); } },
      consumer: { inject: ["provider-service"], apply: (ctx: Context) => { expect(ctx.get("provider-service")).toEqual({ ready: true }); calls.push("consumer"); } },
    });
    await loader.load([{ id: "provider-entry", name: "provider" }]);
    await loader.load([{ id: "consumer", name: "consumer" }]);
    expect(calls).toEqual(["provider", "consumer"]);
  });

  it("supports disabled entries and patch insertion/replacement", () => {
    expect(composePluginPatches(
      [{ id: "base", name: "base" }],
      [[{ insert: { id: "extra", name: "extra" } }], [{ id: "extra", config: { enabled: true } }, { insert: { id: "disabled", name: "disabled", disabled: true } }]],
    )).toEqual([
      { id: "base", name: "base" },
      { id: "extra", name: "extra", config: { enabled: true } },
      { id: "disabled", name: "disabled", disabled: true },
    ]);
  });

  it("rolls back a failed replacement to the previous module", async () => {
    const calls: string[] = [];
    let failing = false;
    const loader = loaderFor({
      stable: { apply: () => () => calls.push("dispose:stable") },
      replacement: { apply: () => { if (failing) throw new Error("replacement failed"); return () => calls.push("dispose:replacement"); } },
    });
    await loader.load([{ id: "agent", name: "stable" }]);
    failing = true;
    await expect(loader.update("agent", { name: "replacement" })).rejects.toThrow("replacement failed");
    expect(loader.list().find((entry) => entry.id === "agent")?.state).toBe("loaded");
    await loader.dispose();
    expect(calls).toContain("dispose:stable");
  });

  it("parses a safe cordis profile subset and composes bundle overlays", () => {
    const profile = parseCordisProfile(`entries:\n  - id: base\n    name: base\n    disabled: false`);
    expect(profile.entries).toEqual([{ id: "base", name: "base", disabled: false }]);
    expect(composePluginBundles([
      { entries: [{ id: "base", name: "base" }] },
      { entries: [{ id: "feature", name: "feature" }] },
    ], { entries: [{ id: "user", name: "user" }] }).entries.map((entry) => entry.id))
      .toEqual(["base", "feature", "user"]);
  });

  it("isolates plugin lifecycle event listeners", async () => {
    const events: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ apply: () => undefined }),
      onEvent: (type) => { events.push(type); if (type === "plugin/loaded") throw new Error("listener failure"); },
    });
    await loader.load([{ id: "example", name: "example" }]);
    await loader.dispose();
    // Deepseek-harness parity: emit Cordis-style lifecycle events
    // (`loader/entry-init`, `loader/patch-context`, `loader/partial-dispose`)
    // alongside the legacy string events the UI panel consumes.
    expect(events).toEqual([
      "loader/entry-init",
      "plugin/loaded",
      "loader/patch-context",
      "plugin/unloaded",
      "loader/partial-dispose",
    ]);
  });

  it("supports explicit reload through the same lifecycle", async () => {
    let loads = 0;
    const loader = loaderFor({ example: { apply: () => { loads += 1; } } });
    await loader.load([{ id: "example", name: "example" }]);
    await loader.reload("example");
    expect(loads).toBe(2);
  });
});

describe("deepseek-harness parity", () => {
  it("resolve() returns entry + status by id; throws on unknown", async () => {
    const loader = loaderFor({ example: { apply: () => undefined } });
    await loader.load([{ id: "example", name: "example" }]);
    const resolved = loader.resolve("example");
    expect(resolved.entry.id).toBe("example");
    expect(resolved.status.state).toBe("loaded");
    expect(() => loader.resolve("nope")).toThrow(/cannot resolve/);
  });

  it("create() loads a DeepSeek-style dynamic entry and returns its id", async () => {
    const loader = loaderFor({ "@scope/dynamic/client": { apply: () => undefined } });
    const id = await loader.create({ name: "@scope/dynamic/client" });
    expect(id).toBe("@scope/dynamic/client");
    expect(loader.resolve(id).status.state).toBe("loaded");
  });

  it("locate() maps a plugin module name back to its entry id", async () => {
    const loader = loaderFor({ "@scope/foo": { apply: () => undefined } });
    await loader.load([{ id: "foo", name: "@scope/foo" }]);
    expect(loader.locate("@scope/foo")).toBe("foo");
    expect(loader.locate("@scope/missing")).toBeNull();
  });

  it("await() resolves immediately when no entries are in flight", async () => {
    const loader = loaderFor({ example: { apply: () => undefined } });
    await loader.load([{ id: "example", name: "example" }]);
    await expect(loader.await()).resolves.toBeUndefined();
  });

  it("update() emits loader/config-update alongside the existing reload path", async () => {
    const events: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ apply: () => undefined }),
      onEvent: (type) => events.push(type),
    });
    await loader.load([{ id: "example", name: "example" }]);
    events.length = 0;
    await loader.update("example", { disabled: true });
    expect(events).toContain("loader/config-update");
    expect(loader.list().find((entry) => entry.id === "example")?.state).toBe("disabled");
  });

  it("entries with group?: true compose without losing the flag", async () => {
    const loader = loaderFor({ "@scope/group": { apply: () => undefined } });
    await loader.load([{ id: "g", name: "@scope/group", group: true }]);
    expect(loader.resolve("g").entry.group).toBe(true);
  });


  it("loads group children under `${groupId}:${childId}` ids", async () => {
    const calls: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => {
        if (specifier === "@scope/parent") {
          return { name: "@scope/parent", apply: () => () => calls.push("dispose:parent") };
        }
        if (specifier === "@scope/child-a") {
          return { name: "@scope/child-a", apply: () => () => calls.push("dispose:child-a") };
        }
        if (specifier === "@scope/child-b") {
          return { name: "@scope/child-b", apply: () => () => calls.push("dispose:child-b") };
        }
        throw new Error(`unknown specifier ${specifier}`);
      },
    });
    await loader.load([
      {
        id: "group",
        name: "@scope/parent",
        group: true,
        children: [
          { id: "a", name: "@scope/child-a" },
          { id: "b", name: "@scope/child-b", inject: ["a"] },
        ],
      },
    ]);
    expect(loader.resolve("group").status.state).toBe("loaded");
    expect(loader.resolve("group:a").status.state).toBe("loaded");
    expect(loader.resolve("group:b").status.state).toBe("loaded");
    // listGroup returns the namespaced children only.
    const children = loader.listGroup("group");
    expect(children.map((entry) => entry.id).sort()).toEqual(["group:a", "group:b"]);
    // listGroups surfaces the parent.
    expect(loader.listGroups()).toContain("group");
  });

  it("passes composition base URLs to relative plugin imports", async () => {
    let receivedBase: string | undefined;
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier, baseUrl) => {
        receivedBase = baseUrl;
        expect(specifier).toBe("./relative-plugin.js");
        return { apply: () => undefined };
      },
    });
    await loader.loadCordisComposition("- id: relative\n  name: ./relative-plugin.js\n", {
      baseUrl: "file:///tmp/preset/agent.cordis.yml",
    });
    expect(receivedBase).toBe("file:///tmp/preset/agent.cordis.yml");
    await loader.dispose();
  });

  it("lets an explicit entry inject list override module metadata", async () => {
    let applied = false;
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({
        inject: ["optional-service"],
        apply: () => { applied = true; },
      }),
    });
    await loader.load([{ id: "consumer", name: "consumer", inject: [] }]);
    expect(applied).toBe(true);
    expect(loader.resolve("consumer").fiber?.inject).toEqual({});
    await loader.dispose();
  });

  it("patches group children and removes namespaced descendants with the parent", async () => {
    const loader = loaderFor({
      "@scope/group": { apply: () => undefined },
      "@scope/child": { apply: () => undefined },
    });
    await loader.load([{ id: "group", name: "@scope/group", group: true }]);
    await loader.update("group", {
      children: [{ id: "child", name: "@scope/child" }],
    });
    expect(loader.listGroup("group").map((entry) => entry.id)).toEqual(["group:child"]);
    await loader.remove("group");
    expect(loader.listGroup("group")).toEqual([]);
    expect(() => loader.resolve("group:child")).toThrow();
  });

  it("a group without children is still loadable (deepseek empty-group)", async () => {
    const loader = loaderFor({ "@scope/empty-group": { apply: () => undefined } });
    await loader.load([{ id: "empty", name: "@scope/empty-group", group: true }]);
    expect(loader.listGroup("empty")).toEqual([]);
    expect(loader.listGroups()).toContain("empty");
  });


  it("loadDeepseekBundle resolves + applies a bundle from its package.json", async () => {
    const calls: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => {
        if (specifier === "@scope/timer") {
          return { name: "@scope/timer", apply: () => () => calls.push("dispose:timer") };
        }
        if (specifier === "@scope/llm") {
          return { name: "@scope/llm", apply: () => () => calls.push("dispose:llm") };
        }
        throw new Error(`unknown specifier ${specifier}`);
      },
    });
    // The path below points at a fixture package.json that declares
    // `openbuddy.bundle.patch: "./openbuddy.patch.yml"` and a sibling
    // patch file with an `insert:` block + a keyed update.
    // Resolve the fixture path relative to the package root. vitest's
    // __dirname in this test file resolves to the package's src/ dir.
    const fixturePath = require("node:path").resolve(
      __dirname,
      "__fixtures__/bundle-manifest-fixture/package.json",
    );
    const manifest = await loader.loadDeepseekBundle(fixturePath, {
      importer: () => fixturePath,
    });
    expect(manifest.field.patch).toBe("./openbuddy.patch.yml");
    expect(loader.resolve("timer").status.state).toBe("loaded");
    // Note: the fixture patch only declares an `insert:` block; the
    // `@scope/llm` module is intentionally absent so resolve("llm")
    // would throw — we skip that assertion here.
  });

  it("loads ordered DeepSeek profile bundles with later layers winning", async () => {
    const loader = loaderFor({
      "@scope/timer": { apply: () => undefined },
      "@scope/openbuddy-settings": { apply: () => undefined },
      "@scope/openbuddy-llm": { apply: () => undefined },
      "@scope/openbuddy-extensions": { apply: () => undefined },
      "@scope/openbuddy-ext-logger": { apply: () => undefined },
      "@scope/openbuddy-ext-tracer": { apply: () => undefined },
      "@scope/openbuddy-agent": { apply: () => undefined },
      "@scope/openbuddy-transport": { apply: () => undefined },
    });
    const manifests: Record<string, string> = {
      base: `${__dirname}/__fixtures__/bundle-manifest-fixture/package.json`,
      overlay: `${__dirname}/__fixtures__/deepseek-sample-bundle/package.json`,
    };
    await loader.loadDeepseekProfile(["base", "overlay"], {
      importer: (specifier) => manifests[specifier]!,
      patchLoader: async (path) => {
        return readFile(path, "utf8");
      },
    });
    expect(loader.resolve("timer").status.state).toBe("loaded");
    expect(loader.resolve("agent").status.state).toBe("loaded");
  });


  it("provides itself as ctx.loader so plugins can introspect entries", async () => {
    const ctx = new Context();
    const loader = new HarnessPluginLoader({
      context: ctx,
      importer: async () => ({ apply: () => undefined }),
    });
    // ctx.get() returns a Proxy that wraps the registered value, so we
    // verify identity via the loader's own list() method rather than
    // via Object.is (which fails on Proxies).
    const fromContext = ctx.get("loader") as HarnessPluginLoader;
    expect(typeof fromContext.list).toBe("function");
    expect(fromContext.list()).toEqual(loader.list());
    // Both names resolve to the same loader — back-compat with the
    // original `pluginLoader` name + the deepseek-style `loader` alias.
    const pluginLoader = ctx.get("pluginLoader") as HarnessPluginLoader;
    expect(pluginLoader.list()).toEqual(loader.list());
  });

  it("iterates entry metadata including disabled and grouped entries", async () => {
    const loader = loaderFor({
      group: { apply: () => undefined },
      child: { apply: () => undefined },
    });
    await loader.load([
      { id: "disabled", name: "disabled", disabled: true },
      { id: "group", name: "group", group: true, children: [{ id: "child", name: "child" }] },
    ]);
    expect([...loader.entries()].map((entry) => entry.id)).toEqual(["disabled", "group", "group:child"]);
    expect(loader.resolve("disabled").status.state).toBe("disabled");
    expect([...loader.entries()].find((entry) => entry.id === "group:child")?.options.id).toBe("group:child");
  });

  it("exposes fiber-shaped metadata for an active entry", async () => {
    const loader = loaderFor({ example: { apply: () => undefined } });
    await loader.load([{ id: "example", name: "example" }]);
    const entry = [...loader.entries()][0];
    expect(entry?.disabled).toBe(false);
    expect(entry?.fiber?.state).toBe("loaded");
    expect(entry?.fiber?.ctx).toBeDefined();
    await entry?.fiber?.await();
  });

  it("loader.on() subscribes to loader/* lifecycle events; mirrors ctx.on()", async () => {
    const ctx = new Context();
    const seen: Array<{ type: string; payload: unknown }> = [];
    const loader = new HarnessPluginLoader({
      context: ctx,
      importer: async () => ({ apply: () => undefined }),
    });
    const off = loader.on("loader/entry-init", (payload) => seen.push({ type: "loader/entry-init", payload }));
    await loader.load([{ id: "example", name: "example" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload).toMatchObject({ id: "example" });
    off();
    // After unsubscribe, no further events arrive.
    await loader.load([{ id: "another", name: "another" }]);
    expect(seen).toHaveLength(1);
  });

  it("forwards loader lifecycle events to the actual Cordis ctx.on() bus", async () => {
    const ctx = new Context();
    const seen: Array<{ id: string; name: string }> = [];
    ctx.on("loader/entry-init", (payload: { id: string; name: string }) => {
      seen.push({ id: payload.id, name: payload.name });
    });
    const loader = new HarnessPluginLoader({
      context: ctx,
      importer: async () => ({ apply: () => undefined }),
    });
    await loader.load([{ id: "example", name: "example" }]);
    expect(seen).toEqual([{ id: "example", name: "example" }]);
  });

  it("loader.exit() is a no-op by default (subclasses override for full-reload)", async () => {
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ apply: () => undefined }),
    });
    expect(() => loader.exit()).not.toThrow();
  });

  it("loadCordisPatch parses a deepseek-style patch and applies it", async () => {
    const events: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => {
        if (specifier === "@scope/timer") return { name: "@scope/timer", apply: () => undefined };
        if (specifier === "@scope/llm") return { name: "@scope/llm", apply: () => undefined };
        throw new Error(`unknown specifier ${specifier}`);
      },
      onEvent: (type) => events.push(type),
    });
    await loader.loadCordisPatch(
      `
- insert:
    - id: timer
      name: '@scope/timer'
- id: llm
  name: '@scope/llm'
  config:
    model: !!js scopeModel
`,
      { scopeModel: "deepseek-v4" },
    );
    expect(loader.resolve("timer").status.state).toBe("loaded");
    expect(loader.resolve("llm").status.state).toBe("loaded");
    expect(loader.resolve("llm").entry.config).toEqual({ model: "deepseek-v4" });
    // Both legacy + Cordis-style events must have been emitted.
    expect(events).toContain("loader/entry-init");
    expect(events).toContain("plugin/loaded");
  });

  it("reconciles a keyed patch against the active entry tree", async () => {
    const calls: string[] = [];
    const loader = loaderFor({
      service: {
        apply: (_ctx: Context, config: { version: number }) => {
          calls.push(`load:${config.version}`);
          return () => calls.push(`dispose:${config.version}`);
        },
      },
    });
    await loader.load([{ id: "service", name: "service", config: { version: 1 } }]);
    await loader.loadCordisPatch("- id: service\n  config:\n    version: 2\n");
    expect(loader.resolve("service").entry.config).toEqual({ version: 2 });
    expect(calls).toEqual(["load:1", "dispose:1", "load:2"]);
  });

  it("rolls back the active tree when a patch replacement fails", async () => {
    const loader = loaderFor({
      service: {
        apply: (_ctx: Context, config: { fail?: boolean }) => {
          if (config.fail) throw new Error("replacement failed");
          return undefined;
        },
      },
    });
    await loader.load([{ id: "service", name: "service", config: {} }]);
    await expect(loader.loadCordisPatch("- id: service\n  config:\n    fail: true\n")).rejects.toThrow("replacement failed");
    expect(loader.resolve("service").entry.config).toEqual({});
    expect(loader.resolve("service").status.state).toBe("loaded");
  });

  it("replaces a profile from canonical entries so removed patches disappear", async () => {
    const loader = loaderFor({ service: { apply: () => undefined } });
    await loader.loadProfile({
      entries: [{ id: "service", name: "service", config: { enabled: false } }],
      patches: [[{ id: "service", config: { enabled: true } }]],
    });
    await loader.replaceProfile({
      entries: [{ id: "service", name: "service", config: { enabled: false } }],
    });
    expect(loader.resolve("service").entry.config).toEqual({ enabled: false });
  });

  it("runs function plugins in a disposable Cordis fork", async () => {
    const loader = loaderFor({
      scoped: {
        apply: (ctx: Context) => {
          ctx.provide("scopedService", true);
          ctx.set("scopedService", true);
          return undefined;
        },
      },
    });
    await loader.load([{ id: "scoped", name: "scoped" }]);
    expect(loader.getContext().get("scopedService")).toBe(true);
    await loader.remove("scoped");
    expect(loader.getContext().get("scopedService")).toBeUndefined();
  });

  it("passes Service constructor metadata through to Cordis", async () => {
    const context = new Context();
    class ConfiguredService {
      static provide = "configuredService";
      static Config = { value: String };
      static inject = ["configuredDependency"] as const;
      constructor(ctx: Context, config?: { value?: string }) {
        ctx.provide("configuredResult", { value: config?.value });
      }
    }
    context.provide("configuredDependency", true);
    context.set("configuredDependency", true);
    const loader = new HarnessPluginLoader({
      context,
      importer: async () => ({ default: ConfiguredService }),
    });
    await loader.load([{ id: "configured", name: "configured", config: { value: "ok" } }]);
    expect(context.get("configuredResult")).toEqual({ value: "ok" });
  });

  it("rolls back a partially loaded batch", async () => {
    const context = new Context();
    const calls: string[] = [];
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => {
        if (specifier === "broken") throw new Error("module import failed");
        return { apply: () => () => calls.push("disposed") };
      },
    });
    await expect(loader.load([
      { id: "working", name: "working" },
      { id: "broken", name: "broken" },
    ])).rejects.toThrow("module import failed");
    expect(loader.list()).toEqual([]);
    expect([...loader.entries()]).toEqual([]);
    expect(calls).toEqual([]);
  });
});
