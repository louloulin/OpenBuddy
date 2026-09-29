/**
 * agent-secret-store-bridge — SecretStore 双路径适配层 (P2.1-secrets)
 *
 * 与 agent-permission-bridge.ts 同款模式,实现 SecretStore 接口的
 * host-core IPC 优先 + 失败降级:
 *   - put / get / delete 三个方法走 host-core (callSecretsSet/Get/Delete)
 *   - 失败时静默降级到 platform SecretStore (keychain / ephemeral / unsupported)
 *   - 5 秒 backoff:失败后短期不再重试 host-core
 *
 * 集成路径:
 *   1. 在 bootHostCore() 之后调用 attachHostCoreSecretStore(host.inner)
 *   2. 把 createPlatformSecretStore(...) 替换为 createBridgeSecretStore({...})
 *      或直接 new HostCoreSecretStoreBridge(host.inner, fallback)
 *   3. 其它调用点无需修改 —— SecretStore 接口签名不变
 *
 * 单元测试: `electron/main/agent/__tests__/agent-secret-store-bridge.test.ts`
 */

import {
  callSecretsDelete,
  callSecretsGet,
  callSecretsSet,
  type HostProcess,
} from "@openbuddy/host-runtime";
import type { SecretRef, SecretStore } from "@openbuddy/storage";

interface BridgeState {
  host: HostProcess | null;
  available: boolean;
  lastFailureMs: number;
  readonly backoffMs: number;
}

const INITIAL_STATE: BridgeState = {
  host: null,
  available: true,
  lastFailureMs: 0,
  backoffMs: 5_000,
};

let state: BridgeState = { ...INITIAL_STATE };

export function attachHostCoreSecretStore(host: HostProcess | null): void {
  state = {
    ...state,
    host,
    available: host !== null,
    lastFailureMs: 0,
  };
}

export function resetAgentSecretStoreBridge(): void {
  state = { ...INITIAL_STATE };
}

function shouldTryHostCore(): boolean {
  if (!state.host || !state.available) return false;
  const now = Date.now();
  if (state.lastFailureMs > 0 && now - state.lastFailureMs < state.backoffMs) {
    return false;
  }
  return true;
}

function recordHostCoreFailure(err: unknown): void {
  state = { ...state, available: false, lastFailureMs: Date.now() };
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-secret-store-bridge] host-core IPC failed, falling back to platform store:",
    err instanceof Error ? err.message : String(err),
  );
}

function recordHostCoreSuccess(): void {
  if (!state.available || state.lastFailureMs > 0) {
    state = { ...state, available: true, lastFailureMs: 0 };
  }
}

/**
 * Bridge implementation of the `SecretStore` interface.
 *
 * The fallback is **always required** (even when host-core is attached) so that
 * a transient host-core failure does not break the IPC contract — callers will
 * see the same behavior they had before host-core was wired in.
 */
export class HostCoreSecretStoreBridge implements SecretStore {
  constructor(private readonly fallback: SecretStore) {}

  async put(ref: string, value: string, metadata?: { label?: string }): Promise<SecretRef> {
    if (shouldTryHostCore()) {
      try {
        const res = await callSecretsSet(state.host!, {
          ref,
          value,
          label: metadata?.label,
        });
        recordHostCoreSuccess();
        return {
          ref,
          provider: res.backend,
          ...(metadata?.label ? { label: metadata.label } : {}),
        };
      } catch (err) {
        recordHostCoreFailure(err);
      }
    }
    return this.fallback.put(ref, value, metadata);
  }

  async get(ref: string): Promise<string | undefined> {
    if (shouldTryHostCore()) {
      try {
        const res = await callSecretsGet(state.host!, { ref });
        recordHostCoreSuccess();
        return res.value ?? undefined;
      } catch (err) {
        recordHostCoreFailure(err);
      }
    }
    return this.fallback.get(ref);
  }

  async delete(ref: string): Promise<void> {
    if (shouldTryHostCore()) {
      try {
        await callSecretsDelete(state.host!, { ref });
        recordHostCoreSuccess();
        return;
      } catch (err) {
        recordHostCoreFailure(err);
      }
    }
    return this.fallback.delete(ref);
  }
}

/**
 * Factory: wire host-core IPC into a fallback SecretStore.
 * Pass `host: null` to bypass host-core entirely (returns the fallback as-is).
 */
export function createBridgeSecretStore(options: {
  host: HostProcess | null;
  fallback: SecretStore;
}): SecretStore {
  attachHostCoreSecretStore(options.host);
  if (!options.host) return options.fallback;
  return new HostCoreSecretStoreBridge(options.fallback);
}

/**
 * Inspector/调试用:返回当前 bridge 状态(无敏感信息)。
 */
export function secretStoreBridgeState(): { hostAttached: boolean; available: boolean; inBackoff: boolean } {
  const inBackoff = state.lastFailureMs > 0 && Date.now() - state.lastFailureMs < state.backoffMs;
  return {
    hostAttached: state.host !== null,
    available: state.available,
    inBackoff,
  };
}
