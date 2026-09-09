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
  /** Canonical capabilities backed by this plugin. Surfaces are transport/runtime
   * boundaries and may be shared by many plugins; capabilities are exclusive. */
  capabilities?: readonly string[];
  source?: string;
  managed?: boolean;
  disabledReason?: "user" | "policy" | "load-failed" | "dependency-failed";
  health?: "healthy" | "degraded" | "failed";
  dependencies?: readonly { id: string; range: string; optional?: boolean }[];
  permissions?: readonly string[];
  entrypoints?: Readonly<Record<string, string>>;
}

export interface PluginRegistryInventoryEntry {
  id: string;
  version: string;
  source?: string;
  managed: boolean;
  state: PluginRegistryState;
  health: "healthy" | "degraded" | "failed";
  disabledReason?: PluginRegistryManifest["disabledReason"];
  surfaces: readonly PluginRegistrySurface[];
}

export interface PluginRegistryEvent {
  kind: PluginRegistryTransaction["kind"];
  pluginId: string;
  generation: number;
  transactionId: string;
  state: PluginRegistryState;
}

export interface PluginRegistryEntry {
  manifest: PluginRegistryManifest;
  state: PluginRegistryState;
  generation: number;
  error?: string;
}

export interface PluginRegistryTransaction {
  id: string;
  kind: "register" | "activate" | "disable" | "fail" | "dispose";
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
  if (!manifest || typeof manifest !== "object") throw new PluginRegistryError("manifest must be an object");
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
  if (manifest.capabilities !== undefined && (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0 || manifest.capabilities.some((capability) => typeof capability !== "string" || !capability.trim()))) {
    throw new PluginRegistryError("capabilities must be a non-empty string array");
  }
  if (manifest.capabilities && new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    throw new PluginRegistryError("manifest contains duplicate capabilities");
  }
  if (manifest.dependencies !== undefined && !Array.isArray(manifest.dependencies)) {
    throw new PluginRegistryError("dependencies must be an array");
  }
  const dependencyIds = new Set<string>();
  for (const dependency of manifest.dependencies ?? []) {
    if (!dependency || typeof dependency !== "object" || typeof dependency.id !== "string" || typeof dependency.range !== "string" || !dependency.id.trim() || !dependency.range.trim()) {
      throw new PluginRegistryError("dependency id and range are required");
    }
    if (dependency.id === manifest.id) throw new PluginRegistryError("plugin cannot depend on itself");
    if (dependencyIds.has(dependency.id)) throw new PluginRegistryError(`manifest contains duplicate dependency ${dependency.id}`);
    dependencyIds.add(dependency.id);
    if (dependency.optional !== undefined && typeof dependency.optional !== "boolean") {
      throw new PluginRegistryError("dependency optional must be a boolean");
    }
  }
  if (manifest.permissions !== undefined && (!Array.isArray(manifest.permissions) || manifest.permissions.length === 0 || manifest.permissions.some((permission) => typeof permission !== "string" || !permission.trim()))) {
    throw new PluginRegistryError("permissions must be a non-empty string array");
  }
  if (manifest.entrypoints !== undefined && (typeof manifest.entrypoints !== "object" || manifest.entrypoints === null || Array.isArray(manifest.entrypoints) || Object.keys(manifest.entrypoints).length === 0 || Object.entries(manifest.entrypoints).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim()))) {
    throw new PluginRegistryError("entrypoints must be a map of non-empty strings");
  }
}

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * Supports the npm range forms used by OpenBuddy plugin manifests without
 * pulling a runtime dependency into the small registry package.
 */
export function satisfiesPluginDependencyRange(version: string, range: string): boolean {
  const candidate = parseSemanticVersion(version);
  const normalized = range.trim();
  if (!candidate || !normalized) return false;
  if (normalized === "*" || normalized.toLowerCase() === "latest") return true;

  return normalized.split("||").some((alternative) => {
    const expression = alternative.trim();
    if (!expression) return false;
    const comparatorParts = expression.split(/\s+/).filter(Boolean);
    if (comparatorParts.length > 1 && comparatorParts.every((part) => /^(?:[<>]=?|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(part))) {
      return comparatorParts.every((part) => satisfiesPluginDependencyRange(version, part));
    }

    const operatorMatch = /^(\^|~|>=|<=|>|<|=)?\s*(\d+)(?:\.(\d+)(?:\.(\d+))?)?$/.exec(expression);
    if (!operatorMatch) return false;
    const operator = operatorMatch[1] ?? "=";
    const hasMinor = operatorMatch[3] !== undefined;
    const hasPatch = operatorMatch[4] !== undefined;
    const base = {
      major: Number(operatorMatch[2]),
      minor: hasMinor ? Number(operatorMatch[3]) : 0,
      patch: hasPatch ? Number(operatorMatch[4]) : 0,
    };
    if (!hasPatch && (operator === "=" || operator === "~")) {
      const lowerBound = compareSemanticVersions(candidate, base) >= 0;
      const upperBound = hasMinor
        ? candidate.major === base.major && candidate.minor === base.minor
        : candidate.major === base.major;
      return lowerBound && upperBound;
    }
    if (!hasPatch && operator === "^") {
      const upper = hasMinor
        ? { major: base.major > 0 ? base.major + 1 : 0, minor: base.major > 0 ? 0 : base.minor + 1, patch: 0 }
        : { major: base.major + 1, minor: 0, patch: 0 };
      return compareSemanticVersions(candidate, base) >= 0 && compareSemanticVersions(candidate, upper) < 0;
    }
    const comparison = compareSemanticVersions(candidate, base);
    if (operator === "=") return comparison === 0;
    if (operator === ">") return comparison > 0;
    if (operator === ">=") return comparison >= 0;
    if (operator === "<") return comparison < 0;
    if (operator === "<=") return comparison <= 0;
    if (operator === "~") return candidate.major === base.major && candidate.minor === base.minor && comparison >= 0;
    if (operator === "^") {
      const upper = base.major > 0
        ? { major: base.major + 1, minor: 0, patch: 0 }
        : base.minor > 0
          ? { major: 0, minor: base.minor + 1, patch: 0 }
          : { major: 0, minor: 0, patch: base.patch + 1 };
      return comparison >= 0 && compareSemanticVersions(candidate, upper) < 0;
    }
    return false;
  });
}

function cloneManifest(manifest: PluginRegistryManifest): PluginRegistryManifest {
  return {
    ...manifest,
    surfaces: [...manifest.surfaces],
    ...(manifest.capabilities ? { capabilities: [...manifest.capabilities] } : {}),
    ...(manifest.dependencies ? { dependencies: manifest.dependencies.map((dependency) => ({ ...dependency })) } : {}),
    ...(manifest.permissions ? { permissions: [...manifest.permissions] } : {}),
    ...(manifest.entrypoints ? { entrypoints: { ...manifest.entrypoints } } : {}),
  };
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
  private readonly listeners = new Set<(event: PluginRegistryEvent) => void>();
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(options: PluginRegistryOptions = {}) {
    this.gate = createGenerationGate(options.generation ?? 0);
    this.nextTransactionId = options.transactionId ?? (() => `plugin-tx-${this.gate.current()}-${Date.now()}`);
  }

  get generation(): number { return this.gate.current(); }

  list(): readonly PluginRegistryEntry[] { return [...this.entries.values()].map((entry) => ({ ...entry, manifest: cloneManifest(entry.manifest) })); }

  get(pluginId: string): PluginRegistryEntry | undefined {
    const entry = this.entries.get(pluginId);
    return entry ? { ...entry, manifest: cloneManifest(entry.manifest) } : undefined;
  }

  inventory(): readonly PluginRegistryInventoryEntry[] {
    return this.list().map((entry) => ({
      id: entry.manifest.id,
      version: entry.manifest.version,
      ...(entry.manifest.source ? { source: entry.manifest.source } : {}),
      managed: entry.manifest.managed !== false,
      state: entry.state,
      health: entry.manifest.health ?? (entry.state === "failed" ? "failed" : "healthy"),
      ...(entry.manifest.disabledReason ? { disabledReason: entry.manifest.disabledReason } : {}),
      surfaces: [...entry.manifest.surfaces],
    }));
  }

  subscribe(listener: (event: PluginRegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PluginRegistryEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Deliver an externally observed event through the generation fence. */
  publish(event: PluginRegistryEvent): void {
    this.emit({ ...event });
  }


  subscribeCurrent(listener: (event: PluginRegistryEvent) => void): () => void {
    return this.subscribe((event) => {
      if (event.generation === this.generation) listener(event);
    });
  }

  register(manifest: PluginRegistryManifest): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      assertManifest(manifest);
      if (this.entries.has(manifest.id)) throw new PluginRegistryError(`plugin ${manifest.id} is already registered`);
      this.assertDependencies(manifest, false);
      const generation = this.gate.advance();
      this.entries.set(manifest.id, { manifest: cloneManifest(manifest), state: "staged", generation });
      return this.transaction("register", manifest.id, generation);
    });
  }

  activate(pluginId: string): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      if (entry.state === "active") return this.transaction("activate", pluginId, entry.generation);
      this.assertDependencies(entry.manifest, true);
      this.assertCapabilityConflicts(pluginId);
      const generation = this.gate.advance();
      entry.state = "active";
      entry.generation = generation;
      delete entry.error;
      delete entry.manifest.disabledReason;
      return this.transaction("activate", pluginId, generation);
    });
  }

  dependentsOf(pluginId: string): readonly PluginRegistryEntry[] {
    return this.list().filter((entry) => entry.state === "active" && entry.manifest.dependencies?.some((dependency) => dependency.id === pluginId));
  }

  disable(pluginId: string, reason: NonNullable<PluginRegistryManifest["disabledReason"]> = "user"): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      const activeDependents = this.dependentsOf(pluginId);
      if (activeDependents.length > 0) {
        throw new PluginRegistryError(`cannot disable ${pluginId}: active dependents ${activeDependents.map((dependent) => dependent.manifest.id).join(", ")}`);
      }
      const generation = this.gate.advance();
      entry.state = "disabled";
      entry.generation = generation;
      entry.manifest.disabledReason = reason;
      delete entry.error;
      return this.transaction("disable", pluginId, generation);
    });
  }

  fail(pluginId: string, error: unknown): Promise<PluginRegistryTransaction> {
    return this.enqueue(async () => {
      const entry = this.require(pluginId);
      const generation = this.gate.advance();
      entry.state = "failed";
      entry.generation = generation;
      entry.error = error instanceof Error ? error.message : String(error);
      return { ...this.transaction("fail", pluginId, generation), error: entry.error };
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

  private assertDependencies(manifest: PluginRegistryManifest, checkVersion = true): void {
    for (const dependency of manifest.dependencies ?? []) {
      const entry = this.entries.get(dependency.id);
      if (!entry || (entry.state !== "active" && !dependency.optional)) {
        throw new PluginRegistryError(`dependency ${dependency.id} is not active`);
      }
      if (checkVersion && entry && entry.state === "active" && !satisfiesPluginDependencyRange(entry.manifest.version, dependency.range)) {
        throw new PluginRegistryError(`dependency ${dependency.id} version ${entry.manifest.version} does not satisfy ${dependency.range}`);
      }
    }
  }

  private assertCapabilityConflicts(pluginId: string): void {
    const backends: ActiveCapabilityBackend[] = [];
    for (const entry of this.entries.values()) {
      if (entry.state !== "active" && entry.manifest.id !== pluginId) continue;
      for (const capability of entry.manifest.capabilities ?? []) {
        backends.push({ capability, backendId: entry.manifest.id, pluginId: entry.manifest.id });
      }
    }
    const conflicts = findCapabilityOwnershipConflicts(backends);
    if (conflicts.length > 0) throw new PluginRegistryError(`active surface conflict: ${conflicts[0].capability}`);
  }

  private transaction(kind: PluginRegistryTransaction["kind"], pluginId: string, generation: number): PluginRegistryTransaction {
    const transaction = { id: this.nextTransactionId(), kind, pluginId, generation, status: "committed" as const };
    const entry = this.entries.get(pluginId);
    if (entry) this.emit({ kind, pluginId, generation, transactionId: transaction.id, state: entry.state });
    return transaction;
  }
}
