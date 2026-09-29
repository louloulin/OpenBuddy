/**
 * agent-workspace-bridge — Workspace 双路径适配层 (P2.1-workspace)
 *
 * 与 permission/secret bridge 同款模式:
 *   - workspace.check / .setRoot
 *   - 优先 host-core IPC,失败静默降级到 in-memory fallback
 *   - 5 秒 backoff
 *
 * 单元测试: `electron/main/agent/__tests__/agent-workspace-bridge.test.ts`
 */

import {
  callWorkspaceCheck,
  callWorkspaceSetRoot,
  type CheckResult,
  type HostProcess,
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

export function attachHostCoreWorkspace(host: HostProcess | null): void {
  state = { ...state, host, available: host !== null, lastFailureMs: 0 };
}

export function resetAgentWorkspaceBridge(): void {
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
    "[agent-workspace-bridge] host-core IPC failed, falling back to TS resolver:",
    err instanceof Error ? err.message : String(err),
  );
}

function recordHostCoreSuccess(): void {
  if (!state.available || state.lastFailureMs > 0) {
    state = { ...state, available: true, lastFailureMs: 0 };
  }
}

export async function workspaceCheckViaBridge(path: string): Promise<CheckResult | null> {
  if (shouldTryHostCore()) {
    try {
      return await callWorkspaceCheck(state.host!, { path });
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return null;
}

export async function workspaceSetRootViaBridge(workspaceRoot: string): Promise<void> {
  if (shouldTryHostCore()) {
    try {
      await callWorkspaceSetRoot(state.host!, { workspaceRoot });
      recordHostCoreSuccess();
      return;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  // fallback: no-op
}

export function workspaceBridgeState(): { hostAttached: boolean; available: boolean; inBackoff: boolean } {
  const inBackoff = state.lastFailureMs > 0 && Date.now() - state.lastFailureMs < state.backoffMs;
  return {
    hostAttached: state.host !== null,
    available: state.available,
    inBackoff,
  };
}
