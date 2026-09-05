export type ClientModuleFactory = (require: (specifier: string) => unknown) => unknown;

export interface ClientBundleRegistration {
  id: string;
  factory: ClientModuleFactory;
}

export interface ClientModuleEntry {
  id: string;
  moduleId?: string;
  moduleKey?: string;
  name: string;
  inject?: readonly string[];
  external?: readonly string[];
  immediately?: boolean;
  moduleUrl?: string;
}

export interface ClientModuleBootEntry {
  id: string;
  url: string;
  rev: string;
  inject?: string[];
  external?: string[];
  immediately?: boolean;
}

export interface ClientModuleBootGraph {
  rev: string;
  entries: ClientModuleBootEntry[];
}

export interface ClientModuleRecord {
  id: string;
  exports: unknown;
  edges: Set<string>;
  /** Style tags claimed by this module while its factory was materialized. */
  styles: string[];
}

export interface ClientModuleSystemOptions {
  entries: readonly ClientModuleEntry[];
  staticModules?: Record<string, unknown>;
  importModule?: (entry: ClientModuleEntry, url: string) => Promise<unknown>;
  loadBundle?: (entry: ClientModuleEntry, url: string) => Promise<void>;
  resolveModuleUrl?: (entry: ClientModuleEntry) => Promise<string> | string;
  registrationTarget?: ClientModuleRegistrationTarget;
}

export interface ClientModuleRegistrationTarget {
  mode: "queue" | "live";
  pendingQueue: ClientBundleRegistration[];
  load(registration: ClientBundleRegistration): void;
}

function normalized(value: string): string {
  return value
    .replace(/^openbuddy:renderer\//, "")
    .replace(/\/client$/, "")
    .replace(/\/client\.js$/, "");
}

function staticModule(modules: Map<string, unknown>, specifier: string): unknown | undefined {
  if (modules.has(specifier)) return modules.get(specifier);
  const normalizedSpecifier = normalized(specifier);
  for (const [key, value] of modules) {
    if (normalized(key) === normalizedSpecifier) return value;
  }
  return undefined;
}

function hasStaticModule(modules: Map<string, unknown>, specifier: string): boolean {
  if (modules.has(specifier)) return true;
  const normalizedSpecifier = normalized(specifier);
  for (const key of modules.keys()) if (normalized(key) === normalizedSpecifier) return true;
  return false;
}

function moduleExports(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (record.__esModule === true && "default" in record && Object.keys(record).length <= 2) {
    return record.default;
  }
  return value;
}

function graphRevision(entries: readonly ClientModuleBootEntry[]): string {
  const source = JSON.stringify(entries);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `openbuddy-client-${(hash >>> 0).toString(16)}`;
}

function moduleRevision(url: string): string {
  let hash = 2166136261;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function stylesCreatedSince(before: Set<Element>): HTMLStyleElement[] {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll("style")].filter((element) => !before.has(element));
}

function claimStyles(id: string, owner: string, before: Set<Element>): string[] {
  const created = stylesCreatedSince(before);
  for (const element of created) {
    if (!element.hasAttribute("data-plugin")) element.setAttribute("data-plugin", id);
    element.setAttribute("data-plugin-owner", owner);
  }
  return created.filter((element) => element.getAttribute("data-plugin") === id)
    .map((element) => element.getAttribute("data-plugin-css") ?? id);
}

function removeCreatedStyles(before: Set<Element>): void {
  for (const element of stylesCreatedSince(before)) element.remove();
}

function removeStyles(id: string, owner?: string): void {
  if (typeof document === "undefined") return;
  const selector = owner
    ? `style[data-plugin=${JSON.stringify(id)}][data-plugin-owner=${JSON.stringify(owner)}]`
    : `style[data-plugin=${JSON.stringify(id)}]`;
  for (const element of document.querySelectorAll(selector)) {
    element.remove();
  }
}

let clientModuleOwnerSequence = 0;

export class ClientModuleSystem {
  private readonly rows = new Map<string, ClientModuleEntry>();
  private readonly aliases = new Map<string, string>();
  private readonly staticModules: Map<string, unknown>;
  private readonly records = new Map<string, ClientModuleRecord>();
  private readonly factories = new Map<string, ClientModuleFactory>();
  private readonly factoryEpochs = new Map<string, number>();
  private readonly arrivals = new Map<string, Promise<void>>();
  private readonly arrivalEpochs = new Map<string, number>();
  private readonly loadingEpochs = new Map<string, number>();
  private readonly invalidationEpochs = new Map<string, number>();
  private readonly importing = new Set<string>();
  private readonly importModule: NonNullable<ClientModuleSystemOptions["importModule"]>;
  private readonly loadBundle?: ClientModuleSystemOptions["loadBundle"];
  private readonly resolveModuleUrl: NonNullable<ClientModuleSystemOptions["resolveModuleUrl"]>;
  private readonly registrationTarget: ClientModuleRegistrationTarget;
  private readonly styleOwner = `openbuddy-client-owner-${++clientModuleOwnerSequence}`;
  private disposed = false;

  constructor(options: ClientModuleSystemOptions) {
    this.staticModules = new Map(Object.entries(options.staticModules ?? {}));
    this.importModule = options.importModule ?? (async (_entry, url) => import(/* @vite-ignore */ url));
    this.loadBundle = options.loadBundle;
    this.resolveModuleUrl = options.resolveModuleUrl ?? ((entry) => {
      if (!entry.moduleUrl) throw new Error(`renderer-module: entry ${entry.id} has no module URL`);
      return entry.moduleUrl;
    });
    this.registrationTarget = options.registrationTarget ?? {
      mode: "live",
      pendingQueue: [],
      load: (registration) => this.register(registration),
    };
    for (const entry of options.entries) this.addEntry(entry);
    for (const registration of this.registrationTarget.pendingQueue.splice(0)) this.register(registration);
    this.registrationTarget.mode = "live";
    this.registrationTarget.load = (registration) => this.register(registration);
  }

  private addEntry(entry: ClientModuleEntry): void {
    if (this.rows.has(entry.id)) throw new Error(`renderer-module: duplicate entry ${entry.id}`);
    this.rows.set(entry.id, { ...entry, external: [...(entry.external ?? [])] });
    for (const alias of [entry.id, entry.name, entry.moduleId, entry.moduleKey]) {
      if (alias) this.aliases.set(normalized(alias), entry.id);
    }
  }

  private idOf(specifier: string): string {
    const key = normalized(specifier);
    return this.aliases.get(key) ?? key;
  }

  private register(registration: ClientBundleRegistration): void {
    if (this.disposed) return;
    const id = this.idOf(registration.id);
    if (!this.rows.has(id)) throw new Error(`renderer-module: unknown factory ${registration.id}`);
    if (this.factories.has(id)) throw new Error(`renderer-module: duplicate factory ${registration.id}`);
    this.factories.set(id, registration.factory);
    this.factoryEpochs.set(id, this.loadingEpochs.get(id) ?? this.epochOf(id));
  }

  private drainPendingRegistrations(): void {
    const pending = this.registrationTarget.pendingQueue.splice(0);
    for (const registration of pending) this.register(registration);
  }

  private epochOf(id: string): number {
    return this.invalidationEpochs.get(id) ?? 0;
  }

  private async arrive(id: string): Promise<void> {
    if (this.records.has(id) || this.factories.has(id)) return;
    const existing = this.arrivals.get(id);
    if (existing) {
      const existingEpoch = this.arrivalEpochs.get(id) ?? this.epochOf(id);
      try {
        await existing;
      } catch (error) {
        if (this.epochOf(id) !== existingEpoch) return this.arrive(id);
        throw error;
      }
      if (this.epochOf(id) !== existingEpoch) return this.arrive(id);
      return;
    }
    const entry = this.rows.get(id);
    if (!entry) throw new Error(`renderer-module: cannot resolve ${id}`);
    const epoch = this.epochOf(id);
    const task = (async () => {
      this.loadingEpochs.set(id, epoch);
      const beforeStyles = typeof document === "undefined" ? new Set<Element>() : new Set(document.querySelectorAll("style"));
      try {
        const staticValue = staticModule(this.staticModules, entry.moduleId ?? entry.name);
        if (staticValue !== undefined) {
          this.records.set(id, { id, exports: moduleExports(staticValue), edges: new Set(), styles: [] });
          return;
        }
        const url = await this.resolveModuleUrl(entry);
        let imported: unknown;
        if (this.loadBundle && /^(?:file:|https?:)/i.test(url)) await this.loadBundle(entry, url);
        this.drainPendingRegistrations();
        if (!this.factories.has(id)) imported = await this.importModule(entry, url);
        this.drainPendingRegistrations();
        const registration = imported && typeof imported === "object"
          ? (imported as { registration?: ClientBundleRegistration }).registration
          : undefined;
        if (registration) this.register(registration);
        if (this.epochOf(id) !== epoch) {
          if (this.factoryEpochs.get(id) === epoch) {
            this.factories.delete(id);
            this.factoryEpochs.delete(id);
          }
          throw new Error(`renderer-module: arrival invalidated for ${id}`);
        }
        if (this.disposed) throw new Error("renderer-module: module system is disposed");
        if (!this.factories.has(id)) {
          const exports = moduleExports(imported);
          this.records.set(id, { id, exports, edges: new Set(), styles: claimStyles(id, this.styleOwner, beforeStyles) });
        }
      } catch (error) {
        removeCreatedStyles(beforeStyles);
        throw error;
      }
    })().finally(() => {
      if (this.arrivals.get(id) === task) {
        this.arrivals.delete(id);
        this.arrivalEpochs.delete(id);
      }
      if (this.loadingEpochs.get(id) === epoch) this.loadingEpochs.delete(id);
    });
    this.arrivals.set(id, task);
    this.arrivalEpochs.set(id, epoch);
    return task;
  }

  private async arriveGraph(id: string, path: readonly string[] = []): Promise<void> {
    if (path.includes(id)) throw new Error(`renderer-module: external cycle ${[...path, id].join(" -> ")}`);
    const entry = this.rows.get(id);
    if (!entry) throw new Error(`renderer-module: cannot resolve ${id}`);
    for (const dependency of entry.external ?? []) {
      const externalId = this.idOf(dependency);
      if (hasStaticModule(this.staticModules, dependency) || hasStaticModule(this.staticModules, externalId)) continue;
      if (externalId === id) throw new Error(`renderer-module: ${entry.id} requests its own package ${dependency}`);
      if (!this.rows.has(externalId)) throw new Error(`renderer-module: cannot resolve external ${dependency} requested by ${entry.id}`);
      await this.arriveGraph(externalId, [...path, id]);
    }
    await this.arrive(id);
  }

  private materialize(id: string): ClientModuleRecord {
    if (this.disposed) throw new Error("renderer-module: module system is disposed");
    const existing = this.records.get(id);
    if (existing) return existing;
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`renderer-module: factory ${id} has not arrived`);
    if (this.importing.has(id)) throw new Error(`renderer-module: require cycle ${id}`);
    this.importing.add(id);
    const beforeStyles = typeof document === "undefined" ? new Set<Element>() : new Set(document.querySelectorAll("style"));
    try {
      const edges = new Set<string>();
      const exports = factory((specifier) => {
        edges.add(specifier);
        const staticValue = staticModule(this.staticModules, specifier);
        if (staticValue !== undefined) return staticValue;
        const dependency = this.records.get(this.idOf(specifier));
        if (dependency) return dependency.exports;
        const dependencyFactory = this.factories.get(this.idOf(specifier));
        if (dependencyFactory) return this.materialize(this.idOf(specifier)).exports;
        throw new Error(`renderer-module: require(${specifier}) missed the module table`);
      });
      const record = { id, exports, edges, styles: claimStyles(id, this.styleOwner, beforeStyles) };
      this.records.set(id, record);
      return record;
    } catch (error) {
      removeCreatedStyles(beforeStyles);
      throw error;
    } finally {
      this.importing.delete(id);
    }
  }

  async import(specifier: string): Promise<unknown> {
    if (this.disposed) throw new Error("renderer-module: module system is disposed");
    const staticValue = staticModule(this.staticModules, specifier);
    if (staticValue !== undefined) return staticValue;
    const id = this.idOf(specifier);
    const entry = this.rows.get(id);
    const entryStaticValue = entry
      ? staticModule(this.staticModules, entry.moduleId ?? entry.name)
      : undefined;
    if (entryStaticValue !== undefined) return entryStaticValue;
    if (!this.rows.has(id)) throw new Error(`renderer-module: unknown module ${specifier}`);
    await this.arriveGraph(id);
    return this.records.get(id)?.exports ?? this.materialize(id).exports;
  }

  async prefetch(specifier: string): Promise<void> {
    if (this.disposed) throw new Error("renderer-module: module system is disposed");
    await this.arriveGraph(this.idOf(specifier));
  }

  async bootGraph(): Promise<ClientModuleBootGraph> {
    const entries: ClientModuleBootEntry[] = [];
    // Resolve URLs asynchronously after the synchronous topological walk so a
    // malformed graph fails before any bundle is fetched.
    const order: string[] = [];
    const orderVisited = new Set<string>();
    const orderVisiting = new Set<string>();
    const walk = (id: string): void => {
      if (orderVisited.has(id)) return;
      if (orderVisiting.has(id)) throw new Error(`renderer-module: external cycle ${id}`);
      orderVisiting.add(id);
      const entry = this.rows.get(id)!;
      for (const dependency of entry.external ?? []) {
        const dependencyId = this.idOf(dependency);
        if (hasStaticModule(this.staticModules, dependency) || hasStaticModule(this.staticModules, dependencyId)) continue;
        if (dependencyId === id) throw new Error(`renderer-module: ${entry.id} requests its own package ${dependency}`);
        if (!this.rows.has(dependencyId)) throw new Error(`renderer-module: cannot resolve external ${dependency} requested by ${entry.id}`);
        walk(dependencyId);
      }
      orderVisiting.delete(id);
      orderVisited.add(id);
      order.push(id);
    };
    for (const id of this.rows.keys()) walk(id);
    entries.length = 0;
    for (const id of order) {
      const entry = this.rows.get(id)!;
      const url = await this.resolveModuleUrl(entry);
      entries.push({
        id: entry.id,
        url,
        rev: moduleRevision(url),
        ...(entry.inject ? { inject: [...entry.inject] } : {}),
        ...(entry.external?.length ? { external: [...entry.external] } : {}),
        ...(entry.immediately ? { immediately: true } : {}),
      });
    }
    return { rev: graphRevision(entries), entries };
  }

  invalidate(specifier: string): string[] {
    if (this.disposed) return [];
    const id = this.idOf(specifier);
    const invalidated = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.rows.values()) {
        if (invalidated.has(entry.id)) continue;
        if ((entry.external ?? []).some((edge) => invalidated.has(this.idOf(edge)))) {
          invalidated.add(entry.id);
          changed = true;
        }
      }
      for (const record of this.records.values()) {
        if (invalidated.has(record.id)) continue;
        if ([...record.edges].some((edge) => invalidated.has(this.idOf(edge)))) {
          invalidated.add(record.id);
          changed = true;
        }
      }
    }
    for (const entryId of invalidated) {
      this.invalidationEpochs.set(entryId, this.epochOf(entryId) + 1);
      this.factories.delete(entryId);
      this.factoryEpochs.delete(entryId);
      removeStyles(entryId, this.styleOwner);
      this.records.delete(entryId);
    }
    return [...invalidated];
  }

  /** Release module-owned styles and cached factories before replacing the graph. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.records.keys()) removeStyles(id, this.styleOwner);
    this.records.clear();
    this.factories.clear();
    this.factoryEpochs.clear();
    this.arrivals.clear();
    this.arrivalEpochs.clear();
    this.loadingEpochs.clear();
    this.importing.clear();
    this.registrationTarget.pendingQueue.splice(0);
  }

  has(specifier: string): boolean {
    return hasStaticModule(this.staticModules, specifier) || this.rows.has(this.idOf(specifier));
  }

  list(): ClientModuleRecord[] {
    return [...this.records.values()].map((record) => ({ ...record, edges: new Set(record.edges), styles: [...record.styles] }));
  }
}
