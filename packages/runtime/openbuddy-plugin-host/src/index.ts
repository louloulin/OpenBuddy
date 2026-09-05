import type { Context } from "@openbuddy/cordis";
import { parseCordisComposition, parseCordisPatch, patchRowsToOpenBuddy } from "./yaml-patch";
import { manifestToBundle, readBundleManifest } from "./bundle-manifest";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type PluginCleanup = void | (() => void | Promise<void>);

export {
  createPluginReadinessSnapshot,
  readinessCounts,
  type PluginReadinessCounts,
  type PluginReadinessEntry,
  type PluginReadinessPhase,
  type PluginReadinessSnapshot,
} from "./readiness";
export {
  createPluginSnapshot,
  pluginSurfaceKinds,
  type PluginSnapshot,
  type PluginSnapshotPackage,
  type PluginSnapshotPackageInput,
  type PluginSnapshotRecovery,
  type PluginSurfaceKind,
} from "./plugin-snapshot";
export {
  createUnifiedPluginManifest,
  updateUnifiedPluginManifest,
  unifiedPluginManifestSchema,
  unifiedPluginSurfaceKinds,
  type UnifiedPluginManifest,
  type UnifiedPluginManifestInput,
  type UnifiedPluginManifestNamespace,
  type UnifiedPluginManifestSurface,
  type UnifiedPluginSurfaceKind,
} from "./plugin-manifest";
export {
  DeepSeekCordisRuntime,
  type DeepSeekCordisInvocation,
  type DeepSeekCordisPluginEntry,
  type DeepSeekCordisPluginSnapshot,
  type DeepSeekCordisPluginState,
  type DeepSeekCordisRuntimeOptions,
  type DeepSeekCordisRuntimeSnapshot,
} from "./deepseek-cordis-runtime";

export interface HarnessPlugin {
  name?: string;
  inject?: readonly string[] | Record<string, unknown>;
  provide?: string | readonly string[];
  apply: (ctx: Context, config?: unknown) => PluginCleanup | Promise<PluginCleanup>;
  /**
   * Marker for class-style plugins (deepseek-harness `Service` subclass
   * convention). When set, the loader skips the redundant
   * `ctx.plugin(harness, ...)` registration because the class
   * constructor self-registers against the context. Internal — callers
   * should not set this directly.
   * @internal
   */
  _kind?: "class" | "function";
  /** Original class constructor for Cordis registration. @internal */
  _constructor?: new (ctx: Context, config?: unknown) => unknown;
}

export interface PluginEntryOptions {
  id: string;
  name: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  disabled?: boolean;
  /** deepseek-harness parity: nested group marker. When `true`, the
   *  entry's `children` are loaded under the group's `id` namespace and
   *  visible via `loader.listGroup(groupId)`. */
  group?: boolean | null;
  /** Children of a `group: true` entry; mirror `EntryGroup.data` in
   *  deepseek-harness's `@cordisjs/plugin-loader`. Each child entry is
   *  loaded after the group itself and resolves under `${groupId}:${childId}`. */
  children?: readonly PluginEntryOptions[];
  /** DeepSeek Harness entry-local or named service realms. */
  isolate?: Readonly<Record<string, true | string>>;
}

export interface PluginPatch {
  id?: string;
  insert?: PluginEntryOptions | PluginEntryOptions[];
  disabled?: boolean;
  name?: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  /** deepseek-harness parity: target the group flag of an entry. */
  group?: PluginEntryOptions["group"];
  /** Replace a group's child entry list when patching a group row. */
  children?: readonly PluginEntryOptions[];
  isolate?: PluginEntryOptions["isolate"];
}

export type PluginFiberState =
  | "pending"   // queued, not yet started
  | "loading"   // module import in flight
  | "active"    // apply() returned, cleanup function live
  | "loaded"    // legacy alias of "active" — kept for back-compat
  | "disabled"  // entry disabled at config or compose time
  | "failed"    // apply() threw and was not recovered
  | "unloading" // stop() in progress
  | "disposed"  // stop() completed, fiber released
  | "unloaded"; // legacy alias of "disposed"

export interface PluginStatus {
  id: string;
  name: string;
  state: PluginFiberState;
  error?: string;
}

export interface PluginEntryInfo {
  id: string;
  options: PluginEntryOptions;
  status: PluginStatus;
  disabled: boolean;
  fiber?: PluginFiberInfo;
}

export interface PluginFiberInfo {
  state: PluginFiberState;
  ctx: Context;
  inject: Record<string, unknown>;
  await(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ResolvedPluginEntry extends PluginEntryInfo {
  entry: PluginEntryOptions;
  status: PluginStatus;
}

export interface PluginLoaderOptions {
  context: Context;
  importer?: (specifier: string, baseUrl?: string) => Promise<unknown>;
  baseUrl?: string;
  logger?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
  onEvent?: (type: string, payload: unknown) => void;
}

export interface PluginProfile {
  entries: PluginEntryOptions[];
  patches?: readonly PluginPatch[][];
}

export interface PluginProfileManifest {
  name?: string;
  bundles?: readonly string[];
  patches?: readonly string[];
}

export interface PluginBundle {
  entries: readonly PluginEntryOptions[];
  patches?: readonly PluginPatch[][];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Detect deepseek-harness / cordis `Service`-class plugins without
 * importing the cordis fork the bundles target. The shape contract:
 *   - the module exports a class (a function with a real prototype)
 *   - the class declares a static `inject` array, OR
 *   - the class declares a static `Config` (function validator or
 *     schemastery schema object).
 * Either signal is enough — the deepseek convention is to ship both,
 * but bundles in the wild sometimes omit one.
 */
function isClassPlugin(candidate: unknown): boolean {
  if (typeof candidate !== "function") return false;
  if (/^class\s/.test(Function.prototype.toString.call(candidate))) return true;
  const ctor = candidate as { inject?: unknown; Config?: unknown };
  if (Array.isArray(ctor.inject)) return true;
  if (ctor.Config !== undefined && ctor.Config !== null) return true;
  return false;
}

function normalizePlugin(module: unknown, name: string): HarnessPlugin {
  const namespace = module && typeof module === "object" ? module as Record<string, unknown> : undefined;
  const defaultExport = namespace && "default" in namespace ? namespace.default : undefined;
  const namedApply = namespace?.apply;
  const candidate = defaultExport !== undefined
    ? defaultExport
    : typeof namedApply === "function"
    ? namespace
    : module;
  if (isClassPlugin(candidate)) {
    const constructor = candidate as {
      new (ctx: Context, config?: unknown): unknown;
      name?: string;
      inject?: readonly string[] | Record<string, unknown>;
      provide?: string | readonly string[];
    };
    return {
      name: constructor.name ?? name,
      inject: constructor.inject,
      provide: constructor.provide,
      apply: constructor as unknown as HarnessPlugin["apply"],
      _kind: "class",
      _constructor: constructor,
    };
  }
  if (candidate && typeof candidate === "object" && typeof (candidate as { apply?: unknown }).apply === "function"
      && isClassPlugin((candidate as { apply: unknown }).apply)) {
    const object = candidate as { name?: string; inject?: HarnessPlugin["inject"]; provide?: HarnessPlugin["provide"]; apply: unknown };
    const constructor = object.apply as {
      new (ctx: Context, config?: unknown): unknown;
      name?: string;
      inject?: HarnessPlugin["inject"];
      provide?: HarnessPlugin["provide"];
    };
    return {
      name: object.name ?? constructor.name ?? name,
      inject: object.inject ?? constructor.inject,
      provide: object.provide ?? constructor.provide,
      apply: constructor as unknown as HarnessPlugin["apply"],
      _kind: "class",
      _constructor: constructor,
    };
  }
  if (typeof candidate === "function") return { name, apply: candidate as HarnessPlugin["apply"] };
  if (!candidate || typeof candidate !== "object" || typeof (candidate as HarnessPlugin).apply !== "function") {
    throw new Error(`plugin-loader: ${name} does not export apply(ctx, config)`);
  }
  return candidate as HarnessPlugin;
}

async function ensureContextStarted(context: Context): Promise<void> {
  const lifecycle = (context as unknown as { lifecycle?: { isActive?: boolean } }).lifecycle;
  if (!lifecycle?.isActive) await context.start();
}

async function flushCordisDisposal(context: Context): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await context.events.flush();
}

function classPluginAdapter(
  plugin: HarnessPlugin,
  entryName: string,
): Parameters<Context["plugin"]>[0] {
  const Constructor = plugin._constructor;
  if (!Constructor) throw new Error(`plugin-loader: missing class constructor for ${entryName}`);
  const adapter = function (ctx: Context, config?: unknown): unknown {
    return new Constructor(ctx, config);
  } as unknown as Record<PropertyKey, unknown>;
  const descriptorNames = ["inject", "provide", "immediate", "reusable", "reactive", "fork"];
  for (const name of descriptorNames) {
    const descriptor = Object.getOwnPropertyDescriptor(Constructor, name);
    if (descriptor) Object.defineProperty(adapter, name, descriptor);
  }
  // Cordis's `Config` adapter expects a callable `(config) => normalized`,
  // while DeepSeek bundles commonly ship a `@standard-schema/spec` (or
  // schemastery-shaped) validator object. Lift the validator into a
  // callable by routing through Cordis's own resolver, which understands
  // both callable validators and standard-schema objects. Suppress only
  // the incompatible plain-object Config metadata that lacks a callable
  // surface AND a `~standard` interface.
  const configDescriptor = Object.getOwnPropertyDescriptor(Constructor, "Config");
  if (configDescriptor && isUsableConfig(configDescriptor.value)) {
    const adapter_ = buildConfigAdapter(configDescriptor.value);
    Object.defineProperty(adapter, "Config", { value: adapter_, configurable: true });
  } else {
    Object.defineProperty(adapter, "schema", { value: false, configurable: true });
  }
  Object.defineProperty(adapter, "name", { value: plugin.name ?? entryName, configurable: true });
  return adapter as unknown as Parameters<Context["plugin"]>[0];
}

function isUsableConfig(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  const standard = (value as { "~standard"?: unknown })["~standard"];
  if (standard && typeof (standard as { validate?: unknown }).validate === "function") return true;
  return typeof (value as { validate?: unknown }).validate === "function";
}

function buildConfigAdapter(value: unknown): (config: unknown) => unknown {
  if (typeof value === "function") {
    // Some DeepSeek-style bundles already ship a callable Config; honour
    // it as-is, but also guard against validation failures so Cordis's
    // resolution path can surface a real `ValidationError` rather than
    // throw the raw error.
    const fn = value as (config: unknown) => unknown;
    return (config: unknown) => {
      try {
        return fn(config);
      } catch (error) {
        throw wrapConfigError(error, "config validation failed");
      }
    };
  }
  const standard = (value as { "~standard"?: { validate: (config: unknown) => unknown } })["~standard"];
  const validate = standard?.validate ?? (value as { validate: (config: unknown) => unknown }).validate;
  return (config: unknown) => {
    const result = validate.call(value, config);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      throw wrapConfigError(new TypeError("Async config validation is not supported"), "config validation failed");
    }
    const issue = result as { issues?: ReadonlyArray<{ path?: ReadonlyArray<string | number>; message?: string }>; value?: unknown };
    if (issue && Array.isArray(issue.issues) && issue.issues.length) {
      throw wrapConfigError(issue.issues, "config validation failed");
    }
    return issue && "value" in issue ? issue.value : config;
  };
}

function wrapConfigError(cause: unknown, prefix: string): Error {
  const detail = cause instanceof Error ? cause.message : formatIssues(cause);
  const error = new Error(`${prefix}: ${detail}`);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function formatIssues(issues: unknown): string {
  if (!Array.isArray(issues)) return String(issues);
  return issues
    .map((issue) => {
      const path = Array.isArray((issue as { path?: unknown }).path)
        ? ` at ${((issue as { path?: unknown }).path as unknown[]).join(".")}`
        : "";
      const message = (issue as { message?: unknown }).message ?? String(issue);
      return ` - ${message}${path}`;
    })
    .join("\n");
}
function dependenciesOf(inject: HarnessPlugin["inject"]): string[] {
  return Array.isArray(inject) ? [...inject] : Object.keys(inject ?? {});
}

function providesOf(plugin: HarnessPlugin, entry: PluginEntryOptions): string[] {
  const provided = plugin.provide;
  return [entry.id, plugin.name ?? entry.name, ...(Array.isArray(provided) ? provided : provided ? [provided] : [])];
}

export function composePluginPatches(base: readonly PluginEntryOptions[], layers: readonly PluginPatch[][]): PluginEntryOptions[] {
  const entries: PluginEntryOptions[] = base.map((entry) => ({ ...entry }));
  for (const patch of layers.flat()) {
    if (patch.insert) {
      const inserts = Array.isArray(patch.insert) ? patch.insert : [patch.insert];
      entries.push(...inserts.map((entry) => ({ ...entry })));
      continue;
    }
    if (!patch.id) throw new Error("plugin-loader: patch requires id or insert");
    const index = entries.findIndex((entry) => entry.id === patch.id);
    // deepseek-harness parity: a patch row keyed by `id` is also the
    // entry's source of truth, so when no row with that id exists yet
    // we insert it. The fields below fall back to a sensible default
    // (`name === id`) so callers that only declare an id + config still
    // get a loadable entry.
    if (index < 0) {
      entries.push({
        id: patch.id,
        name: patch.name ?? patch.id,
        ...(patch.config === undefined ? {} : { config: patch.config }),
        ...(patch.inject === undefined ? {} : { inject: patch.inject }),
        ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
        ...(patch.group === undefined ? {} : { group: patch.group }),
        ...(patch.children === undefined ? {} : { children: patch.children }),
        ...(patch.isolate === undefined ? {} : { isolate: patch.isolate }),
      });
      continue;
    }
    entries[index] = {
      ...entries[index],
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.inject === undefined ? {} : { inject: patch.inject }),
      ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
      ...(patch.group === undefined ? {} : { group: patch.group }),
      ...(patch.children === undefined ? {} : { children: patch.children }),
      ...(patch.isolate === undefined ? {} : { isolate: patch.isolate }),
    };
  }
  return entries;
}

export function composePluginBundles(bundles: readonly PluginBundle[], overlay: PluginProfile = { entries: [] }): PluginProfile {
  const entries = bundles.flatMap((bundle) => bundle.entries.map((entry) => ({ ...entry })));
  for (const entry of overlay.entries) {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index < 0) entries.push({ ...entry });
    else entries[index] = { ...entries[index], ...entry };
  }
  const patches = bundles.flatMap((bundle) => bundle.patches ?? []);
  return {
    entries,
    patches: [...patches, ...(overlay.patches ?? [])],
  };
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* use the scalar text */ }
  }
  return trimmed;
}

/**
 * Parse the intentionally small, data-only subset used by OpenBuddy cordis.yml.
 * JSON is accepted as well, which makes generated profiles deterministic and safe.
 */
export function parseCordisProfile(source: string): PluginProfile {
  try {
    const parsed = JSON.parse(source) as PluginProfile;
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch { /* fall through to the YAML subset */ }

  const entries: PluginEntryOptions[] = [];
  const patches: PluginPatch[] = [];
  let section: "entries" | "patches" | undefined;
  let current: Record<string, unknown> | undefined;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const header = /^(entries|patches):\s*$/.exec(line.trim());
    if (header) { section = header[1] as "entries" | "patches"; current = undefined; continue; }
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item) {
      current = {};
      (section === "entries" ? entries : patches).push(current as unknown as PluginEntryOptions & PluginPatch);
      if (item[1].trim()) {
        const [key, ...rest] = item[1].split(":");
        if (key && rest.length) current[key.trim()] = parseScalar(rest.join(":"));
      }
      continue;
    }
    const property = /^\s{2,}([\w-]+):\s*(.*)$/.exec(line);
    if (property && current) current[property[1]] = parseScalar(property[2]);
  }
  if (!entries.length && !patches.length) throw new Error("plugin-loader: cordis profile must define entries or patches");
  return { entries, patches: patches.length ? [patches] : [] };
}

export class HarnessPluginLoader {
  private readonly context: Context;
  private readonly importer: NonNullable<PluginLoaderOptions["importer"]>;
  private readonly baseUrl?: string;
  private readonly logger: NonNullable<PluginLoaderOptions["logger"]>;
  private readonly onEvent: NonNullable<PluginLoaderOptions["onEvent"]>;
  private readonly entryStore = new Map<string, PluginEntryOptions>();
  private readonly fibers = new Map<string, {
    dispose: () => void | Promise<void>;
    inject: string[];
  }>();
  private readonly statuses = new Map<string, PluginStatus>();
  private readonly resolvedInject = new Map<string, string[]>();
  private readonly providedNames = new Map<string, string[]>();
  /** nested-group child entries keyed by `${groupId}:${childId}`. */
  private readonly groups = new Map<string, PluginEntryOptions>();
  /** parent group ids, so `listGroups()` surfaces empty groups too. */
  private readonly groupParents = new Set<string>();
  private readonly isolateLabels = new Map<string, symbol>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: PluginLoaderOptions) {
    this.context = options.context;
    this.baseUrl = options.baseUrl;
    this.importer = options.importer ?? (async (specifier, base) => {
      if (specifier.startsWith(".")) return import(/* @vite-ignore */ new URL(specifier, base ?? import.meta.url).href);
      return import(/* @vite-ignore */ specifier);
    });
    this.logger = options.logger ?? ((level, message) => console[level]("[plugin-loader]", message));
    this.onEvent = options.onEvent ?? (() => undefined);
    this.context.provide("pluginLoader", this);
    // deepseek-harness parity: also expose the loader as `ctx.loader`.
    // Deepseek's Cordis module augmentation declares `interface Context
    // { loader: Loader }`; OpenBuddy's Cordis surface (which re-exports
    // `@cordisjs/core`) honours `provide("loader", ...)` so we register
    // both names without conflicting with the existing `pluginLoader`.
    this.context.provide("loader", this);
    this.context.set("loader", this);
    this.context.set("pluginLoader", this);
    // Listener registry so plugins can subscribe to loader/* lifecycle
    // events from the Cordis context (mirrors deepseek's
    // `ctx.on('loader/entry-init', ...)`).
    this.context.provide("loaderEvents", this.loaderEvents);
  }

  /** Event-bus for plugins that subscribe via `ctx.on('loader/...')` or
   *  `ctx.get('loaderEvents').on(...)`. Mirrors deepseek-harness's
   *  `ctx.on(...)` Cordis pattern: plugins can observe entry-init /
   *  patch-context / config-update / partial-dispose without owning
   *  the loader. Stored as a plain object so Cordis's Proxy wrapper
   *  doesn't trip over Map method calls. */
  readonly loaderEvents: { [type: string]: Set<(payload: unknown) => void> } = Object.create(null);

  /** Subscribe to a loader/* lifecycle event. Returns an unsubscribe
   *  function. Mirrors the deepseek-harness `ctx.on()` ergonomics. */
  on(type: string, listener: (payload: unknown) => void): () => void {
    const set = this.loaderEvents[type] ?? new Set<(payload: unknown) => void>();
    set.add(listener);
    this.loaderEvents[type] = set;
    return () => {
      set.delete(listener);
      if (!set.size) delete this.loaderEvents[type];
    };
  }

  /**
   * Hook for hosts that can restart the process on a full-reload
   * request. Deepseek-harness's `Loader.exit()` is the same shape —
   * subclasses (or wrappers in `electron/main`) override this to call
   * `app.relaunch()` / `app.exit()` / `process.exit()` as appropriate.
   */
  exit(): void {
    // No-op by default. Hosts wire their own full-reload behaviour.
  }

  private emit(type: string, payload: unknown): void {
    try { this.onEvent(type, payload); } catch (error) { this.logger("warn", `event listener failed for ${type}: ${errorMessage(error)}`); }
    // DeepSeek plugins normally subscribe through Cordis itself (`ctx.on`),
    // not through the OpenBuddy-specific loader event registry. Mirror the
    // lifecycle event onto the host context while keeping listener failures
    // isolated from the loader transition.
    try { this.context.events.emit(type, payload); }
    catch (error) { this.logger("warn", `context event listener failed for ${type}: ${errorMessage(error)}`); }
    // Mirror to the plugin-side `loaderEvents` bus so plugins that
    // subscribed via `ctx.on('loader/...')` see the event too.
    const listeners = this.loaderEvents[type];
    if (listeners) {
      for (const listener of [...listeners]) {
        try { listener(payload); }
        catch (error) { this.logger("warn", `plugin-side event listener failed for ${type}: ${errorMessage(error)}`); }
      }
    }
  }

  async load(entries: readonly PluginEntryOptions[]): Promise<void> {
    return this.mutate(() => this.loadInternal(entries));
  }

  async loadScoped(entries: readonly PluginEntryOptions[], parentContext: Context, baseUrl?: string): Promise<void> {
    return this.mutate(() => this.loadInternal(entries, parentContext, baseUrl ?? this.baseUrl));
  }

  async loadCordisComposition(source: string, options: { parentContext?: Context; baseUrl?: string; scope?: Record<string, unknown> } = {}): Promise<void> {
    const entries = parseCordisComposition(source, options.scope);
    return this.loadScoped(entries, options.parentContext ?? this.context, options.baseUrl);
  }

  /** @internal */
  async loadImmediate(entries: readonly PluginEntryOptions[]): Promise<void> {
    return this.loadInternal(entries);
  }

  private async loadInternal(entries: readonly PluginEntryOptions[], parentContext: Context = this.context, baseUrl = this.baseUrl): Promise<void> {
    const pending = entries.map((entry) => ({ ...entry }));
    const initialIds = new Set(this.entryStore.keys());
    try {
      const modules = new Map<string, HarnessPlugin>();
      // Loop 1: pre-register entries so dependency checks can see the batch.
      for (const entry of entries) {
        if (!entry.id || !entry.name) throw new Error("plugin-loader: entry requires id and name");
        if (this.entryStore.has(entry.id)) throw new Error(`plugin-loader: duplicate entry id ${entry.id}`);
        this.entryStore.set(entry.id, { ...entry });
        if (entry.disabled) this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "disabled" });
      }
      // Loop 2: import each non-disabled module exactly once.
      for (const entry of pending) {
        if (!entry.id || !entry.name) throw new Error("plugin-loader: entry requires id and name");
        if (pending.filter((candidate) => candidate.id === entry.id).length > 1) {
          throw new Error(`plugin-loader: duplicate entry id ${entry.id}`);
        }
        if (entry.disabled) continue;
        modules.set(entry.id, normalizePlugin(await this.importer(entry.name, baseUrl), entry.name));
      }
      const available = new Set<string>();
      // Incremental loads are part of the loader contract: a profile reload
      // may add a plugin that injects a service owned by an unchanged entry.
      // Treat the already-active entry identities as satisfied dependencies;
      // otherwise only full boot works and live bundle composition fails.
      for (const existing of this.entryStore.values()) {
        if (!initialIds.has(existing.id) || this.statuses.get(existing.id)?.state === "disabled") continue;
        available.add(existing.id);
        available.add(existing.name);
        for (const provided of this.providedNames.get(existing.id) ?? []) available.add(provided);
      }
      const ready: PluginEntryOptions[] = [];
      while (true) {
        const next = pending.filter((entry) => {
          if (entry.disabled) return false;
          if (ready.includes(entry)) return false;
          const plugin = modules.get(entry.id);
          const inject = entry.inject ?? plugin?.inject;
          return dependenciesOf(inject).every((dependency) => available.has(dependency) || parentContext.get(dependency) !== undefined);
        });
        if (!next.length) break;
        for (const entry of next) {
          ready.push(entry);
          const plugin = modules.get(entry.id);
          for (const provided of providesOf(plugin!, entry)) available.add(provided);
        }
      }
      const unresolved = pending.filter((entry) => !entry.disabled && !ready.includes(entry));
      if (unresolved.length) {
        const detail = unresolved.map((entry) => {
          const plugin = modules.get(entry.id);
          return `${entry.id} <- ${dependenciesOf(entry.inject ?? plugin?.inject).join(", ") || "<none>"}`;
        }).join("; ");
        throw new Error(`plugin-loader: unresolved inject dependencies for ${detail}`);
      }
      for (const entry of ready) {
        const plugin = modules.get(entry.id);
        await this.start(entry, plugin, parentContext, baseUrl);
      }
    } catch (error) {
      const addedIds = [...this.entryStore.keys()].filter((id) => !initialIds.has(id)).reverse();
      const cleanupErrors: unknown[] = [];
      for (const id of addedIds) {
        try { await this.removeInternal(id); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], "plugin-loader: load rollback failed");
      }
      throw error;
    }
  }

  /** DeepSeek Loader parity: create one entry and return its stable id. */
  async create(options: Omit<PluginEntryOptions, "id"> & { id?: string }): Promise<string> {
    const id = options.id ?? options.name;
    if (!id) throw new Error("plugin-loader: entry name is required");
    await this.load([{ ...options, id }]);
    return id;
  }

  async loadProfile(profile: PluginProfile): Promise<void> {
    await this.mutate(async () => {
      const entries = composePluginPatches(profile.entries, profile.patches ?? []);
      if (this.entryStore.size) await this.reconcile(entries);
      else await this.loadInternal(entries);
    });
  }

  /** Replace the composed profile from its canonical base entries. Unlike
   * `loadProfile`, this never treats the current patched tree as the source,
   * so removed patch rows really disappear on a live profile reload. */
  async replaceProfile(profile: PluginProfile): Promise<void> {
    await this.mutate(() => this.reconcile(composePluginPatches(profile.entries, profile.patches ?? [])));
  }

  async loadCordisProfile(source: string): Promise<void> {
    await this.loadProfile(parseCordisProfile(source));
  }

  /**
   * Load a deepseek-harness `cordis.patch.yml` (or any fragment with the
   * same shape) into this loader. `!!js` expressions inside `config:` are
   * evaluated against `scope` — pass `{ dshHomePath, ...helpers }` to
   * reproduce the deepseek-harness runtime helpers.
   */
  async loadCordisPatch(
    source: string,
    scope: Record<string, unknown> = {},
  ): Promise<void> {
    const parsed = parseCordisPatch(source);
    await this.loadCordisPatchLayers(parsed.layers.map((layer) => layer.rows), scope);
  }

  /** Apply already-parsed DeepSeek patch layers from a compatibility facade. */
  async loadCordisPatchLayers(
    layers: readonly (readonly Parameters<typeof patchRowsToOpenBuddy>[0][number][])[],
    scope: Record<string, unknown> = {},
  ): Promise<void> {
    // Deepseek expressions are evaluated against the live loader context,
    // not only a detached helper object. This enables real bundle rows such
    // as `!!js ctx.webStartup.port` while keeping explicit caller helpers
    // (`dshHomePath`, `process`, etc.) available in the same scope.
    const expressionScope = { ...scope, ctx: this.context };
    const converted = layers.map((layer) => patchRowsToOpenBuddy(layer, expressionScope)) as PluginPatch[][];
    const current = [...this.entryStore.values()].filter((entry) => !entry.id.includes(":"));
    await this.mutate(() => this.reconcile(composePluginPatches(current, converted)));
  }

  /** Reconcile a composed profile without restarting entries whose options
   * did not change. This is the operation used by live DeepSeek patch reloads. */
  private async reconcile(desired: readonly PluginEntryOptions[]): Promise<void> {
    const current = [...this.entryStore.values()].filter((entry) => !entry.id.includes(":"));
    const currentById = new Map(current.map((entry) => [entry.id, entry]));
    const desiredById = new Map(desired.map((entry) => [entry.id, entry]));
    const changed = desired.filter((entry) => {
      const previous = currentById.get(entry.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(entry);
    }).map((entry) => entry.id);
    const removed = current.filter((entry) => !desiredById.has(entry.id)).map((entry) => entry.id);
    const restartSet = new Set([...changed, ...removed]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const entry of desired) {
        if (restartSet.has(entry.id)) continue;
        const dependencies = entry.inject
          ? dependenciesOf(entry.inject)
          : this.resolvedInject.get(entry.id) ?? [];
        if (dependencies.some((dependency) => restartSet.has(dependency))) {
          restartSet.add(entry.id);
          expanded = true;
        }
      }
    }
    const restart = [...restartSet];
    if (!restart.length) return;

      const restartCurrent = current.map((entry) => entry.id).filter((id) => restartSet.has(id)).reverse();
      for (const id of restartCurrent) if (this.entryStore.has(id)) await this.removeInternal(id);
      try {
        await this.loadInternal(desired.filter((entry) => restart.includes(entry.id)));
      } catch (error) {
        for (const id of [...restart].reverse()) if (this.entryStore.has(id)) await this.removeInternal(id);
        const rollback = current.filter((entry) => restart.includes(entry.id));
      if (rollback.length) await this.loadInternal(rollback);
      throw error;
    }
  }

  /**
   * Load a deepseek-harness-style bundle end-to-end: read its
   * `package.json#openbuddy.bundle` field, resolve the declared patch
   * file relative to the bundle directory, parse + apply it through
   * `loadCordisPatch`. Returns the resolved manifest so callers can
   * introspect what was loaded.
   *
   * The `importer` and `patchLoader` hooks are forwarded so callers can
   * swap in test doubles or alternative storage (e.g. a virtual FS).
   */
  async loadDeepseekBundle(
    specifier: string,
    options: Parameters<typeof manifestToBundle>[1] & { scope?: Record<string, unknown> } = {},
  ): Promise<Awaited<ReturnType<typeof readBundleManifest>>> {
    const manifest = await readBundleManifest(specifier, options);
    const bundle = await manifestToBundle(manifest, {
      ...options,
      scope: { ...(options.scope ?? {}), ctx: this.context },
    });
    await this.loadProfile({ entries: [...bundle.entries], patches: bundle.patches });
    return manifest;
  }

  /** Load an ordered DeepSeek-style profile of bundle package specifiers. */
  async loadDeepseekProfile(
    bundles: readonly string[],
    options: Parameters<typeof manifestToBundle>[1] & { scope?: Record<string, unknown> } = {},
  ): Promise<void> {
    const materialized: PluginBundle[] = [];
    for (const specifier of bundles) {
      const manifest = await readBundleManifest(specifier, options);
      materialized.push(await manifestToBundle(manifest, {
        ...options,
        scope: { ...(options.scope ?? {}), ctx: this.context },
      }));
    }
    await this.loadProfile(composePluginBundles(materialized));
  }

  async update(id: string, patch: Omit<PluginPatch, "id" | "insert">): Promise<void> {
    await this.mutate(() => this.updateInternal(id, patch));
  }

  private async updateInternal(id: string, patch: Omit<PluginPatch, "id" | "insert">): Promise<void> {
    const previous = this.entryStore.get(id);
    if (!previous) throw new Error(`plugin-loader: cannot update unknown entry ${id}`);
    const next: PluginEntryOptions = {
      ...previous,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      ...(patch.inject === undefined ? {} : { inject: patch.inject }),
      ...(patch.disabled === undefined ? {} : { disabled: patch.disabled }),
      ...(patch.group === undefined ? {} : { group: patch.group }),
      ...(patch.children === undefined ? {} : { children: patch.children }),
    };
    this.emit("loader/config-update", { id, previous: { ...previous }, next: { ...next } });
    await this.stop(id);
    this.entryStore.set(id, next);
    try {
      await this.start(next);
    } catch (error) {
      this.entryStore.set(id, previous);
      try { await this.start(previous); } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `plugin-loader: rollback failed for ${id}`);
      }
      throw error;
    }
  }

  async reload(id: string): Promise<void> {
    const entry = this.entryStore.get(id);
    if (!entry) throw new Error(`plugin-loader: cannot reload unknown entry ${id}`);
    await this.update(id, {});
  }

  async remove(id: string): Promise<void> {
    await this.mutate(() => this.removeInternal(id));
  }

  /** @internal */
  async removeImmediate(id: string): Promise<void> {
    await this.removeInternal(id);
  }

  private async removeInternal(id: string): Promise<void> {
    // EntryGroup.remove() disposes descendants before unlinking the parent.
    // Mirror that invariant for namespaced OpenBuddy group entries.
    const childIds = [...this.entryStore.keys()].filter((entryId) => entryId.startsWith(`${id}:`));
    for (const childId of childIds.reverse()) await this.removeInternal(childId);
    await this.stop(id);
    this.entryStore.delete(id);
    this.resolvedInject.delete(id);
    this.providedNames.delete(id);
    this.statuses.delete(id);
    this.groups.delete(id);
    this.groupParents.delete(id);
  }

  async dispose(): Promise<void> {
    await this.mutate(async () => {
      for (const id of [...this.fibers.keys()].reverse()) await this.stop(id);
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  list(): PluginStatus[] {
    return [...this.statuses.values()].map((status) => ({ ...status }));
  }

  /** Iterate the current entry tree with immutable option/status snapshots.
   * This is the loader-facing equivalent of deepseek-harness's
   * `ctx.loader.entries()`; namespaced group children are included. */
  *entries(): Generator<PluginEntryInfo, void, void> {
    for (const id of this.entryStore.keys()) {
      const info = this.entryInfo(id);
      if (info) yield info;
    }
  }

  private entryInfo(id: string): PluginEntryInfo | undefined {
    const options = this.entryStore.get(id);
    const status = this.statuses.get(id);
    if (!options || !status) return undefined;
    const fiberRecord = this.fibers.get(id);
    const fiber = fiberRecord
      ? {
          state: status.state,
          ctx: this.context,
          inject: Object.fromEntries(fiberRecord.inject.map((name) => [name, this.context.get(name)])),
          await: async () => { await this.await(); },
          dispose: async () => { await this.remove(id); },
        } satisfies PluginFiberInfo
      : undefined;
    return {
      id,
      options: { ...options },
      status: { ...status },
      disabled: options.disabled === true,
      fiber,
    };
  }

  getContext(): Context {
    return this.context;
  }

  /**
   * Wait until no entries are mid-flight (loading or unloading). Returns
   * immediately when the loader is idle. Mirrors `Loader.await()` from
   * `@cordisjs/plugin-loader` so deepseek-style consumers can await
   * composition before triggering side-effects.
   */
  async await(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const status of this.statuses.values()) {
      if (status.state === "loading" || status.state === "unloading") {
        tasks.push(new Promise<void>((resolveTask) => {
          const handler = (event: { type: string; payload: unknown }) => {
            if (event.type === "plugin/loaded" || event.type === "plugin/failed"
                || event.type === "plugin/unloaded"
                || event.type === "loader/partial-dispose") {
              const payload = event.payload as { id?: string } | undefined;
              if (payload?.id === status.id) {
                this.detachLifecycleHandler(handler);
                resolveTask();
              }
            }
          };
          this.attachLifecycleHandler(handler);
        }));
      }
    }
    if (tasks.length) await Promise.allSettled(tasks);
  }

  /**
   * Lifecycle handler registry — used by `await()` to wait for in-flight
   * entries. Public consumers can ignore this; it's an implementation
   * detail of the deepseek-harness `loader/await()` parity.
   */
  private lifecycleHandlers = new Set<(event: { type: string; payload: unknown }) => void>();
  private attachLifecycleHandler(handler: (event: { type: string; payload: unknown }) => void) {
    this.lifecycleHandlers.add(handler);
  }
  private detachLifecycleHandler(handler: (event: { type: string; payload: unknown }) => void) {
    this.lifecycleHandlers.delete(handler);
  }

  /** Resolve an entry by id; throws if the id is unknown. */
  resolve(id: string): ResolvedPluginEntry {
    const entry = this.entryStore.get(id);
    const status = this.statuses.get(id);
    if (!entry || !status) throw new Error(`plugin-loader: cannot resolve entry ${id}`);
    return {
      entry: { ...entry },
      status: { ...status },
      ...this.entryInfo(id),
    } as ResolvedPluginEntry;
  }

  /** Return the entry id that owns a given plugin name (first match), or null. */
  locate(name: string): string | null {
    for (const entry of this.entryStore.values()) {
      if (entry.name === name) return entry.id;
    }
    return null;
  }

  /** Return all entries belonging to the named group (deepseek-harness
   *  `EntryGroup.entries()` parity). Returns an empty array when the
   *  group is unknown. */
  listGroup(groupId: string): PluginStatus[] {
    const prefix = `${groupId}:`;
    const out: PluginStatus[] = [];
    for (const status of this.statuses.values()) {
      if (status.id.startsWith(prefix)) out.push({ ...status });
    }
    return out;
  }

  /** Return every group id known to the loader. A group is either a
   *  parent entry with `group: true`, or a namespace under which at
   *  least one child has been loaded. */
  listGroups(): string[] {
    const groups = new Set<string>(this.groupParents);
    for (const id of this.statuses.keys()) {
      const colon = id.indexOf(":");
      if (colon > 0) groups.add(id.slice(0, colon));
    }
    return [...groups];
  }

  /** Load each child of a group entry under its namespaced id. Children
   *  share the loader's importer + context; their ids become
   *  `${parent.id}:${child.id}` and `loader.listGroup(groupId)` returns
   *  their statuses. Array-form `inject` dependencies are also prefixed
   *  so a child's `inject: ["a"]` resolves against its namespaced
   *  sibling `${parent.id}:a`. Object-form `inject` (Cordis service
   *  intercept config) is left alone — its keys are service names,
   *  not entry ids. */
  private async loadGroupChildren(parent: PluginEntryOptions, children: readonly PluginEntryOptions[], parentContext: Context, baseUrl = this.baseUrl): Promise<void> {
    const prefix = `${parent.id}:`;
    const prefixed = children.map((child) => {
      const baseInject = child.inject;
      const inject = Array.isArray(baseInject)
        ? baseInject.map((dep) => (dep.includes(":") ? dep : `${parent.id}:${dep}`))
        : baseInject;
      return { ...child, id: `${prefix}${child.id}`, inject };
    });
    for (const child of prefixed) {
      this.groups.set(child.id, child);
    }
    await this.loadInternal(prefixed, parentContext, baseUrl);
  }

  private contextForEntry(parentContext: Context, entry: PluginEntryOptions): Context {
    let context = parentContext;
    for (const [name, label] of Object.entries(entry.isolate ?? {})) {
      if (label === true) {
        context = context.isolate(name);
      } else {
        const key = `${name}:${label}`;
        const realm = this.isolateLabels.get(key) ?? (() => {
          const value = Symbol(`openbuddy:${key}`);
          this.isolateLabels.set(key, value);
          return value;
        })();
        context = context.isolate(name, realm);
      }
    }
    return context;
  }

  /** Create a loader that owns a scoped composition while sharing imports and host context. */
  createScopedLoader(context: Context = this.context): HarnessPluginLoader {
    return new HarnessPluginLoader({
      context,
      baseUrl: this.baseUrl,
      importer: this.importer,
      logger: this.logger,
      onEvent: this.onEvent,
    });
  }

  /** Resolve an entry module through the same profile-aware importer as this loader. */
  importModule(specifier: string, baseUrl?: string): Promise<unknown> {
    return this.importer(specifier, baseUrl ?? this.baseUrl);
  }

  private async start(entry: PluginEntryOptions, imported?: HarnessPlugin, parentContext: Context = this.context, baseUrl = this.baseUrl): Promise<void> {
    if (entry.disabled) {
      this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "disabled" });
      this.emit("loader/entry-init", { id: entry.id, name: entry.name, disabled: true });
      return;
    }
    this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "pending" });
    this.emit("loader/entry-init", { id: entry.id, name: entry.name, options: { ...entry } });
    // Reflect the deepseek-harness "loading" fiber phase while the
    // importer is in flight. Skip when the caller already supplied the
    // module (caller did its own import).
    let plugin: HarnessPlugin;
    let disposeFailedScope: (() => Promise<void>) | undefined;
    try {
      const pluginContext = this.contextForEntry(parentContext, entry);
      if (imported) {
        plugin = imported;
      } else {
        this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "loading" });
        plugin = normalizePlugin(await this.importer(entry.name, baseUrl), entry.name);
      }
      let dispose: () => void | Promise<void>;
      if (plugin._kind === "class" && plugin._constructor) {
        // Use a transparent constructor adapter so Cordis owns the fork and
        // lifecycle while compatible plain-object Config metadata does not
        // get mistaken for a callable schema.
        await ensureContextStarted(pluginContext);
        const scope = pluginContext.plugin(classPluginAdapter(plugin, entry.name), entry.config);
        disposeFailedScope = async () => {
          scope.dispose();
          await flushCordisDisposal(pluginContext);
        };
        await pluginContext.events.flush();
        dispose = async () => {
          await disposeFailedScope?.();
        };
      } else {
        // Run function-shaped plugins through their own Cordis fork. This is
        // important for DeepSeek-style plugins that call ctx.effect()/ctx.on():
        // disposing the entry must dispose that fork, not the host context.
        let cleanupPromise: Promise<void> = Promise.resolve();
        let cleanupStarted = false;
        let applyError: unknown;
        let applyPromise: Promise<void> | undefined;
        const harness = {
          name: plugin.name ?? entry.name,
          // Preserve the DeepSeek Harness inject declaration in the Cordis
          // fiber as well as in the loader's ordering pass. This lets Cordis
          // track service availability and exposes the same dependency
          // contract to plugins that inspect their current fiber.
          inject: entry.inject ?? plugin.inject ?? [],
          provide: plugin.provide ?? entry.id,
          reusable: false,
          apply: (ctx: Context, config?: unknown) => {
            applyPromise = Promise.resolve().then(() => plugin.apply(ctx, config)).then((result) => {
              if (typeof result === "function") {
                const runCleanup = async (): Promise<void> => {
                  if (cleanupStarted) return cleanupPromise;
                  cleanupStarted = true;
                  cleanupPromise = Promise.resolve(result()).then(() => undefined);
                  await cleanupPromise;
                };
                ctx.effect(() => () => runCleanup());
              }
              // Loader profiles historically use an entry id as a dependency
              // even when the function plugin has no service object to expose
              // (for example a side-effect-only provider). Cordis only stores
              // object values through `provide()`, so install a scoped marker
              // for names that remain unresolved. Real services registered by
              // the plugin are never replaced.
              for (const provided of providesOf(plugin, entry)) {
                if (ctx.get(provided) === undefined) ctx.set(provided, true);
              }
            }).catch((error) => {
              applyError = error;
            });
            return applyPromise;
          },
        } as unknown as Parameters<Context["plugin"]>[0];
        const scope = pluginContext.plugin(harness, entry.config);
        disposeFailedScope = async () => {
          scope.dispose();
          await cleanupPromise;
          await flushCordisDisposal(pluginContext);
        };
        await pluginContext.events.flush();
        if (!applyPromise) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          await pluginContext.events.flush();
        }
        await applyPromise;
        if (applyError !== undefined) throw applyError;
        dispose = async () => {
          await disposeFailedScope?.();
        };
      }
      this.fibers.set(entry.id, {
        dispose,
        inject: dependenciesOf(entry.inject ?? plugin.inject),
      });
      this.resolvedInject.set(entry.id, dependenciesOf(entry.inject ?? plugin.inject));
      this.providedNames.set(entry.id, providesOf(plugin, entry));
      // Keep emitting the legacy "loaded" alias so existing UI panels that
      // filter on PluginStatus.state continue to work unchanged. The new
      // "active" state is reachable via PluginFiberState for consumers
      // that want the deepseek-harness-style fiber phase.
      this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "loaded" });
      this.emit("plugin/loaded", { id: entry.id, name: entry.name });
      this.emit("loader/patch-context", { id: entry.id, name: entry.name, config: entry.config });
      this.logger("debug", `loaded ${entry.id} (${entry.name})`);
      // Nested-group: a `group: true` entry can carry `children` that get
      // loaded under `${groupId}:${childId}`. Mirrors deepseek-harness
      // `EntryGroup.subgroup` semantics — child entries are scoped to
      // their parent group, can resolve inject against parent context,
      // and are visible via `loader.listGroup(groupId)`.
      if (entry.group) {
        this.groupParents.add(entry.id);
        if (entry.children?.length) {
          await this.loadGroupChildren(entry, entry.children, pluginContext, baseUrl);
        }
      }
    } catch (error) {
      try {
        await disposeFailedScope?.();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `plugin-loader: failed to clean up ${entry.id}`);
      }
      this.statuses.set(entry.id, { id: entry.id, name: entry.name, state: "failed", error: errorMessage(error) });
      this.emit("plugin/failed", { id: entry.id, name: entry.name, error: errorMessage(error) });
      this.emit("loader/partial-dispose", { id: entry.id, name: entry.name, error: errorMessage(error) });
      this.logger("error", `failed ${entry.id}: ${errorMessage(error)}`);
      throw error;
    }
  }

  private async stop(id: string): Promise<void> {
    const fiber = this.fibers.get(id);
    if (!fiber) return;
    this.fibers.delete(id);
    const entry = this.entryStore.get(id);
    if (entry) {
      this.statuses.set(id, { id, name: entry.name, state: "unloading" });
    }
    await fiber.dispose();
    if (entry) {
      // Emit the legacy "unloaded" state for UI back-compat (see note above).
      this.statuses.set(id, { id, name: entry.name, state: "unloaded" });
      this.emit("plugin/unloaded", { id, name: entry.name });
      this.emit("loader/partial-dispose", { id, name: entry.name });
    }
  }
}

export type Plugin = HarnessPlugin;

export { createIncludePlugin, type IncludeRuntime } from "./include";
export {
  installProfilePackage,
  listProfilePackages,
  ensureDefaultPiPackages,
  removeProfilePackage,
  // Phase I.1: keep `updateProfileExtensions` re-exported alongside the
  // existing profile-package helpers so marketplace install can write
  // the npm package name back into the profile without a second import
  // boundary.
  updateProfileExtensions,
  type ProfilePackageInfo,
  type ProfilePackageOptions,
  type DefaultPiPackageResult,
  type ProfilePackageManager,
} from "./profile-manager";

// Re-export `!!js` expression evaluator + deepseek-harness patch parser
// so consumers can import the full deepseek-harness compatibility surface
// from the single `@openbuddy/plugin-host` entry point.
export {
  evaluate,
  interpolate,
  isJsExpr,
  type JsExpr,
} from "./js-expr";
export {
  manifestToBundle,
  readBundleManifest,
  type BundleManifest,
  type BundleManifestField,
  type ReadBundleManifestOptions,
} from "./bundle-manifest";
export {
  parseCordisPatch,
  patchRowsToOpenBuddy,
  type PatchEntry,
  type PatchInsertRow,
  type PatchUpdateRow,
  type PatchRow,
  type ParsedPatchLayer,
  type ParsedCordisPatch,
  type CordisCompositionEntry,
} from "./yaml-patch";

// Re-export persistence so the deepseek-style manifest flow + persistence
// can be reached via a single import.
export {
  createPluginStateStore,
  type PluginStateOverride,
  type PluginStateSnapshot,
  type PluginStateStore,
  type PluginStateStoreOptions,
  type PluginCommitMarker,
} from "./persistence";
export {
  discoverRendererPluginEntries,
  composeRendererPluginBootGraph,
  type DiscoverRendererPluginOptions,
  type RendererPluginManifestEntry,
  type RendererPluginBootEntry,
  type RendererPluginBootGraph,
} from "./renderer-manifest";
export {
  discoverRemoteManifestEntries,
  type DiscoverRemoteManifestOptions,
  type RemoteManifestEntry,
} from "./remote-manifest";
export {
  discoverTypertManifestEntries,
  validateTypertHostContribution,
  type DiscoverTypertManifestOptions,
  type TypertHostContribution,
  type TypertManifestEntry,
} from "./typert-manifest";
export {
  hasRuntimePackageExport,
  packageExportValue,
  resolveExportTarget,
  RUNTIME_EXPORT_CONDITIONS,
  type ExportCondition,
} from "./export-target";
export {
  materializeOpenBuddyProfile,
  ensureOpenBuddyProfile,
  readOpenBuddyProfile,
  discoverPiPackagePaths,
  discoverPiPackageResources,
  discoverProfilePackagePaths,
  resolveOpenBuddyProfileDir,
  resolvePackageFromAnchors,
  OPENBUDDY_PROFILE_PATCH_FILE,
  OPENBUDDY_PROFILES_DIR,
  defaultOpenBuddyProfileHome,
  type OpenBuddyProfile,
  type OpenBuddyProfileManifest,
  type PiPackageManifest,
  type PiPackageResourcePaths,
  type OpenBuddyPiExtensionSpec,
  type OpenBuddyProfileOptions,
} from "./profile";
export {
  parseRemoteCodec,
  serializeRemoteCodec,
  serializeRemoteContribution,
  serializeRemoteSchema,
  validateRemoteCodec,
  validateRemoteSchema,
  RemoteCodecError,
  type RemoteCodec,
  type RemoteSchema,
} from "./remote-codec";
export * from "./rpc-contract";
export * from "./hooks";
export {
  CAPABILITY_TO_PLUGIN_ID,
  clearPassthroughRegistry,
  getPassthroughInfo,
  isPassthroughed,
  listPassthroughed,
  pluginIdForCapability,
  recordPassthrough,
  type PassthroughSource,
} from "./pi-passthrough";
