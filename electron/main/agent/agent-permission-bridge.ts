/**
 * agent-permission-bridge — 双路径权限适配层 (P2.1)
 *
 * 关闭 R97 后剩余 1% 缺口:
 *   - Rust host-core 已完整实现 `permissions.{evaluate,readRules,writeRules,
 *     readMode,writeMode}` 五个 IPC method
 *   - `packages/runtime/openbuddy-host-runtime/src/capabilities.ts` 已封装对应
 *     `callPermissions*` wrapper
 *   - 但 `electron/main/agent/agent-host.ts` 等 9 处仍在直接 import
 *     `permissionHandlers`(TS 直读 settings.json),未走 host-core
 *
 * 本适配层提供 9 处调用点的"零行为变化"替换路径:
 *   - 优先尝试 host-core IPC(性能、globset 编译、跨进程隔离)
 *   - 失败时静默降级到 TS 直接调用(`@openbuddy/auth-permission`)
 *   - 永远不抛出 host-core 异常(降级而非崩溃)
 *   - `agentPermissionBridge` 对象与 `permissionHandlers` 同 shape,drop-in 替换
 *
 * 不动 `@openbuddy/auth-permission` 的实现;不动 settings.json 磁盘 schema;
 * 不引入新 npm 依赖。host-core binary 缺失时,行为完全等价于旧实现。
 *
 * 单元测试: `electron/main/agent/__tests__/agent-permission-bridge.test.ts`
 */

import {
  callPermissionsEvaluate,
  callPermissionsReadMode,
  callPermissionsReadRules,
  callPermissionsWriteMode,
  callPermissionsWriteRules,
  type PermissionMode,
  type PermissionRule,
  type HostProcess,
} from "@openbuddy/host-runtime";
import {
  permissionHandlers,
  resolvePermissionAction,
  type PermissionAction,
} from "@openbuddy/auth-permission";

interface BridgeState {
  /** host-core 句柄(由 bootHostCore() 注入);为 null 时直接走 fallback。 */
  host: HostProcess | null;
  /** host-core 是否可用(已通过 handshake);失败一次后短期缓存 false。 */
  available: boolean;
  /** 上一次失败时间,用于 backoff 重试。 */
  lastFailureMs: number;
  /** 失败 backoff 窗口(5 秒),避免每次调用都重试 host-core。 */
  readonly backoffMs: number;
}

const INITIAL_STATE: BridgeState = {
  host: null,
  available: true,
  lastFailureMs: 0,
  backoffMs: 5_000,
};

let state: BridgeState = { ...INITIAL_STATE };

/**
 * 注入 host-core 句柄。在 bootHostCore() 之后调用一次。
 * 注入 null 表示回退到纯 TS 模式(例如 binary 未构建时)。
 */
export function attachHostCorePermissions(host: HostProcess | null): void {
  state = {
    ...state,
    host,
    available: host !== null,
    lastFailureMs: 0,
  };
}

/**
 * 重置 bridge(测试用)。恢复 initial state。
 */
export function resetAgentPermissionBridge(): void {
  state = { ...INITIAL_STATE };
}

/**
 * 内部:检查 host-core 是否可用,且不在 backoff 窗口。
 */
function shouldTryHostCore(): boolean {
  if (!state.host || !state.available) return false;
  const now = Date.now();
  if (state.lastFailureMs > 0 && now - state.lastFailureMs < state.backoffMs) {
    return false;
  }
  return true;
}

/**
 * 内部:记录 host-core 失败,触发 backoff。
 */
function recordHostCoreFailure(err: unknown): void {
  state = {
    ...state,
    available: false,
    lastFailureMs: Date.now(),
  };
  // eslint-disable-next-line no-console
  console.warn(
    "[agent-permission-bridge] host-core IPC failed, falling back to TS direct:",
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * 内部:host-core 调用成功后清空 backoff。
 */
function recordHostCoreSuccess(): void {
  if (!state.available || state.lastFailureMs > 0) {
    state = { ...state, available: true, lastFailureMs: 0 };
  }
}

/**
 * 评估权限决策 — hot path。
 * 返回 `allow` | `deny` | `ask`,失败/未配置时返回 undefined(由调用方决定默认行为)。
 */
export async function evaluateViaBridge(
  tool: string,
  pattern?: string,
): Promise<PermissionAction | undefined> {
  if (shouldTryHostCore()) {
    try {
      const decision = await callPermissionsEvaluate(state.host!, { tool, pattern });
      recordHostCoreSuccess();
      return decision.action;
    } catch (err) {
      recordHostCoreFailure(err);
      // 降级到 fallback
    }
  }
  return resolvePermissionAction(await permissionHandlers.readRules(), tool, pattern);
}

/**
 * 读规则列表 — 与 `permissionHandlers.readRules()` 同语义。
 */
export async function readRulesViaBridge(): Promise<PermissionRule[]> {
  if (shouldTryHostCore()) {
    try {
      const rules = await callPermissionsReadRules(state.host!);
      recordHostCoreSuccess();
      return rules;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return permissionHandlers.readRules();
}

/**
 * 写规则列表 — 与 `permissionHandlers.writeRules(rules)` 同语义。
 */
export async function writeRulesViaBridge(rules: PermissionRule[]): Promise<void> {
  if (shouldTryHostCore()) {
    try {
      await callPermissionsWriteRules(state.host!, rules);
      recordHostCoreSuccess();
      return;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return permissionHandlers.writeRules(rules);
}

/**
 * 读默认 mode — 与 `permissionHandlers.readMode()` 同语义。
 */
export async function readModeViaBridge(): Promise<PermissionMode> {
  if (shouldTryHostCore()) {
    try {
      const mode = await callPermissionsReadMode(state.host!);
      recordHostCoreSuccess();
      return mode;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return permissionHandlers.readMode();
}

/**
 * 写默认 mode — 与 `permissionHandlers.writeMode(mode)` 同语义。
 */
export async function writeModeViaBridge(mode: PermissionMode): Promise<void> {
  if (shouldTryHostCore()) {
    try {
      await callPermissionsWriteMode(state.host!, mode);
      recordHostCoreSuccess();
      return;
    } catch (err) {
      recordHostCoreFailure(err);
    }
  }
  return permissionHandlers.writeMode(mode);
}

/**
 * Drop-in 对象式接口 — 与 `permissionHandlers` 同 shape,
 * 调用方只需 `import { agentPermissionBridge } from ...`,
 * 然后把 `permissionHandlers.readRules()` 改成 `agentPermissionBridge.readRules()`。
 */
export const agentPermissionBridge = {
  readRules: readRulesViaBridge,
  writeRules: writeRulesViaBridge,
  readMode: readModeViaBridge,
  writeMode: writeModeViaBridge,
  evaluate: evaluateViaBridge,
} as const;

/**
 * 用于 inspector/调试:返回当前 bridge 状态(无敏感信息)。
 */
export function bridgeState(): { hostAttached: boolean; available: boolean; inBackoff: boolean } {
  const inBackoff =
    state.lastFailureMs > 0 && Date.now() - state.lastFailureMs < state.backoffMs;
  return {
    hostAttached: state.host !== null,
    available: state.available,
    inBackoff,
  };
}
