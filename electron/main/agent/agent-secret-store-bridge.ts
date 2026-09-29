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
 *   2. 用 new HostCoreSecretStoreBridge(fallback) 包装现有 SecretStore
 *   3. 其它调用点无需修改 —— SecretStore 接口签名不变
 *
 * 懒迁移(legacy credentials):
 *   host-core 一旦能响应 secrets.get 就成为权威源,但用户 keychain 里已有的
 *   MCP 凭据在 host 端并不存在。若不处理,升级后的用户会看到"凭据全没了"。
 *   因此 get() 在 host 未命中时回读 platform store,命中则回填 host —— 每个
 *   ref 只迁移一次(migratedRefs),之后 host 端即为唯一来源。
 *
 *   顺带修正一个语义错误:host 对"ref 不存在"返回 SECRET_NOT_FOUND 错误而非
 *   空值。若把它当作 host-core 故障,一次正常的未命中读取就会触发
 *   recordHostCoreFailure 并让整个 bridge 降级 5 秒。
 *
 * 单元测试: `electron/main/agent/__tests__/agent-secret-store-bridge.test.ts`
 */

import {
  callSecretsDelete,
  callSecretsGet,
  callSecretsSet,
  type HostProcess,
} from "@openbuddy/host-runtime";
import { RpcCallError } from "@openbuddy/shared-error-codes";
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

/** 每个 ref 只做一次懒迁移,避免每次未命中都回读 keychain。 */
const migratedRefs = new Set<string>();

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
  migratedRefs.clear();
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

/** host 对"ref 不存在"返回 SECRET_NOT_FOUND,而非空值 —— 这是正常的未命中,不是故障。 */
function isSecretNotFound(err: unknown): boolean {
  return err instanceof RpcCallError && err.errorCode === "SECRET_NOT_FOUND";
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
        if (res.value != null) return res.value;
      } catch (err) {
        // host 未命中不是故障:回落到 platform store,并尝试一次性懒迁移。
        if (!isSecretNotFound(err)) recordHostCoreFailure(err);
        else recordHostCoreSuccess();
      }
      return this.migrateFromFallback(ref);
    }
    return this.fallback.get(ref);
  }

  /**
   * host 未命中时回读 platform store;若 legacy 凭据存在则回填 host,
   * 使 host 端成为后续读取的权威源。每个 ref 只尝试一次。
   */
  private async migrateFromFallback(ref: string): Promise<string | undefined> {
    if (migratedRefs.has(ref)) return this.fallback.get(ref);
    migratedRefs.add(ref);
    const legacy = await this.fallback.get(ref);
    if (legacy == null) return undefined;
    try {
      await callSecretsSet(state.host!, { ref, value: legacy });
    } catch (err) {
      recordHostCoreFailure(err);
    }
    return legacy;
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
