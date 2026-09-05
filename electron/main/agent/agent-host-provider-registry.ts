/**
 * Provider registry attribution tracker.
 *
 * Pi extensions can call `pi.registerProvider(name, config)` at any time to
 * teach the agent about a new LLM backend. The native Pi runtime accepts
 * these calls but loses the originating extension path once the pending
 * queue is drained during `bindExtensions()`. This helper wraps the three
 * provider-registration methods on `ModelRuntime` so OpenBuddy can
 * attribute every provider id back to the Pi extension that registered it.
 *
 * Attribution is preserved across `AgentSession.reload()` because the
 * tracker only records into the host-owned map; the runtime itself is
 * recreated by `initialize()` and re-populated from the pending queue.
 */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type ProviderRegistrySource = "pi-extension" | "user-config" | "builtin";

export interface ProviderRegistryRecord {
  id: string;
  source: ProviderRegistrySource;
  extensionPath?: string;
  registeredAt: number;
}

export interface ProviderRegistryChange {
  id: string;
  source: ProviderRegistrySource;
  extensionPath?: string;
  registeredAt: number;
}

export function installProviderRegistryTracker(
  runtime: ModelRuntime,
  registry: Map<string, ProviderRegistryRecord>,
  onChange?: (event: { kind: "register" | "unregister"; record: ProviderRegistryChange }) => void,
): void {
  const originalRegister = runtime.registerProvider.bind(runtime);
  const originalUnregister = runtime.unregisterProvider.bind(runtime);
  const originalRegisterNative = runtime.registerNativeProvider?.bind(runtime);
  (runtime as unknown as { registerProvider: typeof originalRegister }).registerProvider = ((
    nameOrProvider: string | unknown,
    config?: unknown,
  ): void => {
    const id = typeof nameOrProvider === "string"
      ? nameOrProvider
      : ((nameOrProvider as { id?: string } | undefined)?.id ?? "");
    if (id) {
      const existing = registry.get(id);
      const record: ProviderRegistryRecord = {
        id,
        source: existing?.source ?? "pi-extension",
        registeredAt: Date.now(),
        ...(existing?.extensionPath ? { extensionPath: existing.extensionPath } : {}),
      };
      registry.set(id, record);
      onChange?.({ kind: "register", record });
    }
    if (typeof nameOrProvider === "string") {
      (originalRegister as unknown as (name: string, cfg: unknown) => void)(nameOrProvider, config);
      return;
    }
    (originalRegister as unknown as (provider: unknown) => void)(nameOrProvider);
  }) as typeof originalRegister;
  if (originalRegisterNative) {
    (runtime as unknown as { registerNativeProvider: typeof originalRegisterNative }).registerNativeProvider = ((
      provider: unknown,
    ): void => {
      const id = (provider as { id?: string } | undefined)?.id;
      if (id) {
        const existing = registry.get(id);
        const record: ProviderRegistryRecord = {
          id,
          source: existing?.source ?? "pi-extension",
          registeredAt: Date.now(),
          ...(existing?.extensionPath ? { extensionPath: existing.extensionPath } : {}),
        };
        registry.set(id, record);
        onChange?.({ kind: "register", record });
      }
      (originalRegisterNative as unknown as (provider: unknown) => void)(provider);
    }) as typeof originalRegisterNative;
  }
  (runtime as unknown as { unregisterProvider: (name: string) => void }).unregisterProvider = ((name: string) => {
    const existing = registry.get(name);
    registry.delete(name);
    if (existing) {
      onChange?.({ kind: "unregister", record: { id: existing.id, source: existing.source, registeredAt: existing.registeredAt, ...(existing.extensionPath ? { extensionPath: existing.extensionPath } : {}) } });
    }
    return originalUnregister(name);
  });
}

/**
 * Public payload shape for the agent-host-provider-registry view of the
 * current provider catalog (see UI/Pi-rest inventory consumer).
 *
 * Phase 8.3 Architectural Refactor: 在 agent-host.ts 抽出,避免下游模块
 * (host-modules/plugin-mutations、renderer) 为类型 import 反向依赖 agent-host。
 */
export interface ProviderInventoryEntry {
  id: string;
  source: ProviderRegistrySource;
  extensionPath?: string;
}
