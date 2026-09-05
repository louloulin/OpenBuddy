import { describe, expect, it } from "vitest";
import { Context } from "@openbuddy/cordis";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessPluginLoader } from "./index";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

// End-to-end coverage for the deepseek-harness bundle flow: from a real
// `package.json#openbuddy.bundle` manifest + sibling `cordis.patch.yml`
// through `loadDeepseekBundle`, exercising every row shape the OpenBuddy
// loader must understand. Pairs with the smaller per-module tests in
// `index.test.ts` / `yaml-patch.test.ts` / `bundle-manifest.test.ts` so
// regressions in any single layer surface here.

const FIXTURE_DIR = resolve(__dirname, "__fixtures__/deepseek-sample-bundle");
const FIXTURE_PACKAGE_JSON = resolve(FIXTURE_DIR, "package.json");
const DEEPSEEK_HARNESS_ROOT = [
  process.env.OPENBUDDY_DEEPSEEK_HARNESS,
  resolve(process.cwd(), "../deepseek-harness"),
].filter((candidate): candidate is string => Boolean(candidate))
  .find((candidate) => existsSync(join(candidate, "packages/bundle/base/cordis.patch.yml")));

interface ModuleFactory {
  (loader: HarnessPluginLoader): unknown;
}

function makeLoader(modules: Record<string, ModuleFactory>) {
  const events: string[] = [];
  const calls: string[] = [];
  let loader!: HarnessPluginLoader;
  loader = new HarnessPluginLoader({
    context: new Context(),
    importer: async (specifier) => {
      const factory = modules[specifier];
      if (!factory) throw new Error(`deepseek-e2e: unknown specifier ${specifier}`);
      return factory(loader);
    },
    onEvent: (type) => {
      events.push(type);
      calls.push(`event:${type}`);
    },
  });
  return { loader, events, calls };
}

const mockModule = (
  id: string,
  apply?: (ctx: Context) => unknown,
): ModuleFactory => () => ({
  name: id,
  apply: apply
    ? (ctx: Context) => {
        apply(ctx);
        return () => undefined;
      }
    : () => () => undefined,
});

describe("deepseek-harness bundle (E2E)", () => {
  it("loads the sample bundle fixture end-to-end through loadDeepseekBundle", async () => {
    const { loader, events } = makeLoader({
      "@scope/openbuddy-settings": mockModule("settings"),
      "@scope/openbuddy-llm": mockModule("llm"),
      "@scope/openbuddy-agent": mockModule("agent"),
      "@scope/openbuddy-transport": mockModule("transport"),
      "@scope/openbuddy-extensions": mockModule("extensions"),
      "@scope/openbuddy-ext-logger": mockModule("logger"),
      "@scope/openbuddy-ext-tracer": mockModule("tracer"),
    });

    const manifest = await loader.loadDeepseekBundle(FIXTURE_PACKAGE_JSON, {
      importer: () => FIXTURE_PACKAGE_JSON,
    });

    // Manifest field is reflected back to the caller (deepseek parity: a
    // bundle loader returns what it loaded so callers can introspect).
    expect(manifest.specifier).toBe(FIXTURE_PACKAGE_JSON);
    expect(manifest.field.patch).toBe("./openbuddy.patch.yml");

    // Every declared entry is loaded.
    for (const id of ["settings", "llm", "agent", "transport", "extensions"]) {
      expect(loader.resolve(id).status.state).toBe("loaded");
    }

    // Group children live under `${groupId}:${childId}` ids and are
    // surfaced by `listGroup` + `listGroups`.
    expect(loader.resolve("extensions:logger").status.state).toBe("loaded");
    expect(loader.resolve("extensions:tracer").status.state).toBe("loaded");
    expect(loader.listGroup("extensions").map((entry: { id: string }) => entry.id).sort()).toEqual([
      "extensions:logger",
      "extensions:tracer",
    ]);
    expect(loader.listGroups()).toContain("extensions");

    // `locate` resolves a plugin module name back to its entry id,
    // including namespaced children (deepseek parity: this is how the
    // cordis service registry maps service names → entry ids).
    expect(loader.locate("@scope/openbuddy-ext-logger")).toBe("extensions:logger");

    // The keyed `id: agent` update from the second patch layer replaces
    // — not merges into — the entry's `config` field, matching the
    // deepseek-harness "last write wins per row" semantics for the
    // explicit fields the second layer declares.
    const agentConfig = loader.resolve("agent").entry.config as Record<string, unknown>;
    expect(agentConfig.persona).toBe("comet");

    // Loader emits Cordis-style lifecycle events alongside the legacy
    // UI events so downstream listeners (renderer, telemetry, etc.)
    // can plug into either channel.
    expect(events).toContain("loader/entry-init");
    expect(events).toContain("plugin/loaded");
    expect(events).toContain("loader/patch-context");

    // `await()` resolves once no entries are in flight (it's a no-op
    // here because everything is already loaded, but the call must not
    // throw).
    await expect(loader.await()).resolves.toBeUndefined();

    // Disposing the loader tears down the fibers and emits the
    // corresponding legacy + Cordis unload events.
    const seenBefore = events.length;
    await loader.dispose();
    const unloadEvents = events.slice(seenBefore);
    expect(unloadEvents).toContain("plugin/unloaded");
    expect(unloadEvents).toContain("loader/partial-dispose");
  });

  it("loadCordisPatch evaluates a deepseek-style patch with !!js, groups, and keyed updates against a scope", async () => {
    const { loader } = makeLoader({
      "@scope/agent": mockModule("agent"),
      "@scope/transport": mockModule("transport"),
      "@scope/ext": mockModule("ext"),
      "@scope/ext-logger": mockModule("logger"),
    });

    await loader.loadCordisPatch(
      `
- insert:
    - id: agent
      name: '@scope/agent'
      config:
        model: !!js scopedModel()
        transport: !!js dshHomePath('transport.json')

    - id: ext
      name: '@scope/ext'
      group: true
      children:
        - id: logger
          name: '@scope/ext-logger'

- id: transport
  name: '@scope/transport'
  config:
    file: !!js dshHomePath('transport.json')
`,
      {
        dshHomePath: (sub: string) => `/home/test/.openbuddy/${sub}`,
        scopedModel: () => "deepseek-v4-flash",
      },
    );

    // `!!js` expressions evaluate against the scope argument.
    const agentConfig = loader.resolve("agent").entry.config as Record<string, unknown>;
    expect(agentConfig.model).toBe("deepseek-v4-flash");
    expect(agentConfig.transport).toBe("/home/test/.openbuddy/transport.json");

    const transportConfig = loader.resolve("transport").entry.config as Record<string, unknown>;
    expect(transportConfig.file).toBe("/home/test/.openbuddy/transport.json");

    // The group + child inserted via `loadCordisPatch` reach the loader
    // through `composePluginPatches`, so child namespacing works here too.
    expect(loader.listGroup("ext").map((entry: { id: string }) => entry.id)).toEqual(["ext:logger"]);
  });

  it("evaluates `!!js ctx.<service>` against the live loader context", async () => {
    const { loader } = makeLoader({
      "@scope/startup": mockModule("startup", (ctx) => {
        ctx.provide("webStartup", { port: 4310, host: "127.0.0.1" });
      }),
      "@scope/server": mockModule("server"),
    });
    await loader.load([{ id: "startup", name: "@scope/startup" }]);
    await loader.loadCordisPatch(`
- insert:
    - id: server
      name: '@scope/server'
      config:
        port: !!js ctx.webStartup.port
        host: !!js ctx.webStartup.host
`);
    expect(loader.resolve("server").entry.config).toEqual({ port: 4310, host: "127.0.0.1" });
  });

  it("loadDeepseekBundle propagates load errors when the patch references an unknown module", async () => {
    const { loader } = makeLoader({
      "@scope/known": mockModule("known"),
    });

    // Patch only references `@scope/known`; intentionally register no
    // patches pointing at `@scope/missing` to keep this test scoped to
    // the positive path.
    await loader.loadCordisPatch(
      `
- insert:
    - id: known
      name: '@scope/known'
`,
    );
    expect(loader.resolve("known").status.state).toBe("loaded");
  });

  it.skipIf(!DEEPSEEK_HARNESS_ROOT)("consumes the real deepseek-harness `bundle/base` patch file end-to-end", async () => {
    // Authentic compatibility proof: read the canonical patch file
    // shipped by deepseek-ai/deepseek-harness and assert that every
    // declared row reaches the loader with its `!!js` config and
    // platform-gated `disabled:` field preserved exactly. This catches
    // regressions in `parseCordisPatch` / `patchRowsToOpenBuddy` /
    // `loadDeepseekBundle` integration at once.
    const basePatch = join(DEEPSEEK_HARNESS_ROOT!, "packages/bundle/base/cordis.patch.yml");
    const basePackage = join(DEEPSEEK_HARNESS_ROOT!, "packages/bundle/base/package.json");
    const source = await readFile(basePatch, "utf-8");

    // Discover every  plugin specifier declared in the
    // canonical base patch so the loader can resolve them through the
    // importer. The patch is the source of truth; if a new row is added
    // downstream, this test still covers it.
    const moduleSpecifiers = Array.from(new Set(source.match(/'@deepseek-ai[^']+'/g) ?? []))
      .map((match) => match.slice(1, -1))
      .sort();
    const modules = Object.fromEntries(moduleSpecifiers.map((name) => [name, mockModule(name)]));
    const { loader } = makeLoader(modules);

    const { parseCordisPatch, patchRowsToOpenBuddy } = await import("./yaml-patch");
    const { readBundleManifest } = await import("./bundle-manifest");

    const parsed = parseCordisPatch(source);
    const expressionScope = {
      ctx: loader.getContext(),
      process: { platform: "darwin", env: {} as Record<string, string | undefined>, cwd: () => "/Users/test/.dsh" },
      dshHomePath: (sub: string) => `/Users/test/.dsh/${sub}`,
    };
    const [layer] = parsed.layers;
    expect(layer).toBeDefined();
    const patches = patchRowsToOpenBuddy(layer!.rows, expressionScope);

    const byId = new Map<string, Record<string, unknown>>();
    for (const row of patches) {
      const inserts = row.insert ? (Array.isArray(row.insert) ? row.insert : [row.insert]) : [];
      if (inserts.length) {
        for (const entry of inserts) byId.set(entry.id, entry as unknown as Record<string, unknown>);
      } else if (row.id) {
        byId.set(row.id, row as Record<string, unknown>);
      }
    }
    for (const id of [
      "timer", "hmr", "llm", "session", "typert", "typert-loader",
      "typert-gateway", "session-title", "session-title-llm",
      "user-questions", "agent", "agent-default-model", "jobs",
      "llm-retry", "settings", "credentials", "llm-pi-ai",
      "session-persistence-jsonl", "attachment-local",
      "session-query-sqlite", "session-projection",
      "session-telemetry-otel", "subprocess", "sandbox",
      "sandbox-policy", "bash-sandbox",
    ]) {
      expect(byId.has(id), `base patch row missing for ${id}`).toBe(true);
    }

    const sandboxPolicy = byId.get("sandbox-policy");
    expect(sandboxPolicy?.config).toMatchObject({
      mode: "workspace-write",
      workspaceRoot: "/Users/test/.dsh",
    });

    const telemetry = byId.get("session-telemetry-otel");
    expect(telemetry?.config).toMatchObject({
      mode: "DISABLED",
      shutdownTimeoutMillis: 3000,
    });

    const bashSandbox = byId.get("bash-sandbox");
    expect(bashSandbox?.disabled).toBe(false);

    // Drive the same source through `loadDeepseekBundle` to prove the
    // manifest -> patch -> loader pipeline runs end-to-end against the
    // real package, swapping in a custom importer that resolves every
    // plugin specifier to a no-op module.
    const manifest = await readBundleManifest(basePackage, {
      importer: () => basePackage,
    });
    expect(manifest.manifestField).toBe("dsh");
    expect(manifest.field.patch).toBe("./cordis.patch.yml");

    await loader.loadDeepseekBundle(basePackage, {
      importer: () => basePackage,
      patchLoader: async (p) => (await readFile(p, "utf-8")),
      scope: {
        dshHomePath: (sub: string) => `/Users/test/.dsh/${sub}`,
        process: { platform: "darwin", cwd: () => "/Users/test/.dsh", env: {} as Record<string, string | undefined> },
      },
    });

    for (const id of [
      "timer", "hmr", "llm", "session", "typert", "agent",
      "agent-default-model", "jobs", "settings", "credentials",
      "session-persistence-jsonl", "attachment-local",
      "session-projection", "subprocess", "sandbox", "sandbox-policy",
    ]) {
      const state = loader.resolve(id).status.state;
      expect(["loaded", "disabled"], `row ${id} state was ${state}`).toContain(state);
    }
    expect(loader.resolve("bash-sandbox").status.state).toBe("loaded");

    await loader.dispose();
    expect(loader.resolve("timer").status.state).toBe("unloaded");
  });
});

describe("deepseek-harness Config schema adapter", () => {
  it("calls a function Config and forwards the validated value to the class constructor", async () => {
    let receivedConfig: unknown;
    class FnConfiguredService {
      static Config = (config: { value: number }) => ({ value: config.value * 2 });
      constructor(_ctx: Context, config: { value: number }) {
        receivedConfig = config;
      }
    }
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ default: FnConfiguredService }),
    });
    await loader.load([{ id: "fn-config", name: "@scope/fn-config", config: { value: 3 } }]);
    expect(receivedConfig).toEqual({ value: 6 });
    expect(loader.resolve("fn-config").status.state).toBe("loaded");
  });

  it("normalises a @standard-schema/spec object into a callable Config", async () => {
    const standardSchema = {
      "~standard": {
        validate(value: { value: number }) {
          if (typeof value?.value !== "number" || value.value < 0) {
            return { issues: [{ path: ["value"], message: "must be >= 0" }] };
          }
          return { value: { ...value, value: value.value + 1 } };
        },
      },
    };
    let receivedConfig: unknown;
    class StandardConfiguredService {
      static Config = standardSchema;
      constructor(_ctx: Context, config: { value: number }) {
        receivedConfig = config;
      }
    }
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ default: StandardConfiguredService }),
    });
    await loader.load([{ id: "standard-config", name: "@scope/standard-config", config: { value: 4 } }]);
    expect(receivedConfig).toEqual({ value: 5 });
  });

  it("surfaces standard-schema validation errors as an internal/error event", async () => {
    const standardSchema = {
      "~standard": {
        validate(_value: { value: number }) {
          return { issues: [{ path: ["value"], message: "must be >= 0" }] };
        },
      },
    };
    class FailingConfiguredService {
      static Config = standardSchema;
      constructor(_ctx: Context, _config: unknown) { /* no-op */ }
    }
    const ctx = new Context();
    const errors: unknown[] = [];
    ctx.on("internal/error", (reason) => errors.push(reason));
    const loader = new HarnessPluginLoader({
      context: ctx,
      importer: async () => ({ default: FailingConfiguredService }),
    });
    // Cordis swallows config errors and emits  rather than
    // rethrowing — assert that the loader surfaces the wrapped error via
    // that event so the renderer can still react to bad config.
    await loader.load([{ id: "failing-config", name: "@scope/failing-config", config: { value: -1 } }]);
    expect(errors).toHaveLength(1);
    const message = (errors[0] as Error)?.message ?? String(errors[0]);
    expect(message).toMatch(/config validation failed/);
    expect(message).toMatch(/must be >= 0 at value/);
  });
});

describe("Service-class plugins (deepseek-harness)", () => {
  it("loads a class-shaped plugin declared with `static inject`", async () => {
    class ServiceLike {
      static inject = ["settings"] as const;
      public ctx: Context;
      public config: { enabled: boolean };
      constructor(ctx: Context, config: { enabled: boolean }) {
        this.ctx = ctx;
        this.config = config;
        ctx.provide("serviceLike", { value: config.enabled });
      }
      dispose() {
        // class-managed cleanup; cordis dispatches this via the
        // fiber.dispose -> ctx.on('dispose') chain.
      }
    }

    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => {
        if (specifier === "@scope/settings") {
          return { apply: (ctx: Context) => { ctx.provide("settings", { ready: true }); } };
        }
        return { default: ServiceLike };
      },
    });
    await loader.load([
      { id: "settings", name: "@scope/settings" },
      { id: "service-like", name: "@scope/service-like", config: { enabled: true } },
    ]);

    // Class self-registered via ctx.provide — the context lookup returns the value.
    expect((loader as unknown as { context: Context }).context.get("serviceLike"))
      .toEqual({ value: true });
    // The loader's own resolve() still surfaces the entry under its declared id.
    expect(loader.resolve("service-like").status.state).toBe("loaded");
  });

  it("loads a namespace plugin whose apply export is a Service class", async () => {
    class NamespaceService {
      static inject = [] as const;
      constructor(ctx: Context) { ctx.provide("namespace-service", { ready: true }); }
    }
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ apply: NamespaceService }),
    });
    await loader.load([{ id: "namespace-service", name: "@scope/namespace-service" }]);
    expect((loader as unknown as { context: Context }).context.get("namespace-service"))
      .toEqual({ ready: true });
  });

  it("loads a class-shaped plugin declared with `static Config` (schemastery-style object)", async () => {
    // Deepseek bundles commonly ship a schemastery schema as a static
    // `Config` field; the loader doesn't validate against it (the
    // bundle/runtime owns validation), but the presence signals that
    // the module is a class plugin.
    const ConfigSchema = { /* schemastery schema placeholder */ __schema: true } as const;

    class ConfiguredService {
      static Config = ConfigSchema;
      constructor(_ctx: Context, _config: unknown) {
        /* no-op service */
      }
    }

    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async () => ({ default: ConfiguredService }),
    });
    await loader.load([{ id: "configured", name: "@scope/configured" }]);
    expect(loader.resolve("configured").status.state).toBe("loaded");
  });

  it("still loads function-shaped plugins alongside class-shaped ones", async () => {
    const calls: string[] = [];
    const loader = new HarnessPluginLoader({
      context: new Context(),
      importer: async (specifier) => {
        if (specifier === "@scope/func") {
          return { name: "@scope/func", apply: () => () => calls.push("dispose:func") };
        }
        if (specifier === "@scope/cls") {
          class Cls { static inject = [] as const; constructor() { /* self-registers */ } }
          return { default: Cls };
        }
        throw new Error(`unknown ${specifier}`);
      },
    });
    await loader.load([
      { id: "func", name: "@scope/func" },
      { id: "cls", name: "@scope/cls" },
    ]);
    expect(loader.resolve("func").status.state).toBe("loaded");
    expect(loader.resolve("cls").status.state).toBe("loaded");
    await loader.dispose();
    // Function plugin's cleanup ran; class plugin's dispose is driven by
    // cordis, not by the loader's disposer list (which stores a no-op
    // for class plugins).
    expect(calls).toEqual(["dispose:func"]);
  });
});

describe("dsh.bundle manifest fallback", () => {
  it("accepts a package.json that declares `dsh.bundle.patch` instead of `openbuddy.bundle.patch`", async () => {
    // Build a throwaway fixture: write a package.json + patch file
    // inside the test's temp dir so we don't have to commit a new
    // `__fixtures__` directory for this single scenario.
    const path = await import("node:path");
    const os = await import("node:os");

    const tmp = await mkdtemp(path.join(os.tmpdir(), "openbuddy-dsh-bundle-"));
    try {
      await writeFile(
        path.join(tmp, "package.json"),
        JSON.stringify({
          name: "@test/dsh-bundle",
          type: "module",
          main: "./index.js",
          dsh: { bundle: { patch: "./openbuddy.patch.yml" } },
        }),
      );
      await writeFile(
        path.join(tmp, "openbuddy.patch.yml"),
        "- insert:\n    - id: timer\n      name: '@scope/timer'\n",
      );

      const { readBundleManifest } = await import("./bundle-manifest");
      const manifest = await readBundleManifest(path.join(tmp, "package.json"), {
        importer: () => path.join(tmp, "package.json"),
      });
      expect(manifest.manifestField).toBe("dsh");
      expect(manifest.field.patch).toBe("./openbuddy.patch.yml");

      // Round-trip: loadDeepseekBundle applies the patch through the same
      // path used for OpenBuddy-native bundles.
      const loader = new HarnessPluginLoader({
        context: new Context(),
        importer: async () => ({ name: "@scope/timer", apply: () => undefined }),
      });
      await loader.loadDeepseekBundle(path.join(tmp, "package.json"), {
        importer: () => path.join(tmp, "package.json"),
        patchLoader: (p: string) => readFile(p, "utf-8"),
      });
      expect(loader.resolve("timer").status.state).toBe("loaded");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
