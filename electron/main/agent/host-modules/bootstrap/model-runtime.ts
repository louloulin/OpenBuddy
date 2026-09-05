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

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

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
 * Read auth.json and call `runtime.setRuntimeApiKey` for each API-key
 * credential. Mirrors the original agent-host.ts:syncAuthCredentials impl.
 */
async function syncAuthCredentials(runtime: ModelRuntime): Promise<void> {
  const authPath = join(piHome(), "auth.json");
  let entries: Record<string, unknown> = {};
  try {
    entries = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    // No auth file yet — first-launch case.
  }
  for (const [providerId, credential] of Object.entries(entries)) {
    const value = credential as { type?: string; key?: string };
    if (value?.type === "api_key" && typeof value.key === "string" && value.key.length > 0) {
      try {
        await runtime.setRuntimeApiKey(providerId, value.key);
      } catch (error) {
        console.error(`[openbuddy] failed to sync credential for ${providerId}`, error);
      }
    }
  }
}
