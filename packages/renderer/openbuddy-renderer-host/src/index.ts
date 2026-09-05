import type { Context } from "@openbuddy/cordis";
import type { HarnessTransport } from "./harness-transport";

export {
  ClientModuleSystem,
  type ClientBundleRegistration,
  type ClientModuleEntry,
  type ClientModuleBootEntry,
  type ClientModuleBootGraph,
  type ClientModuleFactory,
  type ClientModuleRecord,
  type ClientModuleRegistrationTarget,
  type ClientModuleSystemOptions,
} from "./client-modules";

export {
  createDeepSeekClientCompatibilityModules,
  DeepSeekLocaleService,
  DeepSeekLayoutController,
  DeepSeekModelSelectionService,
  DeepSeekSettingsModelsService,
  DeepSeekWorkspaceService,
  DeepSeekSessionsService,
  DeepSeekThemeService,
  DeepSeekUiRendererService,
  DeepSeekSlotCore,
  DeepSeekSlotRegistry,
  type ClientRemoteContribution,
  type DeepSeekChainMatch,
  type DeepSeekLayoutState,
  type DeepSeekThemeDefinition,
  type DeepSeekThemeSnapshot,
  type DeepSeekSlotEntry,
  type DeepSeekSlotOptions,
  type DeepSeekWorkspaceRecord,
  type DeepSeekSessionRecord,
  type DeepSeekSessionListSnapshot,
  type DeepSeekSubagentAddress,
  type DeepSeekSubagentOpenOptions,
  type DeepSeekSubagentBreadcrumb,
  type DeepSeekSubagentCatalog,
  type DeepSeekSubagentEntry,
  type DeepSeekWorkspaceListSnapshot,
  type DeepSeekSessionBinding,
  type DeepSeekConversationSnapshot,
  type DeepSeekSessionProvideDescriptor,
  type DeepSeekSessionProvideInfo,
  type DeepSeekPromptContentPart,
  type DeepSeekQueueAction,
} from "./deepseek-compat";

export {
  ConnectionController,
  type ConnectionCarrier,
  type ConnectionConfig,
  type ConnectionControllerOptions,
  type ConnectionState,
} from "./connection-controller";

export {
  createWebHarnessTransport,
  type HarnessTransport,
  type HarnessTransportEvent,
  type HarnessTransportRequest,
  type WebHarnessTransportOptions,
} from "./harness-transport";

export {
  OpenBuddyConversationAssembler,
  type ConversationDefinition,
  type ConversationEvent,
  type ConversationLocation,
  type ConversationMatch,
  type ConversationNodeContext,
  type ConversationPreviousContext,
  type ConversationPublication,
  type ConversationTargetSnapshot,
  type ConversationTimelineSnapshot,
  type ConversationViewBuilder,
  type ConversationViewDefinition,
  type ConversationViewNode,
  type StepLocation,
  type TurnLocation,
} from "./conversation-assembler";

export interface RendererContribution {
  kind: "sidebar" | "assistant" | "project" | "composer" | "message" | "settings" | "command";
  id: string;
  payload: RendererContributionPayload;
}

export interface AssistantRendererContributionPayload extends RendererContributionPayload {
  route: `助理·${string}`;
  order?: number;
  modes?: Array<"personal" | "organization" | "network">;
  capabilityIds?: string[];
  requiredTrust?: "local" | "org" | "known_peer" | "public";
}

export type AssistantRendererContribution = Omit<RendererContribution, "kind" | "payload"> & {
  kind: "assistant";
  payload: AssistantRendererContributionPayload;
};

export interface ProjectRendererContributionPayload extends RendererContributionPayload {
  projectTab: string;
  order?: number;
  modes?: Array<"personal" | "organization" | "network">;
  capabilityIds?: string[];
  requiredTrust?: "local" | "org" | "known_peer" | "public";
}

export type ProjectRendererContribution = Omit<RendererContribution, "kind" | "payload"> & {
  kind: "project";
  payload: ProjectRendererContributionPayload;
};

/**
 * Renderer-only contribution data. Function values intentionally stay on the
 * renderer side: main-process manifests describe modules, while a loaded
 * client bundle can attach live actions without crossing IPC serialization.
 */
export interface RendererContributionPayload extends Record<string, unknown> {
  label?: string;
  title?: string;
  description?: string;
  insertText?: string;
  placeholder?: string;
  route?: string;
  onActivate?: () => void;
  command?: string;
  component?: unknown;
  options?: Record<string, unknown>;
}

export interface RendererPlugin {
  id?: string;
  name?: string;
  inject?: readonly string[] | Record<string, unknown>;
  provide?: string | readonly string[];
  apply: (ctx: Context, config?: unknown) => void | (() => void) | Promise<void | (() => void)>;
}

export interface RendererAgentEvent {
  type: string;
  payload: unknown;
  sessionId?: string;
  sequence?: number;
  timestamp?: string;
}

export interface RendererAgentApi {
  readonly apiVersion: 1;
  transport?: HarnessTransport;
  init(cwd?: string): Promise<unknown>;
  newSession(cwd: string, modelId?: string): Promise<string>;
  loadSession(sessionId: string, cwd: string): Promise<void>;
  listSessions(cwd: string): Promise<unknown[]>;
  listWorkspaces(): Promise<unknown[]>;
  prompt(sessionId: string, text: string): Promise<void>;
  steer(sessionId: string, text: string): Promise<void>;
  followUp(sessionId: string, text: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  setModel(sessionId: string, modelId: string): Promise<void>;
  currentModel(): Promise<unknown>;
  sessionInfo(sessionId: string): Promise<unknown>;
  sessionUsage(sessionId: string): Promise<unknown>;
  eventLog(query?: { sessionId?: string; sinceSequence?: number; limit?: number }): Promise<RendererAgentEvent[]>;
  listCommands(): Promise<unknown[]>;
  listPlugins(): Promise<unknown[]>;
  /** Tools the active Pi runtime exposes (G-1d adapters + built-ins). */
  toolsList(): Promise<unknown[]>;
  onEvent(handler: (event: RendererAgentEvent) => void): Promise<() => void>;
  onPluginEvent?: (handler: (event: RendererAgentEvent) => void) => Promise<() => void>;
  onRpcMessage?: (handler: (message: unknown) => void) => Promise<() => void>;
  invoke?(channel: string, args?: unknown): Promise<unknown>;
}

export interface RendererPluginEntry {
  id: string;
  moduleId?: string;
  name: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  external?: readonly string[];
  immediately?: boolean;
  disabled?: boolean;
  group?: boolean | null;
  children?: readonly RendererPluginEntry[];
}

export interface RendererPluginProfile {
  entries: RendererPluginEntry[];
  patches?: readonly RendererPluginPatch[][];
}

export interface RendererPluginPatch {
  id?: string;
  insert?: RendererPluginEntry | RendererPluginEntry[];
  disabled?: boolean;
  name?: string;
  config?: unknown;
  inject?: readonly string[] | Record<string, unknown>;
  group?: RendererPluginEntry["group"];
  children?: readonly RendererPluginEntry[];
}

export interface RendererPluginStatus {
  id: string;
  name: string;
  state: "pending" | "loaded" | "disabled" | "failed" | "unloaded";
  error?: string;
}

export interface RendererPluginEntryInfo {
  id: string;
  options: RendererPluginEntry;
  status: RendererPluginStatus;
  fiber?: RendererPluginFiberInfo;
}

export interface RendererPluginFiberInfo {
  state: RendererPluginStatus["state"];
  ctx: Context;
  inject: Record<string, unknown>;
  await(): Promise<void>;
  dispose(): Promise<void>;
}

export class RendererContributionRegistry {
  private readonly values = new Map<string, RendererContribution>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  register(contribution: RendererContribution): () => void {
    if (!contribution.id) throw new Error("renderer-plugin: contribution id is required");
    if (contribution.kind === "assistant") {
      const route = contribution.payload.route;
      const reservedRoutes = new Set(["助理", "助理·收件箱", "助理·日程", "助理·跨项目任务", "助理·工作流", "助理·Rooms", "助理·助理与 Buddy", "助理·开放网络", "助理·能力与策略", "助理·证据与审计", "助理·副作用恢复"]);
      if (typeof route !== "string" || !/^助理·\S(?:.*\S)?$/u.test(route)) throw new Error("renderer-plugin: assistant contribution route must be a non-empty 助理 submenu");
      if (reservedRoutes.has(route)) throw new Error("renderer-plugin: assistant contribution route is reserved by the core workbench");
      if (!contribution.payload.label && !contribution.payload.title) throw new Error("renderer-plugin: assistant contribution label or title is required");
      const duplicate = [...this.values.values()].find((value) => value.kind === "assistant" && value.payload.route === route && value.id !== contribution.id);
      if (duplicate) throw new Error(`renderer-plugin: assistant contribution route is already registered: ${route}`);
    }
    if (contribution.kind === "project") {
      const tab = contribution.payload.projectTab;
      if (typeof tab !== "string" || !/^\S(?:.*\S)?$/u.test(tab)) throw new Error("renderer-plugin: project contribution tab must be non-empty");
      if (!contribution.payload.label && !contribution.payload.title) throw new Error("renderer-plugin: project contribution label or title is required");
      const duplicate = [...this.values.values()].find((value) => value.kind === "project" && value.payload.projectTab === tab && value.id !== contribution.id);
      if (duplicate) throw new Error(`renderer-plugin: project contribution tab is already registered: ${tab}`);
    }
    const previous = this.values.get(contribution.id);
    this.values.set(contribution.id, contribution);
    if (previous !== contribution) this.changed();
    return () => {
      if (this.values.get(contribution.id) !== contribution) return false;
      const deleted = this.values.delete(contribution.id);
      if (deleted) this.changed();
      return deleted;
    };
  }

  list(): RendererContribution[] {
    return [...this.values.values()].map((value) => ({ ...value, payload: { ...value.payload } }));
  }

  getVersion(): number { return this.revision; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.revision += 1;
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* isolate UI observers */ }
    }
  }
}

export class RendererEventRegistry {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(type: string, listener: (payload: unknown) => void): () => void {
    const listeners = this.listeners.get(type) ?? new Set<(payload: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(type); };
  }

  emit(type: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      try { listener(payload); } catch { /* isolate renderer plugin listeners */ }
    }
  }
}

export function createRendererContext(
  context: Context,
  agentApi?: Pick<RendererAgentApi, "apiVersion"> & Partial<Omit<RendererAgentApi, "apiVersion">>,
): Context {
  const contributions = new RendererContributionRegistry();
  const events = new RendererEventRegistry();
  context.provide("rendererContributions", contributions);
  context.provide("rendererEvents", events);
  context.provide("agentApi", agentApi);
  context.provide("rendererApiVersion", "1");
  return context;
}

function dependenciesOf(inject: RendererPlugin["inject"]): string[] {
  return Array.isArray(inject) ? [...inject] : Object.keys(inject ?? {});
}

function contextInject(context: Context, inject: RendererPlugin["inject"]): RendererPlugin["inject"] {
  if (Array.isArray(inject)) return inject.filter((name) => context.get(name) !== undefined);
  if (!inject) return inject;
  return Object.fromEntries(Object.entries(inject).filter(([name]) => context.get(name) !== undefined));
}

function providesOf(plugin: RendererPlugin, entry: RendererPluginEntry): string[] {
  const provided = plugin.provide;
  return [entry.id, entry.name, ...(Array.isArray(provided) ? [...provided] : provided ? [provided] : [])];
}

async function ensureContextStarted(context: Context): Promise<void> {
  const lifecycle = (context as unknown as { lifecycle?: { isActive?: boolean } }).lifecycle;
  if (!lifecycle?.isActive) await context.start();
}

function classPluginAdapter(
  plugin: RendererPlugin,
  entryName: string,
): Parameters<Context["plugin"]>[0] {
  const Constructor = plugin.apply as unknown as new (ctx: Context, config?: unknown) => unknown;
  const adapter = function (ctx: Context, config?: unknown): unknown {
    return new Constructor(ctx, config);
  } as unknown as Record<PropertyKey, unknown>;
  const source = plugin.apply as unknown as Record<PropertyKey, unknown>;
  for (const name of ["inject", "provide", "immediate", "reusable", "reactive", "fork"]) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (descriptor) Object.defineProperty(adapter, name, descriptor);
  }
  Object.defineProperty(adapter, "name", { value: plugin.name ?? entryName, configurable: true });
  return adapter as unknown as Parameters<Context["plugin"]>[0];
}

function externalDependencies(entry: RendererPluginEntry, entries: readonly RendererPluginEntry[]): string[] {
  const byIdentity = new Map<string, string>();
  for (const candidate of entries) {
    for (const identity of [candidate.id, candidate.name, candidate.moduleId, candidate.moduleId ? `${candidate.moduleId}/client` : undefined]) {
      if (identity) byIdentity.set(identity, candidate.id);
    }
  }
  return (entry.external ?? []).flatMap((dependency) => {
    const id = byIdentity.get(dependency) ?? byIdentity.get(dependency.replace(/\/client$/, ""));
    return id ? [id] : [];
  });
}

export class RendererPluginLoader {
  private readonly context: Context;
  private readonly importer: (name: string) => Promise<unknown>;
  private readonly entryStore = new Map<string, RendererPluginEntry>();
  private readonly cleanup = new Map<string, () => void | Promise<void>>();
  private readonly statuses = new Map<string, RendererPluginStatus>();
  private readonly resolvedInject = new Map<string, string[]>();
  private readonly providedNames = new Map<string, string[]>();
  private readonly groupParents = new Set<string>();
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(context: Context, importer: (name: string) => Promise<unknown> = async (name) => import(/* @vite-ignore */ name)) {
    this.context = context;
    this.importer = importer;
    context.provide("rendererPluginLoader", this);
    // Keep the renderer face aligned with the main Harness loader: client
    // plugins may inject `loader` and subscribe to loader lifecycle events
    // through either `ctx.on(...)` or the explicit event registry.
    context.provide("loader", this);
    const events = context.get("rendererEvents") as RendererEventRegistry | undefined;
    if (events) context.provide("loaderEvents", events);
  }

  /** Load already-materialized plugin objects without resolving their names. */
  async loadPlugins(entries: readonly RendererPluginEntry[], plugins: ReadonlyMap<string, RendererPlugin>): Promise<void> {
    await this.load(entries, plugins);
  }

  /**
   * DeepSeek client-loader compatibility: create one entry from its module
   * name and return the stable entry id. Renderer profiles can still provide
   * explicit ids; dynamic client packages normally only provide `name`.
   */
  async create(options: Omit<RendererPluginEntry, "id"> & { id?: string }): Promise<string> {
    const id = options.id ?? options.name;
    if (!id) throw new Error("renderer-plugin: entry name is required");
    await this.load([{ ...options, id }]);
    return id;
  }

  async load(entries: readonly RendererPluginEntry[], supplied?: ReadonlyMap<string, RendererPlugin>): Promise<void> {
    await this.mutate(() => this.loadInternal(entries, supplied));
  }

  private async loadInternal(entries: readonly RendererPluginEntry[], supplied?: ReadonlyMap<string, RendererPlugin>): Promise<void> {
    const pending = entries.map((entry) => ({ ...entry }));
    const initialIds = new Set(this.entryStore.keys());
    try {
      // Cordis services expose their provided value when the owning context
      // starts. DeepSeek client plugins commonly install SlotRegistry with
      // `ctx.plugin(SlotRegistry)` before handing control to this loader, so
      // start the context before resolving inject dependencies.
      await ensureContextStarted(this.context);
      const modules = new Map<string, RendererPlugin>();
      for (const entry of pending) {
        if (!entry.id || !entry.name || this.entryStore.has(entry.id) || pending.filter((item) => item.id === entry.id).length > 1) {
          throw new Error(`renderer-plugin: invalid or duplicate entry ${entry.id}`);
        }
        this.entryStore.set(entry.id, { ...entry });
        if (entry.disabled) { this.statuses.set(entry.id, { ...entry, state: "disabled" }); continue; }
        const plugin = supplied?.get(entry.id);
        modules.set(entry.id, plugin ?? normalize(await this.importer(entry.name), entry.name));
      }
      const available = new Set<string>();
      // `load()` is also used for incremental discovery after the built-in
      // renderer profile is active. Existing entries must satisfy inject and
      // external edges just like entries loaded in the same batch.
      for (const existing of this.entryStore.values()) {
        if (this.statuses.get(existing.id)?.state !== "loaded") continue;
        available.add(existing.id);
        available.add(existing.name);
        if (existing.moduleId) available.add(existing.moduleId);
        for (const provided of this.providedNames.get(existing.id) ?? []) available.add(provided);
      }
      while (pending.length) {
        const ready = pending.filter((entry) => {
          const plugin = modules.get(entry.id);
          const dependencies = [...dependenciesOf(entry.inject ?? plugin?.inject), ...externalDependencies(entry, [...this.entryStore.values(), ...pending])];
          return entry.disabled || dependencies.every((name) => available.has(name) || this.context.get(name) !== undefined);
        });
        if (!ready.length) throw new Error("renderer-plugin: unresolved inject dependencies");
        for (const entry of ready.sort((left, right) => Number(Boolean(right.immediately)) - Number(Boolean(left.immediately)))) {
          pending.splice(pending.indexOf(entry), 1);
          if (entry.disabled) continue;
          const plugin = modules.get(entry.id)!;
          this.entryStore.set(entry.id, entry);
          await this.start(entry, plugin);
          for (const provided of providesOf(plugin, entry)) available.add(provided);
          if (entry.moduleId) available.add(entry.moduleId);
          if (plugin.name) available.add(plugin.name);
          if (entry.group && entry.children?.length) {
            await this.loadGroupChildren(entry, entry.children);
          }
          if (entry.group) this.groupParents.add(entry.id);
        }
      }
    } catch (error) {
      const addedIds = [...this.entryStore.keys()].filter((id) => !initialIds.has(id)).reverse();
      const cleanupErrors: unknown[] = [];
      for (const id of addedIds) {
        try { await this.removeInternal(id); } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], "renderer-plugin: load rollback failed");
      }
      throw error;
    }
  }

  async loadProfile(profile: RendererPluginProfile): Promise<void> {
    await this.mutate(async () => {
      if (!profile.patches?.length) {
        await this.reconcile(profile.entries);
        return;
      }
      const { composePluginPatches } = await import("@openbuddy/plugin-host/renderer-patch");
      const composed = composePluginPatches(profile.entries, profile.patches as never[][]);
      await this.reconcile(composed.map((entry) => ({
      id: entry.id,
      moduleId: entry.moduleId,
      name: entry.name,
      config: entry.config,
      inject: entry.inject,
      external: entry.external,
      immediately: entry.immediately,
      disabled: entry.disabled,
      group: entry.group,
      children: entry.children as readonly RendererPluginEntry[] | undefined,
      })));
    });
  }

  /**
   * Load a deepseek-harness `cordis.patch.yml` (or any fragment with the
   * same shape) into this renderer loader. `!!js` expressions inside
   * `config:` are evaluated against `scope` — pass `{ dshHomePath, ... }`
   * to reproduce the deepseek-harness runtime helpers. Mirrors
   * `HarnessPluginLoader.loadCordisPatch` on the main side so the same
   * patch file can drive both halves of an OpenBuddy plugin bundle.
   */
  async loadCordisPatch(source: string, scope: Record<string, unknown> = {}): Promise<void> {
    await this.mutate(async () => {
      const { composePluginPatches, parseCordisPatch, patchRowsToOpenBuddy } = await import("@openbuddy/plugin-host/renderer-patch");
      const parsed = parseCordisPatch(source);
      const expressionScope = { ...scope, ctx: this.context };
      const layers = parsed.layers.map((layer) => patchRowsToOpenBuddy(layer.rows, expressionScope));
      // Compose patches over the currently loaded top-level tree. DeepSeek
      // Harness patch rows address existing entries by id; composing against
      // an empty base would silently turn an update into a new `{ id, name:
      // id }` entry and lose the loaded module/config.
      const current = [...this.entryStore.values()].filter((entry) => !entry.id.includes(":"));
      const composed = composePluginPatches(current, layers as never[][]);
      const entries: RendererPluginEntry[] = composed.map((entry) => ({
        id: entry.id,
        moduleId: entry.moduleId,
        name: entry.name,
        config: entry.config,
        inject: entry.inject,
        external: entry.external,
        immediately: entry.immediately,
        disabled: entry.disabled,
        group: entry.group,
        children: entry.children as readonly RendererPluginEntry[] | undefined,
      }));
      await this.reconcile(entries);
    });
  }

  private async reconcile(desired: readonly RendererPluginEntry[]): Promise<void> {
    if (!this.entryStore.size) {
      await this.loadInternal(desired);
      return;
    }
    const current = [...this.entryStore.values()].filter((entry) => !entry.id.includes(":"));
    const currentById = new Map(current.map((entry) => [entry.id, entry]));
    const desiredById = new Map(desired.map((entry) => [entry.id, entry]));
    const changed = desired.filter((entry) => {
      const previous = currentById.get(entry.id);
      return !previous || JSON.stringify(previous) !== JSON.stringify(entry);
    }).map((entry) => entry.id);
    const removed = current.filter((entry) => !desiredById.has(entry.id)).map((entry) => entry.id);
    const affectedSet = new Set([...changed, ...removed]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const entry of desired) {
        if (affectedSet.has(entry.id)) continue;
        const dependencies = dependenciesOf(entry.inject ?? this.resolvedInject.get(entry.id) ?? []);
        const external = externalDependencies(entry, desired);
        if ([...dependencies, ...external].some((dependency) => affectedSet.has(dependency))) {
          affectedSet.add(entry.id);
          expanded = true;
        }
      }
    }
    const affected = [...affectedSet];
    if (!affected.length) return;
    for (const id of affected) if (this.entryStore.has(id)) await this.removeInternal(id);
    try {
      await this.loadInternal(desired.filter((entry) => affected.includes(entry.id)));
    } catch (error) {
      for (const id of affected) if (this.entryStore.has(id)) await this.removeInternal(id);
      const rollback = current.filter((entry) => affected.includes(entry.id));
      if (rollback.length) await this.loadInternal(rollback);
      throw error;
    }
  }

  private async loadGroupChildren(parent: RendererPluginEntry, children: readonly RendererPluginEntry[]): Promise<void> {
    const prefix = `${parent.id}:`;
    const entries = children.map((child) => ({
      ...child,
      id: `${prefix}${child.id}`,
      inject: Array.isArray(child.inject)
        ? child.inject.map((dependency) => dependency.includes(":") ? dependency : `${parent.id}:${dependency}`)
        : child.inject,
    }));
    await this.loadInternal(entries);
  }

  list(): RendererPluginStatus[] { return [...this.statuses.values()].map((status) => ({ ...status })); }

  entries(): IterableIterator<RendererPluginEntryInfo> {
    const snapshot = [...this.entryStore.keys()].map((id) => {
      const options = this.entryStore.get(id)!;
      const status = this.statuses.get(id)!;
      const fiber: RendererPluginFiberInfo | undefined = status.state === "loaded" || status.state === "pending"
        ? {
            state: status.state,
            ctx: this.context,
            inject: Object.fromEntries(dependenciesOf(options.inject ?? [] as RendererPlugin["inject"]).map((name) => [name, this.context.get(name)])),
            await: async () => { await this.context.events.flush(); },
            dispose: async () => { await this.remove(id); },
          }
        : undefined;
      return { id, options: { ...options }, status: { ...status }, ...(fiber ? { fiber } : {}) };
    });
    return snapshot[Symbol.iterator]();
  }

  resolve(id: string): RendererPluginEntryInfo {
    const options = this.entryStore.get(id);
    const status = this.statuses.get(id);
    if (!options || !status) throw new Error(`renderer-plugin: unknown plugin ${id}`);
    const fiber = [...this.entries()].find((entry) => entry.id === id)?.fiber;
    return { id, options: { ...options }, status: { ...status }, ...(fiber ? { fiber } : {}) };
  }

  listGroup(groupId: string): RendererPluginStatus[] {
    const prefix = `${groupId}:`;
    return this.list().filter((status) => status.id.startsWith(prefix));
  }

  listGroups(): string[] {
    const groups = new Set(this.groupParents);
    for (const id of this.statuses.keys()) {
      const separator = id.indexOf(":");
      if (separator > 0) groups.add(id.slice(0, separator));
    }
    return [...groups];
  }

  async update(id: string, patch: Partial<Omit<RendererPluginEntry, "id">>): Promise<void> {
    await this.mutate(() => this.updateInternal(id, patch));
  }

  private async updateInternal(id: string, patch: Partial<Omit<RendererPluginEntry, "id">>): Promise<void> {
    const previous = this.entryStore.get(id);
    if (!previous) throw new Error(`renderer-plugin: unknown plugin ${id}`);
    const next = { ...previous, ...patch };
    const childIds = [...this.entryStore.keys()].filter((entryId) => entryId.startsWith(`${id}:`));
    for (const childId of childIds.reverse()) await this.removeInternal(childId);
    await this.stop(id);
    this.entryStore.set(id, next);
    try {
      await this.start(next);
      if (next.group) {
        this.groupParents.add(id);
        if (next.children?.length) await this.loadGroupChildren(next, next.children);
      }
    } catch (error) {
      this.entryStore.set(id, previous);
      await this.start(previous);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    await this.mutate(() => this.removeInternal(id));
  }

  private async removeInternal(id: string): Promise<void> {
    const childIds = [...this.entryStore.keys()].filter((entryId) => entryId.startsWith(`${id}:`));
    for (const childId of childIds.reverse()) await this.removeInternal(childId);
    await this.stop(id);
    this.entryStore.delete(id);
    this.resolvedInject.delete(id);
    this.providedNames.delete(id);
    this.statuses.delete(id);
    this.groupParents.delete(id);
  }

  async dispose(): Promise<void> {
    await this.mutate(async () => {
      for (const id of [...this.entryStore.keys()].reverse()) await this.removeInternal(id);
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.then(operation, operation);
    this.mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private emit(type: string, payload: unknown): void {
    const bus = this.tryGetBus();
    if (!bus) return;
    try { this.context.events.emit(type, payload); } catch { /* isolate context listeners */ }
    try { bus.emit(type, payload); } catch { /* renderer plugin listeners are isolated */ }
  }

  private tryGetBus(): RendererEventRegistry | null {
    try { return this.context.get("rendererEvents") as RendererEventRegistry; }
    catch { return null; }
  }

  private async start(entry: RendererPluginEntry, imported?: RendererPlugin): Promise<void> {
    if (entry.disabled) {
      this.statuses.set(entry.id, { ...entry, state: "disabled" });
      this.emit("loader/entry-init", { id: entry.id, name: entry.name, disabled: true });
      this.emit("plugin/loaded", { id: entry.id, name: entry.name });
      return;
    }
    this.statuses.set(entry.id, { ...entry, state: "pending" });
    this.emit("loader/entry-init", { id: entry.id, name: entry.name, options: { ...entry } });
    let disposeFailedScope: (() => Promise<void>) | undefined;
    try {
      const plugin = imported ?? normalize(await this.importer(entry.name), entry.name);
      // Mirror main-side: class plugins must be invoked with `new` because
      // their `apply` slot holds a constructor (deepseek-harness `Service`
      // subclass convention). Function plugins keep the plain-call path.
      const isClass = typeof (plugin as { _kind?: string })._kind === "string"
        || isClassPlugin(plugin.apply);
      await ensureContextStarted(this.context);
      let applyError: unknown;
      let applyPromise: Promise<void> | undefined;
      let cleanupPromise: Promise<void> = Promise.resolve();
      let cleanupStarted = false;
      const harness = isClass
        ? classPluginAdapter(plugin, entry.name)
        : {
            name: plugin.name ?? entry.name,
            inject: contextInject(this.context, plugin.inject ?? entry.inject ?? []),
            provide: plugin.provide ?? entry.id,
            reusable: false,
            apply: (ctx: Context, config?: unknown) => {
              applyPromise = Promise.resolve()
                .then(() => plugin.apply(ctx, config))
                .then((result) => {
                  if (result && typeof result === "object" && "ctx" in result && typeof (result as { name?: unknown }).name === "string") {
                    const serviceName = (result as { name: string }).name;
                    if (ctx.get(serviceName) === undefined) ctx.set(serviceName, result);
                  }
                  if (typeof result === "function") {
                    const runCleanup = async (): Promise<void> => {
                      if (cleanupStarted) return cleanupPromise;
                      cleanupStarted = true;
                      cleanupPromise = Promise.resolve(result()).then(() => undefined);
                      await cleanupPromise;
                    };
                    ctx.effect(() => () => runCleanup());
                  }
                  for (const provided of providesOf(plugin, entry)) {
                    if (ctx.get(provided) === undefined) ctx.set(provided, true);
                  }
                })
                .catch((error) => {
                  applyError = error;
                });
              return applyPromise;
            },
          };
      const scope = this.context.plugin(harness as Parameters<Context["plugin"]>[0], entry.config);
      disposeFailedScope = async () => {
        scope.dispose();
        await cleanupPromise;
      };
      await this.context.events.flush();
      if (!isClass) {
        await applyPromise;
        if (applyError !== undefined) throw applyError;
      }
      const instance = isClass
        ? (scope as unknown as { value?: unknown; runtime?: { value?: unknown } }).runtime?.value
          ?? (scope as unknown as { value?: unknown }).value
        : undefined;
      const disposer = async () => {
        await disposeFailedScope?.();
        if (isClass && instance && typeof (instance as { dispose?: unknown }).dispose === "function") {
          await (instance as { dispose: () => void | Promise<void> }).dispose();
        }
      };
      this.cleanup.set(entry.id, disposer);
      this.resolvedInject.set(entry.id, dependenciesOf(entry.inject ?? plugin.inject));
      this.providedNames.set(entry.id, providesOf(plugin, entry));
      this.statuses.set(entry.id, { ...entry, state: "loaded" });
      this.emit("plugin/loaded", { id: entry.id, name: entry.name });
      this.emit("loader/patch-context", { id: entry.id, name: entry.name, config: entry.config });
    } catch (error) {
      try {
        await disposeFailedScope?.();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `renderer-plugin: failed to clean up ${entry.id}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.statuses.set(entry.id, { ...entry, state: "failed", error: message });
      this.emit("plugin/failed", { id: entry.id, name: entry.name, error: message });
      this.emit("loader/partial-dispose", { id: entry.id, name: entry.name, error: message });
      throw error;
    }
  }

  private async stop(id: string): Promise<void> {
    const disposer = this.cleanup.get(id); if (!disposer) return;
    this.cleanup.delete(id); await disposer();
    const entry = this.entryStore.get(id);
    if (entry) {
      this.statuses.set(id, { ...entry, state: "unloaded" });
      this.emit("plugin/unloaded", { id, name: entry.name });
      this.emit("loader/partial-dispose", { id, name: entry.name });
    }
  }
}

/**
 * Mirror of the main-side `isClassPlugin` heuristic: a function (class)
 * whose static shape declares `inject` or `Config` is a deepseek-harness
 * `Service` subclass — the loader should invoke it with `new`, not as a
 * plain function. Renderer plugin instances are not full Cordis
 * Services (the renderer runs in the browser without a service
 * registry), so we still normalize them to the `{ apply }` shape but
 * annotate the result with `_kind: "class"` so `start()` knows to
 * invoke with `new`.
 */
function isClassPlugin(candidate: unknown): boolean {
  if (typeof candidate !== "function") return false;
  if (/^class\s/.test(Function.prototype.toString.call(candidate))) return true;
  const ctor = candidate as { inject?: unknown; Config?: unknown };
  if (Array.isArray(ctor.inject)) return true;
  if (ctor.Config !== undefined && ctor.Config !== null) return true;
  return false;
}

function normalize(module: unknown, name: string): RendererPlugin {
  const candidate = module && typeof module === "object" && "apply" in module ? module : (module as { default?: unknown })?.default ?? module;
  if (isClassPlugin(candidate)) {
    const constructor = candidate as {
      name?: string;
      inject?: RendererPlugin["inject"];
      provide?: RendererPlugin["provide"];
      Config?: unknown;
    };
    return {
      name: constructor.name ?? name,
      inject: constructor.inject,
      provide: constructor.provide,
      apply: candidate as unknown as RendererPlugin["apply"],
    } as RendererPlugin;
  }
  if (!candidate || typeof candidate !== "object" || typeof (candidate as RendererPlugin).apply !== "function") throw new Error(`renderer-plugin: ${name} does not export apply`);
  const object = candidate as RendererPlugin;
  if (isClassPlugin(object.apply)) {
    const constructor = object.apply as unknown as {
      name?: string;
      inject?: RendererPlugin["inject"];
      provide?: RendererPlugin["provide"];
    };
    return {
      name: object.name ?? constructor.name ?? name,
      inject: object.inject ?? constructor.inject,
      provide: object.provide ?? constructor.provide,
      apply: object.apply,
    };
  }
  return object;
}

export async function loadRendererPlugin(context: Context, plugin: RendererPlugin, config?: unknown): Promise<() => Promise<void>> {
  const loader = new RendererPluginLoader(context, async () => plugin);
  await loader.load([{ id: plugin.id ?? plugin.name ?? "renderer-plugin", name: plugin.name ?? "renderer-plugin", config }]);
  return () => loader.dispose();
}

export type RendererPluginScope = Record<string, unknown>;
