export interface DeepSeekCordisPluginEntry {
  id: string;
  name: string;
  config?: unknown;
  disabled?: boolean;
}

export type DeepSeekCordisPluginState =
  | "pending"
  | "loading"
  | "active"
  | "disabled"
  | "failed"
  | "disposed";

export interface DeepSeekCordisPluginSnapshot {
  id: string;
  name: string;
  state: DeepSeekCordisPluginState;
  error?: string;
}

export interface DeepSeekCordisRuntimeSnapshot {
  runtime: "deepseek-cordis";
  generation: number;
  plugins: DeepSeekCordisPluginSnapshot[];
  services: string[];
  capabilities: Array<{ service: string; methods: string[] }>;
  disposed: boolean;
}

export type DeepSeekCordisInvocation = {
  service: string;
  method: string;
  args?: readonly unknown[] | Record<string, unknown>;
  parameters?: readonly string[];
};

export interface DeepSeekCordisRuntimeOptions {
  cordisModule: unknown;
  importer: (specifier: string) => Promise<unknown>;
  bootstrap?: (context: unknown) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  onPluginActive?: (context: unknown, entry: DeepSeekCordisPluginEntry) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  allowInvocation?: (service: string, method: string) => boolean;
  onEvent?: (type: string, payload: unknown) => void;
}

type CordisContext = {
  get?: (name: string, strict?: boolean) => unknown;
  plugin: (plugin: unknown, config?: unknown) => unknown;
  provide?: (name: string, value: unknown) => unknown;
  reflect?: {
    store?: Record<PropertyKey, { name?: unknown }>;
  };
  fiber?: { dispose?: () => void | Promise<void> };
};

type CordisFiber = {
  dispose?: () => void | Promise<void>;
  await?: () => Promise<unknown>;
  then?: PromiseLike<unknown>["then"];
};

type DeepSeekCordisRuntimeState = {
  context: CordisContext;
  fibers: Map<string, CordisFiber>;
  plugins: Map<string, DeepSeekCordisPluginSnapshot>;
  entries: Map<string, DeepSeekCordisPluginEntry>;
  pluginCleanups: Map<string, () => void | Promise<void>>;
  bootstrapCleanup?: () => void | Promise<void>;
  bootstrapped: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const forbiddenMethods = new Set([
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__",
  "__proto__", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
  "prototype", "toLocaleString", "toString", "valueOf",
]);

function assertJsonValue(value: unknown, path = "$", ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new Error(`deepseek-cordis: ${path} contains a non-finite number`);
  }
  if (!value || typeof value !== "object") throw new Error(`deepseek-cordis: ${path} is not JSON-safe`);
  if (ancestors.has(value)) throw new Error(`deepseek-cordis: ${path} is cyclic`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) assertJsonValue(value[index], `${path}[${index}]`, ancestors);
      return;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error(`deepseek-cordis: ${path} is not a plain JSON object`);
    }
    for (const key of Object.keys(value)) assertJsonValue((value as Record<string, unknown>)[key], `${path}.${key}`, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function methodNames(service: object): string[] {
  const names = new Set<string>();
  for (let current: object | null = service; current && current !== Object.prototype; current = Object.getPrototypeOf(current) as object | null) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (key !== "constructor" && !forbiddenMethods.has(key) && typeof Object.getOwnPropertyDescriptor(current, key)?.value === "function") names.add(key);
    }
  }
  return [...names].sort();
}

function serviceMethod(service: object, method: string): ((...args: unknown[]) => unknown) | undefined {
  if (forbiddenMethods.has(method)) return undefined;
  for (let current: object | null = service; current && current !== Object.prototype; current = Object.getPrototypeOf(current) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, method);
    if (descriptor && typeof descriptor.value === "function") return descriptor.value as (...args: unknown[]) => unknown;
  }
  return undefined;
}

function invocationArgs(invocation: DeepSeekCordisInvocation): unknown[] {
  if (invocation.args === undefined) return [];
  if (Array.isArray(invocation.args)) {
    for (const [index, value] of invocation.args.entries()) assertJsonValue(value, `args[${index}]`);
    return [...invocation.args];
  }
  assertJsonValue(invocation.args, "args");
  if (!invocation.parameters) return [invocation.args];
  return invocation.parameters.map((name) => (invocation.args as Record<string, unknown>)[name]);
}

function moduleExport(module: unknown): unknown {
  if (!module || typeof module !== "object") return module;
  const namespace = module as Record<string, unknown>;
  return namespace.default ?? namespace;
}

function serviceNames(context: CordisContext): string[] {
  const names = new Set<string>();
  const store = context.reflect?.store;
  if (store) {
    for (const key of Reflect.ownKeys(store)) {
      const implementation = store[key];
      if (typeof implementation?.name === "string") names.add(implementation.name);
    }
  }
  return [...names].sort();
}

async function awaitFiber(fiber: CordisFiber): Promise<void> {
  if (typeof fiber.await === "function") {
    await fiber.await();
    return;
  }
  if (typeof fiber.then === "function") {
    await new Promise<unknown>((resolve, reject) => fiber.then!(resolve, reject));
  }
}

/**
 * Runs DeepSeek Harness plugins in their native Cordis runtime.
 *
 * This boundary is deliberately one-way: callers receive snapshots and
 * lifecycle notifications, never a DeepSeek Context, Fiber, or Service.
 */
export class DeepSeekCordisRuntime {
  private context: CordisContext;
  private readonly options: DeepSeekCordisRuntimeOptions;
  private fibers = new Map<string, CordisFiber>();
  private plugins = new Map<string, DeepSeekCordisPluginSnapshot>();
  private entries = new Map<string, DeepSeekCordisPluginEntry>();
  private pluginCleanups = new Map<string, () => void | Promise<void>>();
  private bootstrapCleanup: (() => void | Promise<void>) | undefined;
  private bootstrapped = false;
  private generation = 0;
  private disposed = false;
  private lifecycleTail: Promise<void> = Promise.resolve();

  constructor(options: DeepSeekCordisRuntimeOptions) {
    const Context = (options.cordisModule as { Context?: new () => CordisContext }).Context;
    if (typeof Context !== "function") {
      throw new Error("deepseek-cordis: cordis module does not export Context");
    }
    this.options = options;
    this.context = new Context();
  }

  getSnapshot(): DeepSeekCordisRuntimeSnapshot {
    const capabilities = serviceNames(this.context).map((service) => {
      const value = this.context.get?.(service);
      return { service, methods: value && typeof value === "object" ? methodNames(value) : [] };
    });
    return {
      runtime: "deepseek-cordis",
      generation: this.generation,
      plugins: [...this.plugins.values()].map((plugin) => ({ ...plugin })),
      services: serviceNames(this.context),
      capabilities,
      disposed: this.disposed,
    };
  }

  async invoke(invocation: DeepSeekCordisInvocation): Promise<unknown> {
    if (this.disposed) throw new Error("deepseek-cordis: runtime is disposed");
    if (!invocation || typeof invocation.service !== "string" || !invocation.service.trim()) {
      throw new Error("deepseek-cordis: invocation service is required");
    }
    if (typeof invocation.method !== "string" || !invocation.method.trim() || forbiddenMethods.has(invocation.method)) {
      throw new Error("deepseek-cordis: invocation method is invalid");
    }
    if (!this.options.allowInvocation?.(invocation.service, invocation.method)) {
      throw new Error(`deepseek-cordis: invocation is not allowed: ${invocation.service}/${invocation.method}`);
    }
    const service = this.context.get?.(invocation.service);
    if (!service || (typeof service !== "object" && typeof service !== "function")) {
      throw new Error(`deepseek-cordis: service is unavailable: ${invocation.service}`);
    }
    const method = serviceMethod(service, invocation.method);
    if (!method) throw new Error(`deepseek-cordis: method is unavailable: ${invocation.service}/${invocation.method}`);
    const result = await Reflect.apply(method, service, invocationArgs(invocation));
    assertJsonValue(result, "result");
    return result;
  }

  async load(entries: readonly DeepSeekCordisPluginEntry[]): Promise<DeepSeekCordisRuntimeSnapshot> {
    return this.enqueue(() => this.loadInternal(entries));
  }

  private async loadInternal(entries: readonly DeepSeekCordisPluginEntry[], activatePlugins = true): Promise<DeepSeekCordisRuntimeSnapshot> {
    if (this.disposed) throw new Error("deepseek-cordis: runtime is disposed");
    const initialEntryIds = new Set(this.entries.keys());
    for (const entry of entries) {
      if (!entry.id || !entry.name) throw new Error("deepseek-cordis: entry requires id and name");
      if (initialEntryIds.has(entry.id)) throw new Error(`deepseek-cordis: duplicate entry id: ${entry.id}`);
    }
    if (!this.bootstrapped) {
      const cleanup = await this.options.bootstrap?.(this.context);
      if (typeof cleanup === "function") this.bootstrapCleanup = cleanup;
      this.bootstrapped = true;
    }
    this.generation += 1;
    try {
      for (const entry of entries) {
        this.entries.set(entry.id, { ...entry });
        await this.loadEntry(entry, activatePlugins);
      }
    } catch (error) {
      const addedIds = [...this.entries.keys()].filter((id) => !initialEntryIds.has(id));
      const failedSnapshots = new Map(
        addedIds
          .map((id) => [id, this.plugins.get(id)] as const)
          .filter((entry): entry is readonly [string, DeepSeekCordisPluginSnapshot] => entry[1]?.state === "failed"),
      );
      const cleanupErrors: unknown[] = [];
      const state = this.captureState();
      for (const id of addedIds.reverse()) {
        try {
          await this.disposeStateEntry(state, id);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      for (const id of addedIds) {
        const failed = failedSnapshots.get(id);
        if (failed) {
          this.plugins.set(id, failed);
          this.entries.set(id, { ...entries.find((entry) => entry.id === id) ?? { id, name: failed.name } });
        } else {
          this.plugins.delete(id);
          this.entries.delete(id);
        }
      }
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "deepseek-cordis: load rollback failed");
      throw error;
    }
    return this.getSnapshot();
  }

  async replace(entries: readonly DeepSeekCordisPluginEntry[]): Promise<DeepSeekCordisRuntimeSnapshot> {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error("deepseek-cordis: runtime is disposed");
      const candidate = new DeepSeekCordisRuntime({ ...this.options, onEvent: () => undefined });
      try {
        await candidate.loadInternal(entries, false);
      } catch (error) {
        await candidate.disposeInternal().catch((disposeError) => {
          throw new AggregateError([error, disposeError], "deepseek-cordis: candidate replacement cleanup failed");
        });
        throw error;
      }
      const previous = this.captureState();
      await this.deactivateStatePlugins(previous);
      this.adoptState(candidate.captureState());
      this.generation += 1;
      try {
        for (const entry of this.entries.values()) {
          if (entry.disabled) this.emit("plugin/disabled", this.plugins.get(entry.id));
        }
        await this.activateStatePlugins();
      } catch (error) {
        const rejected = this.captureState();
        await this.disposeState(rejected).catch((disposeError) => {
          throw new AggregateError([error, disposeError], "deepseek-cordis: rejected replacement cleanup failed");
        });
        this.adoptState(previous);
        try {
          await this.activateStatePlugins();
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "deepseek-cordis: replacement rollback failed");
        }
        throw error;
      }
      await this.disposeState(previous);
      return this.getSnapshot();
    });
  }

  private async loadEntry(entry: DeepSeekCordisPluginEntry, activate = true): Promise<void> {
    if (entry.disabled) {
      this.plugins.set(entry.id, { id: entry.id, name: entry.name, state: "disabled" });
      this.emit("plugin/disabled", this.plugins.get(entry.id));
      return;
    }
    this.plugins.set(entry.id, { id: entry.id, name: entry.name, state: "loading" });
    this.emit("plugin/loading", this.plugins.get(entry.id));
    try {
      const plugin = moduleExport(await this.options.importer(entry.name));
      const fiber = this.context.plugin(plugin, entry.config) as CordisFiber;
      this.fibers.set(entry.id, fiber);
      await awaitFiber(fiber);
      if (activate) await this.activatePlugin(entry);
    } catch (error) {
      const snapshot = { id: entry.id, name: entry.name, state: "failed" as const, error: errorMessage(error) };
      this.plugins.set(entry.id, snapshot);
      this.emit("plugin/failed", snapshot);
      throw new Error(`deepseek-cordis: failed to load ${entry.id} (${entry.name}): ${errorMessage(error)}`, { cause: error });
    }
  }

  async dispose(): Promise<DeepSeekCordisRuntimeSnapshot> {
    return this.enqueue(() => this.disposeInternal());
  }

  private async disposeInternal(): Promise<DeepSeekCordisRuntimeSnapshot> {
    if (this.disposed) return this.getSnapshot();
    this.generation += 1;
    await this.disposeState(this.captureState());
    this.disposed = true;
    this.emit("runtime/disposed", this.getSnapshot());
    return this.getSnapshot();
  }

  private captureState(): DeepSeekCordisRuntimeState {
    return {
      context: this.context,
      fibers: this.fibers,
      plugins: this.plugins,
      entries: this.entries,
      pluginCleanups: this.pluginCleanups,
      bootstrapCleanup: this.bootstrapCleanup,
      bootstrapped: this.bootstrapped,
    };
  }

  private adoptState(state: DeepSeekCordisRuntimeState): void {
    this.context = state.context;
    this.fibers = state.fibers;
    this.plugins = state.plugins;
    this.entries = state.entries;
    this.pluginCleanups = state.pluginCleanups;
    this.bootstrapCleanup = state.bootstrapCleanup;
    this.bootstrapped = state.bootstrapped;
    this.disposed = false;
  }

  private async disposeState(state: DeepSeekCordisRuntimeState): Promise<void> {
    for (const id of [...state.fibers.keys()].reverse()) await this.disposeStateEntry(state, id);
    try {
      await state.bootstrapCleanup?.();
    } finally {
      state.bootstrapCleanup = undefined;
      await state.context.fiber?.dispose?.();
    }
    state.fibers.clear();
    state.entries.clear();
    state.pluginCleanups.clear();
    state.bootstrapped = false;
  }

  private async activatePlugin(entry: DeepSeekCordisPluginEntry): Promise<void> {
    try {
      const cleanup = await this.options.onPluginActive?.(this.context, entry);
      if (typeof cleanup === "function") this.pluginCleanups.set(entry.id, cleanup);
      this.plugins.set(entry.id, { id: entry.id, name: entry.name, state: "active" });
      this.emit("plugin/active", this.plugins.get(entry.id));
    } catch (error) {
      const snapshot = { id: entry.id, name: entry.name, state: "failed" as const, error: errorMessage(error) };
      this.plugins.set(entry.id, snapshot);
      this.emit("plugin/failed", snapshot);
      throw new Error(`deepseek-cordis: failed to activate ${entry.id} (${entry.name}): ${errorMessage(error)}`, { cause: error });
    }
  }

  private async activateStatePlugins(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.disabled || this.plugins.get(entry.id)?.state !== "loading") continue;
      await this.activatePlugin(entry);
    }
  }

  private async deactivateStatePlugins(state: DeepSeekCordisRuntimeState): Promise<void> {
    for (const id of [...state.fibers.keys()].reverse()) {
      await state.pluginCleanups.get(id)?.();
      state.pluginCleanups.delete(id);
      const plugin = state.plugins.get(id);
      if (plugin?.state === "active") state.plugins.set(id, { ...plugin, state: "loading" });
    }
  }

  private async disposeStateEntry(state: DeepSeekCordisRuntimeState, id: string): Promise<void> {
    const fiber = state.fibers.get(id);
    const plugin = state.plugins.get(id);
    if (!fiber) {
      state.entries.delete(id);
      return;
    }
    if (plugin) state.plugins.set(id, { ...plugin, state: "pending" });
    try {
      await state.pluginCleanups.get(id)?.();
      state.pluginCleanups.delete(id);
      await fiber.dispose?.();
    } finally {
      if (plugin) state.plugins.set(id, { ...plugin, state: "disposed" });
      state.fibers.delete(id);
      state.entries.delete(id);
      this.emit("plugin/disposed", state.plugins.get(id));
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.lifecycleTail.then(operation, operation);
    this.lifecycleTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private emit(type: string, payload: unknown): void {
    this.options.onEvent?.(type, payload);
  }
}
