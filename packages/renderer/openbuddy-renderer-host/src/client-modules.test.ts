import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { ClientModuleSystem, type ClientBundleRegistration, type ClientModuleFactory } from "./client-modules";

describe("ClientModuleSystem", () => {
  it("materializes and lists registrations queued by a banner bundle", async () => {
    const registrationTarget = {
      mode: "queue" as const,
      pendingQueue: [] as ClientBundleRegistration[],
      load(registration: ClientBundleRegistration) { this.pendingQueue.push(registration); },
    };
    const system = new ClientModuleSystem({
      entries: [{ id: "queued", name: "queued/client" }],
      resolveModuleUrl: () => "file:///queued/client.js",
      registrationTarget,
      loadBundle: async () => {
        registrationTarget.pendingQueue.push({ id: "queued", factory: () => ({ loaded: true }) });
      },
      importModule: async () => { throw new Error("queued bundle should not use ESM fallback"); },
    });

    await expect(system.import("queued/client")).resolves.toEqual({ loaded: true });
    expect(system.list().map((record) => record.id)).toEqual(["queued"]);
  });

  it("arrives external modules before materializing a factory consumer", async () => {
    const loaded: string[] = [];
    const system = new ClientModuleSystem({
      entries: [
        { id: "consumer", name: "consumer/client", external: ["provider/client"] },
        { id: "provider", name: "provider/client" },
      ],
      resolveModuleUrl: (entry) => entry.id,
      importModule: async (entry) => {
        loaded.push(entry.id);
        const registrations: Record<string, ClientBundleRegistration> = {
          provider: { id: "provider", factory: () => ({ value: 42 }) },
          consumer: { id: "consumer", factory: ((require: Parameters<ClientModuleFactory>[0]) => ({ value: (require("provider/client") as { value: number }).value + 1 })) },
        };
        return { registration: registrations[entry.id] };
      },
    });
    await expect(system.import("consumer/client")).resolves.toEqual({ value: 43 });
    expect(loaded).toEqual(["provider", "consumer"]);
  });

  it("supports static modules and invalidation", async () => {
    let version = 0;
    const system = new ClientModuleSystem({
      entries: [{ id: "plugin", name: "plugin/client" }],
      staticModules: { react: { version: 18 } },
      resolveModuleUrl: () => "plugin",
      importModule: async () => ({ registration: { id: "plugin", factory: ((require: Parameters<ClientModuleFactory>[0]) => ({ version: ++version, react: require("react") })) } }),
    });
    await expect(system.import("react")).resolves.toEqual({ version: 18 });
    await expect(system.import("plugin/client")).resolves.toMatchObject({ version: 1 });
    system.invalidate("plugin");
    await expect(system.import("plugin/client")).resolves.toMatchObject({ version: 2 });
  });

  it("does not commit a bundle that finishes after invalidation", async () => {
    let release: (() => void) | undefined;
    let startedResolve: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    let version = 0;
    let attempts = 0;
    const system = new ClientModuleSystem({
      entries: [{ id: "plugin", name: "plugin/client" }],
      resolveModuleUrl: () => "plugin",
      importModule: async () => {
        attempts += 1;
        if (attempts > 1) return { registration: { id: "plugin", factory: () => ({ version: ++version }) } };
        startedResolve?.();
        await new Promise<void>((resolve) => { release = resolve; });
        return { registration: { id: "plugin", factory: () => ({ version: ++version }) } };
      },
    });
    const pending = system.import("plugin/client");
    await started;
    expect(system.invalidate("plugin")).toEqual(["plugin"]);
    release?.();
    await expect(pending).rejects.toThrow("arrival invalidated for plugin");
    await expect(system.import("plugin/client")).resolves.toEqual({ version: 1 });
  });

  it("retries a new import after an invalidated arrival settles", async () => {
    let release: (() => void) | undefined;
    let attempts = 0;
    const system = new ClientModuleSystem({
      entries: [{ id: "plugin", name: "plugin/client" }],
      resolveModuleUrl: () => "plugin",
      importModule: async () => {
        attempts += 1;
        if (attempts === 1) {
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return { registration: { id: "plugin", factory: () => ({ attempts }) } };
      },
    });
    const pending = system.import("plugin/client");
    await Promise.resolve();
    system.invalidate("plugin");
    const retry = system.import("plugin/client");
    release?.();
    await expect(pending).rejects.toThrow("arrival invalidated for plugin");
    await expect(retry).resolves.toEqual({ attempts: 2 });
  });

  it("cleans styles when a factory throws before materialization", async () => {
    const system = new ClientModuleSystem({
      entries: [{ id: "broken", name: "broken/client" }],
      resolveModuleUrl: () => "broken",
      importModule: async () => ({
        registration: {
          id: "broken",
          factory: () => {
            const style = document.createElement("style");
            style.textContent = ".broken { color: red; }";
            document.head.append(style);
            throw new Error("factory failed");
          },
        },
      }),
    });
    await expect(system.import("broken/client")).rejects.toThrow("factory failed");
    expect(document.head.querySelector('style[data-plugin="broken"]')).toBeNull();
    expect(system.list()).toEqual([]);
  });

  it("rejects missing dynamic external providers before loading the graph", async () => {
    const system = new ClientModuleSystem({
      entries: [{ id: "consumer", name: "consumer/client", external: ["missing/client"] }],
      resolveModuleUrl: () => "file:///consumer.js",
    });

    await expect(system.bootGraph()).rejects.toThrow("cannot resolve external missing/client requested by consumer");
    await expect(system.prefetch("consumer")).rejects.toThrow("cannot resolve external missing/client requested by consumer");
  });

  it("rejects a dynamic external self-request with a specific diagnostic", async () => {
    const system = new ClientModuleSystem({
      entries: [{ id: "consumer", name: "consumer/client", external: ["consumer/client"] }],
      resolveModuleUrl: () => "file:///consumer.js",
    });

    await expect(system.bootGraph()).rejects.toThrow("consumer requests its own package consumer/client");
    await expect(system.prefetch("consumer")).rejects.toThrow("consumer requests its own package consumer/client");
  });

  it("invalidates materialized consumers when a required module changes", async () => {
    let version = 0;
    const system = new ClientModuleSystem({
      entries: [
        { id: "provider", name: "provider/client" },
        { id: "consumer", name: "consumer/client", external: ["provider/client"] },
      ],
      resolveModuleUrl: (entry) => entry.id,
      importModule: async (entry) => ({ registration: {
        id: entry.id,
        factory: (require: Parameters<ClientModuleFactory>[0]) => entry.id === "provider"
          ? { version: ++version }
          : { provider: require("provider/client") },
      } }),
    });
    await expect(system.import("consumer/client")).resolves.toEqual({ provider: { version: 1 } });
    expect(system.invalidate("provider").sort()).toEqual(["consumer", "provider"]);
    await expect(system.import("consumer/client")).resolves.toEqual({ provider: { version: 2 } });
  });

  it("claims module styles and removes owned styles on invalidation", async () => {
    const system = new ClientModuleSystem({
      entries: [{ id: "styled", name: "styled/client" }],
      resolveModuleUrl: () => "styled",
      importModule: async () => ({
        registration: {
          id: "styled",
          factory: () => {
            const style = document.createElement("style");
            style.textContent = ".styled { color: red; }";
            document.head.append(style);
            return { styled: true };
          },
        },
      }),
    });
    await system.import("styled/client");
    expect(document.head.querySelector('style[data-plugin="styled"]')).not.toBeNull();
    expect(system.list()[0]?.styles).toEqual(["styled"]);
    expect(system.invalidate("styled")).toEqual(["styled"]);
    expect(document.head.querySelector('style[data-plugin="styled"]')).toBeNull();
  });

  it("releases module-owned styles and rejects imports after disposal", async () => {
    const system = new ClientModuleSystem({
      entries: [{ id: "owned", name: "owned/client" }],
      resolveModuleUrl: () => "owned",
      importModule: async () => ({
        registration: {
          id: "owned",
          factory: () => {
            const style = document.createElement("style");
            style.textContent = ".owned { color: blue; }";
            document.head.append(style);
            return { owned: true };
          },
        },
      }),
    });
    await system.import("owned/client");
    expect(document.head.querySelector('style[data-plugin="owned"]')).not.toBeNull();
    system.dispose();
    system.dispose();
    expect(document.head.querySelector('style[data-plugin="owned"]')).toBeNull();
    expect(system.list()).toEqual([]);
    await expect(system.import("owned/client")).rejects.toThrow("module system is disposed");
  });

  it("does not remove a replacement graph's same-id styles", async () => {
    const createSystem = () => new ClientModuleSystem({
      entries: [{ id: "shared", name: "shared/client" }],
      resolveModuleUrl: () => "shared",
      importModule: async () => ({
        registration: {
          id: "shared",
          factory: () => {
            const style = document.createElement("style");
            style.textContent = ".shared { color: green; }";
            document.head.append(style);
            return { shared: true };
          },
        },
      }),
    });
    const previous = createSystem();
    const replacement = createSystem();
    await previous.import("shared/client");
    await replacement.import("shared/client");
    expect(document.querySelectorAll('style[data-plugin="shared"]')).toHaveLength(2);
    previous.dispose();
    expect(document.querySelectorAll('style[data-plugin="shared"]')).toHaveLength(1);
    replacement.dispose();
    expect(document.querySelectorAll('style[data-plugin="shared"]')).toHaveLength(0);
  });

  it("detects external cycles before loading code", async () => {
    const system = new ClientModuleSystem({
      entries: [
        { id: "a", name: "a/client", external: ["b/client"] },
        { id: "b", name: "b/client", external: ["a/client"] },
      ],
      resolveModuleUrl: (entry) => entry.id,
      importModule: async () => ({}) ,
    });
    await expect(system.prefetch("a")).rejects.toThrow("external cycle");
  });

  it("projects the DeepSeek-style boot graph and prefetches immediate entries", async () => {
    const loaded: string[] = [];
    const system = new ClientModuleSystem({
      entries: [
        { id: "infra", name: "@scope/infra/client", immediately: true },
        { id: "feature", name: "@scope/feature/client", external: ["@scope/infra/client"] },
      ],
      resolveModuleUrl: (entry) => `/plugins/${entry.id}/client.js`,
      importModule: async (entry) => {
        loaded.push(entry.id);
        return { registration: { id: entry.id, factory: () => ({ id: entry.id }) } };
      },
    });
    await Promise.all([
      system.prefetch("infra"),
      system.bootGraph().then((graph) => expect(graph).toEqual({
        rev: expect.stringMatching(/^openbuddy-client-[0-9a-f]+$/),
        entries: [
          { id: "infra", url: "/plugins/infra/client.js", rev: expect.any(String), immediately: true },
          { id: "feature", url: "/plugins/feature/client.js", rev: expect.any(String), external: ["@scope/infra/client"] },
        ],
      })),
    ]);
    expect(loaded).toEqual(["infra"]);
  });

  it("executes a real browser-style bundle registration through the module facade", async () => {
    const previous = (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__;
    const registrationTarget = {
      mode: "queue" as const,
      pendingQueue: [] as ClientBundleRegistration[],
      load(registration: ClientBundleRegistration) { this.pendingQueue.push(registration); },
    };
    (globalThis as { __ModuleLoader__?: typeof registrationTarget }).__ModuleLoader__ = registrationTarget;
    try {
      const system = new ClientModuleSystem({
        entries: [{ id: "real", name: "@scope/real/client" }],
        staticModules: { react: { version: "18" } },
        resolveModuleUrl: () => "file:///plugins/real/client.js",
        registrationTarget,
        loadBundle: async () => {
          registrationTarget.load({
            id: "real",
            factory: (require) => ({ ok: (require("react") as { version: string }).version }),
          });
        },
      });
      await expect(system.import("real/client")).resolves.toEqual({ ok: "18" });
    } finally {
      (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = previous;
    }
  });

  it("resolves DeepSeek Cordis aliases from the browser static module table", async () => {
    const registrationTarget = {
      mode: "queue" as const,
      pendingQueue: [] as ClientBundleRegistration[],
      load(registration: ClientBundleRegistration) { this.pendingQueue.push(registration); },
    };
    const cordis = { Context: class Context {}, Service: class Service {} };
    const system = new ClientModuleSystem({
      entries: [{ id: "aliases", name: "@scope/aliases/client" }],
      staticModules: {
        "@deepseek-ai/cordis": cordis,
        "@cordisjs/core": cordis,
      },
      resolveModuleUrl: () => "file:///plugins/aliases/client.js",
      registrationTarget,
      loadBundle: async () => {
        registrationTarget.load({
          id: "aliases",
          factory: (require) => ({
            sameContext: (require("@deepseek-ai/cordis") as typeof cordis).Context
              === (require("@cordisjs/core") as typeof cordis).Context,
          }),
        });
      },
    });
    await expect(system.import("@scope/aliases/client")).resolves.toEqual({ sameContext: true });
  });

  it("executes banner-style client.js files with package externals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openbuddy-client-bundle-"));
    const providerPath = join(directory, "provider-client.js");
    const consumerPath = join(directory, "consumer-client.js");
    await writeFile(providerPath, `window.__ModuleLoader__.load({ id: "@scope/provider", factory: () => ({ value: 41 }) });\n`);
    await writeFile(consumerPath, `window.__ModuleLoader__.load({ id: "@scope/consumer", factory: (require) => ({ value: require("@scope/provider/client").value + 1 }) });\n`);

    const previousWindow = (globalThis as { window?: unknown }).window;
    const previousLoader = (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__;
    const registrationTarget = {
      mode: "queue" as const,
      pendingQueue: [] as ClientBundleRegistration[],
      load(registration: ClientBundleRegistration) { this.pendingQueue.push(registration); },
    };
    Object.assign(globalThis, { window: globalThis, __ModuleLoader__: registrationTarget });
    try {
      const system = new ClientModuleSystem({
        entries: [
          { id: "consumer", moduleId: "@scope/consumer", name: "@scope/consumer/client", external: ["@scope/provider/client"] },
          { id: "provider", moduleId: "@scope/provider", name: "@scope/provider/client" },
        ],
        resolveModuleUrl: (entry) => pathToFileURL(entry.id === "provider" ? providerPath : consumerPath).href,
        loadBundle: async (_entry, url) => {
          const source = await readFile(fileURLToPath(url), "utf8");
          vm.runInThisContext(source, { filename: fileURLToPath(url) });
        },
        importModule: async () => { throw new Error("banner bundle should not use ESM fallback"); },
        registrationTarget,
      });
      await expect(system.import("@scope/consumer/client")).resolves.toEqual({ value: 42 });
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previousWindow;
      if (previousLoader === undefined) delete (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__;
      else (globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = previousLoader;
    }
  });

  it("normalizes /client aliases for static DeepSeek compatibility modules", async () => {
    const compatibility = { SlotRegistry: class SlotRegistry {} };
    const registrationTarget = {
      mode: "queue" as const,
      pendingQueue: [] as ClientBundleRegistration[],
      load(registration: ClientBundleRegistration) { this.pendingQueue.push(registration); },
    };
    const system = new ClientModuleSystem({
      entries: [{ id: "aliases", name: "@scope/aliases/client" }],
      staticModules: { "@deepseek-ai/dsh-client-runtime/client": compatibility },
      resolveModuleUrl: () => "file:///plugins/aliases/client.js",
      registrationTarget,
      loadBundle: async () => {
        registrationTarget.load({
          id: "aliases",
          factory: (require) => ({ sameRuntime: require("@deepseek-ai/dsh-client-runtime") === compatibility }),
        });
      },
    });
    await expect(system.import("@scope/aliases/client")).resolves.toEqual({ sameRuntime: true });
  });
});
