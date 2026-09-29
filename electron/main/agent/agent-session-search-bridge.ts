/**
 * agent-session-search-bridge — Session search 双路径适配层 (P2.1-session-search)
 *
 * 与 permission/secret bridge 同款模式:
 *   - session.search / session.message / session.setRoot
 *   - 优先 host-core IPC (callSessionSearch/Message/SetRoot)
 *   - 失败静默降级到 in-memory fallback (空索引)
 *   - 5 秒 backoff
 *
 * 集成路径:
 *   bootHostCore() 之后调用 attachHostCoreSessionSearch(host.inner)
 *   IPC handlers 调用 createBridgeSessionSearchClient() 拿到 client
 *
 * 单元测试: `electron/main/agent/__tests__/agent-session-search-bridge.test.ts`
 */

import {
  callSessionMessage,
  callSessionSearch,
  callSessionSetRoot,
  type HostProcess,
  type SearchHit,
} from "@openbuddy/host-runtime";

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

export function attachHostCoreSessionSearch(host: HostProcess | null): void {
  state = { ...state, host, available: host !== null, lastFailureMs: 0 };
}

export function resetAgentSessionSearchBridge(): void {
  state = { ...INITIAL_STATE };
}

function shouldTryHostCore(): boolean {
  if (!state.host || !state.available) return false;
  const now = Date.now();
  if (state.lastFailureMs > 0 && now - state.lastFailureMs < state.backoffMs) return false;
  return true;
}

function recordHostCoreFailure(err: unknown): void {
  state = { ...state, available: false, lastFailureMs: Date.now() };
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-session-search-bridge] host-core IPC failed, falling back to empty index:",
    err instanceof Error ? err.message : String(err),
  );
}

function recordHostCoreSuccess(): void {
  if (!state.available || state.lastFailureMs > 0) {
    state = { ...state, available: true, lastFailureMs: 0 };
  }
}

export async function sessionSearchViaBridge(query: string, limit?: number): Promise<SearchHit[]> {
  if (shouldTryHostCore()) {
    try {
      const res = await callSessionSearch(state.host!, { query, ...(limit !== undefined ? { limit } : {}) });
      recordHostCoreSuccess();
      return res.hits;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return [];
}

export async function sessionMessageViaBridge(sessionId: string, lineNo: number): Promise<string | undefined> {
  if (shouldTryHostCore()) {
    try {
      const res = await callSessionMessage(state.host!, { sessionId, lineNo });
      recordHostCoreSuccess();
      return res.content;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return undefined;
}

export async function sessionSetRootViaBridge(sessionsRoot: string): Promise<void> {
  if (shouldTryHostCore()) {
    try {
      await callSessionSetRoot(state.host!, { sessionsRoot });
      recordHostCoreSuccess();
      return;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  // fallback: no-op (in-memory fallback has no persistent state)
}

export function sessionSearchBridgeState(): { hostAttached: boolean; available: boolean; inBackoff: boolean } {
  const inBackoff = state.lastFailureMs > 0 && Date.now() - state.lastFailureMs < state.backoffMs;
  return {
    hostAttached: state.host !== null,
    available: state.available,
    inBackoff,
  };
}
