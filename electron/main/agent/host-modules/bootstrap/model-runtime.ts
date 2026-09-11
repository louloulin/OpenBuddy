/**
 * host-modules/bootstrap/model-runtime.ts — ModelRuntime + auth sync bootstrap.
 *
 * Phase 8.3 Batch L2 + Architectural Refactor (DI).
 *
 * 设计:
 *   - **零反向依赖**: 不 import agent-host. 通过参数注入 state.
 *   - 单职责: 创建 ModelRuntime + 同步 BYOK 凭据 + 清空 provider registry.
 *   - 注意: provider-registry tracker 的安装由调用方负责, 因为该 tracker
 *     需要 emitPluginEvent, 后者本身是 agent-host.ts 的导出. 这样本模块
 *     可以保持零反向依赖.
 *
 * 依赖方向 (修复后):
 *   bootstrap/model-runtime.ts  ←  ModelRuntime + _state-shape + _host-paths
 *       ↑
 *   agent-host.ts:initialize()
 *
 * 反向依赖 (修复前):
 *   bootstrap/model-runtime.ts → agent-host.ts ❌
 *
 * 反向依赖 (修复后):
 *   (none)
 */

import { join } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  syncRuntimeCredentials,
  type CredentialSyncResult,
} from "@openbuddy/plugin-host/pi-auth";

import { type AgentHostState } from "../_state-shape";
import { piHome } from "../_host-paths";

/**
 * Create ModelRuntime, hydrate BYOK credentials, and clear the provider
 * registry so the tracker can re-populate it on next registration.
 *
 * Side effects on `state`:
 *   - state.modelRuntime               — fresh ModelRuntime backed by piHome
 *   - state.providerRegistry           — cleared; tracker (installed by caller)
 *                                        will re-populate as extensions fire
 *
 * NOTE: The provider-registry tracker is NOT installed here. The caller
 * (agent-host.ts:initialize) installs it after this returns because the
 * tracker needs `emitPluginEvent`, which is owned by agent-host.ts. This
 * keeps bootstrap/model-runtime.ts free of agent-host imports.
 *
 * @param state - the host state singleton (DI)
 * @returns the created ModelRuntime so callers can chain model-related work.
 */
export async function bootstrapModelRuntime(
  state: AgentHostState,
): Promise<ModelRuntime> {
  const modelRuntime = await ModelRuntime.create({
    authPath: join(piHome(), "auth.json"),
    modelsPath: join(piHome(), "models.json"),
    refreshOnCreate: false,
  });
  state.modelRuntime = modelRuntime;

  // Populate the runtime's configuredProviders Set from any pre-existing
  // credentials persisted in auth.json. Without this, `hasConfiguredAuth`
  // returns false at startup even when the user previously saved a BYOK key,
  // so the composer stays disabled and `agent:auth-status.ready` is wrong.
  await syncAuthCredentials(modelRuntime);

  // Reset Pi-extension provider attribution on every initialize(). Built-in /
  // user-config providers are re-discovered by `providerCatalog()` from the
  // runtime + models.json, so we only need to clear the attribution map; the
  // tracker (installed by caller) will re-populate it as extensions fire.
  state.providerRegistry.clear();

  return modelRuntime;
}

/**
 * Hydrate the runtime from auth.json (R39 — G15 pi-native path).
 *
 * Delegates to `@openbuddy/plugin-host/pi-auth`'s `syncRuntimeCredentials`,
 * which reads each provider's credential through pi's own
 * `readStoredCredential` (BOM strip + path normalization + "missing file
 * ⇒ undefined") and classifies failures through pi's
 * `CredentialSynchronizationError` instead of an opaque `unknown`.
 *
 * Behaviourally identical to the previous hand-rolled loop — every
 * `type: "api_key"` credential is pushed into `setRuntimeApiKey`, a
 * missing auth.json stays a no-op, and one bad provider never aborts
 * the rest — but the credential shape is now pi's decision, not ours.
 */
async function syncAuthCredentials(runtime: ModelRuntime): Promise<void> {
  const results = await syncRuntimeCredentials(runtime, join(piHome(), "auth.json"), {
    onError: (providerId, error, operation) => {
      console.error(
        `[openbuddy] failed to sync credential for ${providerId}` +
          (operation ? ` (operation=${operation})` : ""),
        error,
      );
    },
  });
  reportCredentialSyncOutcome(results);
}

/**
 * Surface a partially-hydrated runtime in the log. A provider that
 * failed to sync keeps `hasConfiguredAuth` false for that provider, so
 * the composer stays disabled with no other signal — this line is what
 * makes that state diagnosable.
 */
function reportCredentialSyncOutcome(results: readonly CredentialSyncResult[]): void {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return;
  console.warn(
    `[openbuddy] ${failed.length}/${results.length} provider credential(s) failed to hydrate: ` +
      failed.map((result) => result.providerId).join(", "),
  );
}
