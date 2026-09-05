import { describe, expect, it } from "vitest";
import { DeepSeekCordisRuntime } from "./deepseek-cordis-runtime";

class FakeContext {
  readonly services = new Map<string, unknown>();
  readonly fibers: Array<{ dispose: () => Promise<void> }> = [];
  readonly reflect = { store: Object.create(null) as Record<string, { name: string }> };
  readonly fiber = { dispose: async () => undefined };

  get(name: string): unknown {
    return this.services.get(name);
  }

  plugin(plugin: unknown): { await: () => Promise<void>; dispose: () => Promise<void> } {
    const serviceName = (plugin as { serviceName?: string }).serviceName;
    if (serviceName) {
      this.services.set(serviceName, plugin);
      this.reflect.store[serviceName] = { name: serviceName };
    }
    let disposed = false;
    const fiber = {
      await: async () => undefined,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        if (serviceName) {
          this.services.delete(serviceName);
          delete this.reflect.store[serviceName];
        }
      },
    };
    this.fibers.push(fiber);
    return fiber;
  }
}

describe("DeepSeekCordisRuntime", () => {
  it("keeps official context and fibers behind a serializable lifecycle boundary", async () => {
    const events: string[] = [];
    const context = new FakeContext();
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { constructor() { return context; } } },
      importer: async () => ({ serviceName: "sessions" }),
      onEvent: (type) => events.push(type),
    });

    const loaded = await runtime.load([{ id: "sessions", name: "session" }]);
    expect(loaded).toMatchObject({
      runtime: "deepseek-cordis",
      plugins: [{ id: "sessions", state: "active" }],
      services: ["sessions"],
      capabilities: [{ service: "sessions", methods: [] }],
      disposed: false,
    });
    expect(loaded).not.toHaveProperty("context");
    expect(loaded).not.toHaveProperty("plugins.0.fiber");

    const disposed = await runtime.dispose();
    expect(disposed).toMatchObject({
      plugins: [{ id: "sessions", state: "disposed" }],
      services: [],
      disposed: true,
    });
    expect(events).toEqual([
      "plugin/loading",
      "plugin/active",
      "plugin/disposed",
      "runtime/disposed",
    ]);
  });

  it("reports disabled and failed entries without exposing runtime objects", async () => {
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { plugin() { return { await: async () => undefined }; } } },
      importer: async (specifier) => {
        if (specifier === "broken") throw new Error("broken import");
        return {};
      },
    });

    await runtime.load([{ id: "disabled", name: "disabled", disabled: true }]);
    await expect(runtime.load([{ id: "broken", name: "broken" }])).rejects.toThrow("broken import");
    expect(runtime.getSnapshot()).toMatchObject({
      plugins: [
        { id: "disabled", state: "disabled" },
        { id: "broken", state: "failed", error: "broken import" },
      ],
    });
  });

  it("rolls back earlier entries when a batch load fails", async () => {
    const context = new FakeContext();
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { constructor() { return context; } } },
      importer: async (specifier) => {
        if (specifier === "broken") throw new Error("batch import failed");
        return { serviceName: specifier };
      },
    });

    await expect(runtime.load([{ id: "first", name: "first" }, { id: "broken", name: "broken" }])).rejects.toThrow("batch import failed");
    expect(context.services.has("first")).toBe(false);
    expect(runtime.getSnapshot()).toMatchObject({
      plugins: [{ id: "broken", state: "failed", error: "batch import failed" }],
    });
    expect(runtime.getSnapshot().plugins.some((plugin) => plugin.id === "first")).toBe(false);
  });

  it("invokes only JSON-safe service methods through the explicit boundary", async () => {
    const context = new FakeContext();
    const service = {
      add: (left: number, right: number) => left + right,
      unsafe: () => new Date(0),
    };
    context.services.set("math", service);
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { constructor() { return context; } } },
      importer: async () => ({}),
      allowInvocation: (service, method) => service === "math" && method === "add",
    });

    await expect(runtime.invoke({ service: "math", method: "add", args: [2, 3] })).resolves.toBe(5);
    await expect(runtime.invoke({ service: "math", method: "add", args: { left: 2, right: 3 }, parameters: ["left", "right"] })).resolves.toBe(5);
    await expect(runtime.invoke({ service: "math", method: "toString" })).rejects.toThrow("method is invalid");
    await expect(runtime.invoke({ service: "math", method: "unsafe" })).rejects.toThrow("invocation is not allowed");
  });

  it("boots and disposes a host-owned bridge without exposing the context", async () => {
    const context = new FakeContext() as FakeContext & { provide: (name: string, value: unknown) => void };
    context.provide = (name, value) => { context.services.set(name, value); context.reflect.store[name] = { name }; };
    let disposed = false;
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { constructor() { return context; } } },
      importer: async () => ({}),
      bootstrap: (target) => {
        (target as typeof context).provide("pi", { ping: () => ({ runtime: "pi" }) });
        return () => { disposed = true; context.services.delete("pi"); delete context.reflect.store.pi; };
      },
      allowInvocation: (service, method) => service === "pi" && method === "ping",
    });

    await runtime.load([]);
    expect(runtime.getSnapshot().services).toContain("pi");
    await expect(runtime.invoke({ service: "pi", method: "ping" })).resolves.toEqual({ runtime: "pi" });
    await runtime.dispose();
    expect(disposed).toBe(true);
    expect(runtime.getSnapshot().services).not.toContain("pi");
  });

  it("owns plugin-active adapters and disposes them before official fibers", async () => {
    const context = new FakeContext();
    const active: string[] = [];
    const disposed: string[] = [];
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: class { constructor() { return context; } } },
      importer: async (specifier) => ({ serviceName: specifier }),
      onPluginActive: (_target, entry) => {
        active.push(entry.id);
        return () => { disposed.push(entry.id); };
      },
    });

    await runtime.load([{ id: "tools", name: "@deepseek-ai/dsh-tools" }]);
    expect(active).toEqual(["tools"]);
    await runtime.dispose();
    expect(disposed).toEqual(["tools"]);
  });

  it("keeps the active runtime when a transactional replacement fails", async () => {
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: FakeContext },
      importer: async (specifier) => {
        if (specifier === "broken") throw new Error("replacement import failed");
        return { serviceName: specifier, ping: () => specifier };
      },
      allowInvocation: () => true,
    });

    await runtime.load([{ id: "old", name: "old" }]);
    await expect(runtime.invoke({ service: "old", method: "ping" })).resolves.toBe("old");
    await expect(runtime.replace([{ id: "broken", name: "broken" }])).rejects.toThrow("replacement import failed");
    await expect(runtime.invoke({ service: "old", method: "ping" })).resolves.toBe("old");
    expect(runtime.getSnapshot()).toMatchObject({ disposed: false, plugins: [{ id: "old", state: "active" }] });

    await expect(runtime.replace([{ id: "new", name: "new" }])).resolves.toMatchObject({ plugins: [{ id: "new", state: "active" }] });
    await expect(runtime.invoke({ service: "old", method: "ping" })).rejects.toThrow("service is unavailable");
    await expect(runtime.invoke({ service: "new", method: "ping" })).resolves.toBe("new");
  });

  it("commits plugin-active adapters after the old runtime is detached", async () => {
    const active: string[] = [];
    const events: string[] = [];
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: FakeContext },
      importer: async (specifier) => ({ serviceName: specifier }),
      onPluginActive: (_context, entry) => {
        active.push(`start:${entry.name}`);
        return () => { active.push(`stop:${entry.name}`); };
      },
      onEvent: (type) => events.push(type),
    });

    await runtime.load([{ id: "old", name: "old" }]);
    events.splice(0);
    await runtime.replace([{ id: "new", name: "new" }]);
    expect(active).toEqual(["start:old", "stop:old", "start:new"]);
    expect(events).toEqual(["plugin/active", "plugin/disposed"]);
  });

  it("restores the old adapter when replacement activation fails", async () => {
    const active: string[] = [];
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: FakeContext },
      importer: async (specifier) => ({ serviceName: specifier }),
      onPluginActive: (_context, entry) => {
        if (entry.name === "broken") throw new Error("adapter activation failed");
        active.push(`start:${entry.name}`);
        return () => { active.push(`stop:${entry.name}`); };
      },
      allowInvocation: () => true,
    });

    await runtime.load([{ id: "old", name: "old" }]);
    await expect(runtime.replace([{ id: "broken", name: "broken" }])).rejects.toThrow("adapter activation failed");
    expect(active).toEqual(["start:old", "stop:old", "start:old"]);
    expect(runtime.getSnapshot()).toMatchObject({ plugins: [{ id: "old", state: "active" }], disposed: false });
    await runtime.dispose();
  });

  it("serializes load, replace, and dispose lifecycle mutations", async () => {
    const events: string[] = [];
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => { releaseLoad = resolve; });
    const runtime = new DeepSeekCordisRuntime({
      cordisModule: { Context: FakeContext },
      importer: async (specifier) => ({ serviceName: specifier }),
      bootstrap: async () => {
        events.push("bootstrap");
        await loadGate;
      },
      onEvent: (type) => events.push(type),
    });
    const load = runtime.load([{ id: "first", name: "first" }]);
    const replace = runtime.replace([{ id: "second", name: "second" }]);
    const dispose = runtime.dispose();
    await Promise.resolve();
    expect(events).toEqual(["bootstrap"]);
    releaseLoad();
    await Promise.all([load, replace, dispose]);
    expect(events.filter((event) => event === "runtime/disposed")).toHaveLength(1);
  });
});
