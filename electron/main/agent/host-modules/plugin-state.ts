/**
 * host-modules/plugin-state.ts — plugin state READ surface.
 *
 * Phase 8.3 Batch D (D2): 从 agent-host.ts 抽出 plugin state IPC 的 **read**
 * 路径 (4 个函数, ~70 行):
 *   - pluginSnapshot (line 4399) — createPluginSnapshot({...}) assembly
 *   - pluginEvents (line 4427) — state.sessionEventLog.snapshot() filter
 *   - reportActivePluginTransaction (line 4860) — already export; wrapper
 *   - listActivePluginTransactions (line 4877) — already export; wrapper
 *
 * 设计:
 *   - state / createPluginSnapshot / pluginReadinessSnapshot /
 *     getActiveHarnessServer / profilePackages 全部通过环形 import 自
 *     ../agent-host 注入
 *   - **listPlugins** (line 4338, 1 line) 太琐碎不抽; 它已经是 0-arg body
 *   - **写路径** (setPluginEnabled / reloadPlugin / reloadPiExtensions /
 *     updatePluginConfig / resetPluginState / refreshStoredPluginLayers /
 *     setPluginEnabledInternal / reloadPluginInternal /
 *     reloadPiExtensionsInternal / installProfileBundle /
 *     removeProfileBundle / listPluginInventory / updatePluginConfig)
 *     留在 agent-host.ts — entwined with state.pluginState / piResources /
 *     piRuntimeCoordinator / configurePiExtensions 这些 module-level
 *     singletons, 抽离需要先迁移 initialize() 主流程
 */
// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { state, profilePackages, pluginReadinessSnapshot } from "../agent-host"` (reverse dep)
//   修复后: 通过 installPluginState() 一次性注入, 本模块零 agent-host 导入.
//   注意: pluginReadinessSnapshot 现在通过 ./plugin-event-bus 的 module-level
//   binding (它已迁移到 install pattern), 所以这里也指向 ./plugin-event-bus.
import { pluginReadinessSnapshot } from "./plugin-event-bus";
import { type AgentHostState } from "./_state-shape";
type SessionEventRecord = any;
import { createDefaultAgentHostState } from "./_default-state";
// Phase 8.3 post-init runtime fix: pluginSnapshot() reads from the live
// harness server; after the Phase 8.3 split, the bare-name channel from
// ../agent-host stopped working for this module. Import the symbol
// directly from its source-of-truth (harness-server.ts).
import { getActiveHarnessServer } from "../../harness/harness-server";
import { createPluginSnapshot, type PluginSnapshot, type PluginSnapshotPackageInput } from "@openbuddy/plugin-host";

let state: AgentHostState = createDefaultAgentHostState();
let profilePackages: () => Promise<unknown[]>;

/**
 * Bind plugin-state dependencies. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installPluginState(deps: {
  state: AgentHostState;
  profilePackages: () => Promise<unknown[]>;
}): void {
  state = deps.state;
  profilePackages = deps.profilePackages as () => Promise<unknown[]>;
}

async function pluginSnapshot(): Promise<PluginSnapshot> {
  const recovery = getActiveHarnessServer()?.recoveryStatus() ?? { pending: 0, uncertain: 0, byMethod: {} };
  const packages = state.profileOptions ? await profilePackages() : [];
  return createPluginSnapshot({
    generation: state.pluginReadiness.generation,
    commit: {
      generation: state.pluginCommitGeneration,
      ...(state.lastPluginCommitTransactionId ? { transactionId: state.lastPluginCommitTransactionId } : {}),
      ...(state.lastPluginCommitMarker?.kind ? { kind: state.lastPluginCommitMarker.kind } : {}),
      ...(state.lastPluginCommitMarker?.target ? { target: state.lastPluginCommitMarker.target } : {}),
      ...(state.lastPluginCommitMarker?.committedAt ? { committedAt: state.lastPluginCommitMarker.committedAt } : {}),
      ...(state.lastPluginCommitMarker?.rolledBack ? { rolledBack: true } : {}),
      ...(state.lastPluginCommitMarker?.receipts ? { receipts: state.lastPluginCommitMarker.receipts } : {}),
    },
    readiness: pluginReadinessSnapshot(),
    recovery,
    packages: (packages as any[]).map((entry: any) => {
      return {
        name: entry.name,
        ...(entry.version ? { version: entry.version } : {}),
        expected: (entry as any).manifest.surfaces.map((surface: any) => surface.kind),
        loaded: entry.manifest.loaded,
        ...(entry.manifest.health === "degraded" ? { health: "degraded" as const } : {}),
      };
    }),
  });
}

function pluginEvents(query?: { sessionId?: string; sinceSequence?: number; limit?: number }): SessionEventRecord[] {
  return state.sessionEventLog?.snapshot(query) ?? [];
}

function reportActivePluginTransaction(
  transactionId: string,
  surface: string,
  details?: Record<string, unknown>,
): { ok: true; transactionId: string; surface: string } | { ok: false; error: string } {
  const trimmedSurface = surface.trim();
  if (!trimmedSurface) return { ok: false, error: "surface is required" };
  const transaction = state.activePluginTransactions.get(transactionId);
  if (!transaction) return { ok: false, error: `unknown transaction: ${transactionId}` };
  try {
    transaction.receipt(trimmedSurface, details);
    return { ok: true, transactionId, surface: trimmedSurface };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function listActivePluginTransactions(): Array<{ transactionId: string; kind: string; target: string; requiredReceipts: readonly string[] }> {
  return Array.from(state.activePluginTransactions.values()).map((transaction) => ({
    transactionId: transaction.transactionId,
    kind: transaction.kind,
    target: transaction.target,
    requiredReceipts: transaction.requiredReceipts,
  }));
}

export {
  pluginSnapshot,
  pluginEvents,
  reportActivePluginTransaction,
  listActivePluginTransactions,
};