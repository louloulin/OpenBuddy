import { createGenerationGate, type GenerationGate } from "./generation-gate";
import { findCapabilityOwnershipConflicts, type ActiveCapabilityBackend } from "./capability-ownership";

export const pluginRegistrySchema = "openbuddy.plugin.v1" as const;
export const pluginRegistrySurfaces = ["pi", "cordis", "bundle", "renderer", "remote", "typert", "skills", "prompts"] as const;
export type PluginRegistrySurface = (typeof pluginRegistrySurfaces)[number];
export type PluginRegistryState = "staged" | "active" | "disabled" | "failed" | "disposed";

export interface PluginRegistryManifest {
  schema: typeof pluginRegistrySchema;
  id: string;
  version: string;
  apiVersion: string;
  surfaces: readonly PluginRegistrySurface[];
  dependencies?: readonly { id: string; range: string; optional?: boolean }[];
  permissions?: readonly string[];
  entrypoints?: Readonly<Record<string, string>>;
}

export interface PluginRegistryEntry {
  manifest: PluginRegistryManifest;
  state: PluginRegistryState;
  generation: number;
  error?: string;
}

export interface PluginRegistryTransaction {
  id: string;
  kind: "register" | "activate" | "disable" | "dispose";
  pluginId: string;
  generation: number;
  status: "committed" | "rolled_back";
  error?: string;
}

export class PluginRegistryError extends Error {
  readonly code = "plugin_registry_rejected" as const;
  constructor(readonly reason: string) {
    super(`plugin registry rejected: ${reason}`);
    this.name = "PluginRegistryError";
  }
}

function assertManifest(manifest: PluginRegistryManifest): void {
  if (manifest.schema !== pluginRegistrySchema) throw new PluginRegistryError("unsupported manifest schema");
  for (const [name, value] of [["id", manifest.id], ["version", manifest.version], ["apiVersion", manifest.apiVersion]] as const) {
    if (typeof value !== "string" || !value.trim()) throw new PluginRegistryError(`${name} is required`);
  }
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length === 0) {
    throw new PluginRegistryError("at least one surface is required");
  }
  if (manifest.surfaces.some((surface) => !pluginRegistrySurfaces.includes(surface))) {
    throw new PluginRegistryError("manifest contains an unknown surface");
  }
  if (new Set(manifest.surfaces).size !== manifest.surfaces.length) {
    throw new PluginRegistryError("manifest contains duplicate surfaces");
  }
  for (const dependency of manifest.dependencies ?? []) {
    if (!dependency.id?.trim() || !dependency.range?.trim()) throw new PluginRegistryError("dependency id and range are required");
    if (dependency.id === manifest.id) throw new PluginRegistryError("plugin cannot depend on itself");
  }
}

export interface PluginRegistryOptions {
  generation?: number;
  transactionId?: () => string;
}

/**
 * Small, in-memory governance registry. Runtime-specific loaders remain
 * adapters: this class owns identity, state, generation and transaction
 * outcomes, not Pi/Cordis renderer lifecycle details.
 */
export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>();
  private readonly gate: GenerationGate;
  private readonly nextTransactionId: () => string;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(options: PluginRegistryOptions = {}) {
    this.gate = createGenerationGate(options.generation ?? 0);
    this.nextTransactionId = options.transactionId ?? (() => `plugin-tx-${this.gate.current()}-${Date.now()}`);
  }

  get generation(): number { return this.gate.current(); }

  list(): readonly PluginRegistryEntry[] { return [...this.entries.values()].map((entry) => ({ ...entry, manifest: { ...entry.manifest } })); }

  get(pluginId: string): PluginRegistryEntry | undefined {
    const entry = this.entries.get(pluginId);
    return entry ? { ...entry, manifest: { ...entry.manifest } } : undefined;
  }

  register(manifest: PluginRegistryManifest): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      assertManifest(manifest);
      if (this.entries.has(manifest.id)) throw new PluginRegistryError(`plugin ${manifest.id} is already registered`);
      this.assertDependencies(manifest);
      const generation = this.gate.advance();
      this.entries.set(manifest.id, { manifest: { ...manifest, surfaces: [...manifest.surfaces] }, state: "staged", generation });
      return this.transaction("register", manifest.id, generation);
    });
  }

  activate(pluginId: string): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      if (entry.state === "active") return this.transaction("activate", pluginId, entry.generation);
      this.assertDependencies(entry.manifest);
      this.assertCapabilityConflicts(pluginId);
      const generation = this.gate.advance();
      entry.state = "active";
      entry.generation = generation;
      delete entry.error;
      return this.transaction("activate", pluginId, generation);
    });
  }

  disable(pluginId: string): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      const generation = this.gate.advance();
      entry.state = "disabled";
      entry.generation = generation;
      return this.transaction("disable", pluginId, generation);
    });
  }

  dispose(pluginId: string): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      const generation = this.gate.advance();
      entry.state = "disposed";
      entry.generation = generation;
      return this.transaction("dispose", pluginId, generation);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private require(pluginId: string): PluginRegistryEntry {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new PluginRegistryError(`plugin ${pluginId} is not registered`);
    return entry;
  }

  private assertDependencies(manifest: PluginRegistryManifest): void {
    for (const dependency of manifest.dependencies ?? []) {
      const entry = this.entries.get(dependency.id);
      if (!entry || (entry.state !== "active" && !dependency.optional)) {
        throw new PluginRegistryError(`dependency ${dependency.id} is not active`);
      }
    }
  }

  private assertCapabilityConflicts(pluginId: string): void {
    const backends: ActiveCapabilityBackend[] = [];
    for (const entry of this.entries.values()) {
      if (entry.state !== "active" && entry.manifest.id !== pluginId) continue;
      for (const surface of entry.manifest.surfaces) {
        backends.push({ capability: surface, backendId: entry.manifest.id, pluginId: entry.manifest.id });
      }
    }
    const conflicts = findCapabilityOwnershipConflicts(backends);
    if (conflicts.length > 0) throw new PluginRegistryError(`active surface conflict: ${conflicts[0].capability}`);
  }

  private transaction(kind: PluginRegistryTransaction["kind"], pluginId: string, generation: number): PluginRegistryTransaction {
    return { id: this.nextTransactionId(), kind, pluginId, generation, status: "committed" };
  }
}
