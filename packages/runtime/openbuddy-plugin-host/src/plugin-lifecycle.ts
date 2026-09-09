import type { PluginReadinessSnapshot } from "./readiness";
import { createPluginReadinessSnapshot } from "./readiness";
import {
  PluginRegistry,
  type PluginRegistryEntry,
  type PluginRegistryManifest,
  type PluginRegistryTransaction,
} from "./plugin-registry";

export interface PluginLifecycleAdapter {
  stage?: (manifest: PluginRegistryManifest) => void | Promise<void>;
  activate?: (manifest: PluginRegistryManifest) => void | Promise<void>;
  rollback?: (manifest: PluginRegistryManifest, cause: unknown) => void | Promise<void>;
  dispose?: (manifest: PluginRegistryManifest) => void | Promise<void>;
}

export interface PluginLifecycleDiagnostic {
  pluginId: string;
  phase: "stage" | "activate" | "rollback" | "dispose";
  code: "adapter_failed";
  message: string;
  generation: number;
  transactionId?: string;
}

export interface PluginLifecycleResult {
  transaction: PluginRegistryTransaction;
  diagnostics: readonly PluginLifecycleDiagnostic[];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Coordinates runtime-specific loaders without making them share reload semantics. */
export class PluginLifecycleCoordinator {
  private readonly adapters = new Map<string, PluginLifecycleAdapter>();
  private readonly diagnostics: PluginLifecycleDiagnostic[] = [];
  private readiness: PluginReadinessSnapshot;

  constructor(private readonly registry: PluginRegistry) {
    this.readiness = this.snapshot();
  }

  registerAdapter(pluginId: string, adapter: PluginLifecycleAdapter): void {
    this.adapters.set(pluginId, adapter);
  }

  getDiagnostics(): readonly PluginLifecycleDiagnostic[] {
    return [...this.diagnostics];
  }

  getReadiness(): PluginReadinessSnapshot { return this.readiness; }

  async stage(manifest: PluginRegistryManifest, adapter: PluginLifecycleAdapter = {}): Promise<PluginLifecycleResult> {
    this.registerAdapter(manifest.id, adapter);
    const transaction = await this.registry.register(manifest);
    try {
      await adapter.stage?.(manifest);
      this.refresh();
      return { transaction, diagnostics: this.getDiagnostics() };
    } catch (error) {
      this.record(manifest.id, "stage", error, transaction.id);
      await this.rollback(manifest, error);
      const failed = await this.registry.fail(manifest.id, error);
      this.refresh();
      return { transaction: { ...failed, status: "rolled_back", error: message(error) }, diagnostics: this.getDiagnostics() };
    }
  }

  async activate(pluginId: string): Promise<PluginLifecycleResult> {
    const entry = this.require(pluginId);
    const adapter = this.adapters.get(pluginId) ?? {};
    try {
      await adapter.activate?.(entry.manifest);
      const transaction = await this.registry.activate(pluginId);
      this.refresh();
      return { transaction, diagnostics: this.getDiagnostics() };
    } catch (error) {
      this.record(pluginId, "activate", error);
      await this.rollback(entry.manifest, error);
      this.refresh();
      return {
        transaction: { id: `rollback-${this.registry.generation}`, kind: "activate", pluginId, generation: this.registry.generation, status: "rolled_back", error: message(error) },
        diagnostics: this.getDiagnostics(),
      };
    }
  }

  async disable(pluginId: string): Promise<PluginLifecycleResult> {
    const entry = this.require(pluginId);
    const adapter = this.adapters.get(pluginId) ?? {};
    try {
      await adapter.dispose?.(entry.manifest);
      const transaction = await this.registry.disable(pluginId);
      this.refresh();
      return { transaction, diagnostics: this.getDiagnostics() };
    } catch (error) {
      this.record(pluginId, "dispose", error);
      await this.rollback(entry.manifest, error);
      this.refresh();
      return {
        transaction: { id: `disable-rollback-${this.registry.generation}`, kind: "disable", pluginId, generation: this.registry.generation, status: "rolled_back", error: message(error) },
        diagnostics: this.getDiagnostics(),
      };
    }
  }

  async dispose(pluginId: string): Promise<PluginLifecycleResult> {
    const entry = this.require(pluginId);
    const adapter = this.adapters.get(pluginId) ?? {};
    try {
      await adapter.dispose?.(entry.manifest);
      const transaction = await this.registry.dispose(pluginId);
      this.refresh();
      return { transaction, diagnostics: this.getDiagnostics() };
    } catch (error) {
      this.record(pluginId, "dispose", error);
      this.refresh();
      return { transaction: { id: `failed-${this.registry.generation}`, kind: "dispose", pluginId, generation: this.registry.generation, status: "rolled_back", error: message(error) }, diagnostics: this.getDiagnostics() };
    }
  }

  private async rollback(manifest: PluginRegistryManifest, cause: unknown): Promise<void> {
    const adapter = this.adapters.get(manifest.id);
    try {
      await adapter?.rollback?.(manifest, cause);
    } catch (error) {
      this.record(manifest.id, "rollback", error);
    }
  }

  private record(pluginId: string, phase: PluginLifecycleDiagnostic["phase"], error: unknown, transactionId?: string): void {
    this.diagnostics.push({ pluginId, phase, code: "adapter_failed", message: message(error), generation: this.registry.generation, ...(transactionId ? { transactionId } : {}) });
  }

  private require(pluginId: string): PluginRegistryEntry {
    const entry = this.registry.get(pluginId);
    if (!entry) throw new Error(`plugin ${pluginId} is not registered`);
    return entry;
  }

  private refresh(): void { this.readiness = this.snapshot(); }

  private snapshot(): PluginReadinessSnapshot {
    const entries = this.registry.list();
    return createPluginReadinessSnapshot({
      phase: entries.some((entry) => entry.state === "failed") ? "failed" : entries.length ? "ready" : "idle",
      generation: this.registry.generation,
      main: entries.map((entry) => ({ state: entry.state, health: entry.state === "failed" ? "failed" : undefined })),
      pi: entries.filter((entry) => entry.manifest.surfaces.includes("pi")).map((entry) => ({ state: entry.state })),
      error: this.diagnostics.at(-1)?.message,
    });
  }
}
