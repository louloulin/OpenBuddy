/**
 * host-modules/plugin-event-bus.ts — plugin event bus + readiness snapshot.
 *
 * Phase 8.3 Batch J: 从 agent-host.ts:1557-1751 抽出 (~195 行):
 *   - eventNamespace (line 1557) — 前缀路由
 *   - canonicalEventNamespace (line 1567) — alias 表
 *   - clonePayload (line 1588) — structuredClone + bigint-safe fallback
 *   - emitPluginEvent (line 1595) — 主事件派发,序列号/sessionSequence/
 *     projection mutation/pluginReadiness 状态机
 *   - projectionMutation (line 1682) — session/projection 合成
 *   - pluginReadinessSnapshot (line 1691) — 装配 readiness 快照
 *   - emitPluginReadinessEvent (line 1702) — readiness + snapshot 广播
 *   - pluginReadiness (line 1711) — readiness 包装
 *   - pluginLifecycleQueue (line 1715) — 插件事务队列 (export const)
 *
 * 设计:
 *   - state / emitContextEvent / runHookPoint / pluginSnapshot / createPluginReadinessSnapshot
 *     通过环形 import 自 ../agent-host
 *   - pluginReadiness / emitPluginReadinessEvent 仍调用本模块内的
 *     emitPluginEventImpl(避免再次递归包装)
 *   - agent-host.ts 保留 0-arg wrapper:
 *       export function emitPluginEvent(type, payload) { return emitPluginEventImpl(state, type, payload); }
 *     让 host-modules/session-metadata 等 3 个子模块的 import 链无需修改
 *
 * event-channel-matrix 校验: 仅 grep `emitRendererEvent(...)` —
 * 不依赖 emitPluginEvent 的 wrapper 保留,但保留 wrapper 让
 * 17 个 import `agent-host` 的外部文件不需改 import。
 */
import type { Context } from "@openbuddy/cordis";
import type { PluginCommitMarker, PluginReadinessSnapshot } from "@openbuddy/plugin-host";
type PluginTransactionContext = any;
type SessionEventRecord = any;

import { createPluginReadinessSnapshot } from "@openbuddy/plugin-host";
import { PluginLifecycleQueue } from "../plugin-lifecycle";

import { emitContextEvent } from "../pi-event-bridge";
import { runHookPoint } from "../agent-hooks";
// Phase 8.3 Architectural Refactor — Install Pattern:
//   修复前: `import { state } from "../agent-host"` (reverse dep)
//   修复后: 通过 installPluginEventBus() 一次性注入 state.
//   module-level `let state` 让原 module-load 时构造的 pluginLifecycleQueue
//   闭包可以在 install 后访问到 state (因为闭包在调用时而非定义时绑定).
import { pluginSnapshot } from "./plugin-state";
import { type AgentHostState } from "./_state-shape";
import { createDefaultAgentHostState } from "./_default-state";
import { enqueueLifecycle } from "./lifecycle";

let state: AgentHostState = createDefaultAgentHostState();

/**
 * Bind plugin-event-bus module-level state. Called once from
 * agent-host.ts:initialize(). Idempotent.
 */
export function installPluginEventBus(deps: { state: AgentHostState }): void {
  state = deps.state;
}

function eventNamespace(type: string): string {
  if (type.startsWith("tool_")) return `tool/${type}`;
  if (type.startsWith("turn_")) return `turn/${type}`;
  if (type.startsWith("message_")) return `assistant/${type}`;
  if (type.startsWith("session_")) return `session/${type}`;
  if (type.startsWith("model_")) return `model/${type}`;
  if (type.startsWith("agent_")) return `agent/${type}`;
  return `agent/${type}`;
}

function canonicalEventNamespace(type: string): string | undefined {
  const aliases: Record<string, string> = {
    agent_start: "agent/start",
    agent_end: "agent/end",
    agent_settled: "agent/settled",
    turn_start: "turn/start",
    turn_end: "turn/end",
    message_start: "assistant/start",
    message_update: "assistant/update",
    message_end: "assistant/end",
    tool_execution_start: "tool/start",
    tool_execution_update: "tool/update",
    tool_execution_end: "tool/end",
    session_start: "session/start",
    session_shutdown: "session/end",
    model_select: "model/select",
    model_change: "model/change",
  };
  return aliases[type];
}

function clonePayload(payload: unknown): unknown {
  try { return structuredClone(payload); } catch {
    try { return JSON.parse(JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? Number(value) : value)); }
    catch { return { value: String(payload) }; }
  }
}

function projectionMutation(type: string, payload: unknown): { key: string; value: unknown } | undefined {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (type === "session/summary" && typeof value.title === "string") return { key: "title", value: value.title };
  if (type === "agent/start" || type === "agent_start") return { key: "status", value: "running" };
  if (type === "agent/end" || type === "agent_settled" || type === "agent/settled") return { key: "status", value: "idle" };
  if (type === "agent/error" || type === "session/error") return { key: "status", value: "error" };
  return undefined;
}

function pluginReadinessSnapshot(): PluginReadinessSnapshot {
  return createPluginReadinessSnapshot({
    phase: state.pluginReadiness.phase,
    generation: state.pluginReadiness.generation,
    main: state.loader?.list() ?? [],
    pi: state.piExtensionStatuses,
    transaction: state.pluginReadiness.transaction,
    error: state.pluginReadiness.error,
  });
}

function emitPluginReadinessEvent(): void {
  state.pluginReadiness.generation += 1;
  const snapshot = pluginReadinessSnapshot();
  emitPluginEventImpl(state, "plugin/readiness", snapshot);
  void pluginSnapshot().then((value) => emitPluginEventImpl(state, "plugin/snapshot", value)).catch((error) => {
    console.warn("[openbuddy] failed to publish plugin snapshot", error);
  });
}

function emitPluginEvent(type: string, payload: unknown): any {
  return emitPluginEventImpl(state, type, payload);
}

function emitPluginEventImpl(_stateHost: typeof state, type: string, payload: unknown): any {
  const safePayload = clonePayload(payload);
  const sequence = ++_stateHost.eventSequence;
  const sessionId = safePayload && typeof safePayload === "object" && typeof (safePayload as { sessionId?: unknown }).sessionId === "string"
    ? (safePayload as { sessionId: string }).sessionId
    : undefined;
  const sessionSequence = sessionId
    ? (_stateHost.sessionSequences.get(sessionId) ?? 0) + 1
    : undefined;
  if (sessionId && sessionSequence !== undefined) _stateHost.sessionSequences.set(sessionId, sessionSequence);
  const event: any = {
    eventVersion: 1,
    sequence,
    ...(sessionSequence === undefined ? {} : { sessionSequence }),
    timestamp: new Date().toISOString(),
    type,
    ...(sessionId ? { sessionId } : {}),
    payload: safePayload,
  };
  _stateHost.sessionEventLog?.append(event);
  if (sessionId && type !== "session/projection") {
    const projection = projectionMutation(type, safePayload);
    if (projection) emitPluginEventImpl(_stateHost, "session/projection", { sessionId, ...projection });
  }
  if (type === "plugin/transaction-start" || type === "plugin/transaction-phase") {
    const transaction = safePayload as { transactionId?: unknown; kind?: unknown; target?: unknown; phase?: unknown; surface?: unknown };
    _stateHost.pluginReadiness = {
      phase: "loading",
      generation: _stateHost.pluginReadiness.generation,
      transaction: {
        id: typeof transaction.transactionId === "string" ? transaction.transactionId : "unknown",
        kind: typeof transaction.kind === "string" ? transaction.kind : "unknown",
        target: typeof transaction.target === "string" ? transaction.target : "unknown",
        ...(typeof transaction.phase === "string" ? { phase: transaction.phase } : {}),
        ...(typeof transaction.surface === "string" ? { surface: transaction.surface } : {}),
      },
    };
    emitPluginReadinessEvent();
  } else if (type === "plugin/transaction-failed") {
    const transaction = safePayload as { transactionId?: unknown; rolledBack?: unknown; error?: unknown };
    if (transaction.rolledBack === true) {
      _stateHost.lastPluginCommitTransactionId = typeof transaction.transactionId === "string" ? transaction.transactionId : undefined;
      _stateHost.pluginReadiness = { ..._stateHost.pluginReadiness, phase: "ready", error: undefined, transaction: undefined };
    } else {
      _stateHost.pluginReadiness = {
        ..._stateHost.pluginReadiness,
        phase: "failed",
        error: typeof transaction.error === "string" ? transaction.error : "plugin transaction failed",
      };
    }
    emitPluginReadinessEvent();
  } else if (type === "plugin/transaction-complete") {
    const transaction = safePayload as { transactionId?: unknown };
    _stateHost.lastPluginCommitTransactionId = typeof transaction.transactionId === "string" ? transaction.transactionId : undefined;
    _stateHost.pluginReadiness = { ..._stateHost.pluginReadiness, phase: "ready", error: undefined, transaction: undefined };
    emitPluginReadinessEvent();
  } else if (type === "plugin/ready") {
    _stateHost.pluginReadiness = { ..._stateHost.pluginReadiness, phase: "ready", error: undefined, transaction: undefined };
    emitPluginReadinessEvent();
  }
  // Keep the main-process Cordis context as the authoritative plugin event
  // bus. IPC subscribers still receive the cloned wire payload below, while
  // in-process plugins observe the same lifecycle without polling IPC.
  if (_stateHost.context) {
    emitContextEvent(_stateHost.context as Context, type, [safePayload]);
  }
  if (type === "plugin/loaded" || type === "plugin/failed" || type === "plugin/unloaded") {
    void runHookPoint(
      _stateHost.hookConfigs,
      type === "plugin/loaded" ? "plugin/loaded" : type === "plugin/failed" ? "plugin/failed" : "plugin/unloaded",
      typeof safePayload === "object" && safePayload && typeof (safePayload as { id?: unknown }).id === "string" ? (safePayload as { id: string }).id : "",
      safePayload,
      { cwd: _stateHost.cwd ?? process.cwd(), signal: undefined, ...(_stateHost.session?.sessionId ? { sessionId: _stateHost.session.sessionId } : {}), ...(_stateHost.session?.sessionManager.getSessionFile() ? { transcriptPath: _stateHost.session.sessionManager.getSessionFile() } : {}) },
      (eventType, eventPayload) => emitPluginEventImpl(_stateHost, eventType, eventPayload),
      _stateHost.context?.get("hookShell") as any | undefined,
    ).catch((error) => console.warn("[openbuddy] plugin lifecycle hook failed", error));
  }
  for (const handler of [..._stateHost.pluginEventHandlers]) {
    try {
      handler(event);
    } catch (error) {
      console.error("[openbuddy] plugin event handler failed", error);
    }
  }
  return event;
}

function pluginReadiness(): PluginReadinessSnapshot {
  return pluginReadinessSnapshot();
}

export const pluginLifecycleQueue = new PluginLifecycleQueue(
  ((kind: string, target: string, operation: () => Promise<unknown>) => enqueueLifecycle(operation)) as unknown as ConstructorParameters<typeof PluginLifecycleQueue>[0],
  (type, payload) => { emitPluginEventImpl(state, type, payload); },
  async (transaction: any) => {
    const generation = state.pluginCommitGeneration + 1;
    const marker: PluginCommitMarker = {
      generation,
      transactionId: transaction.transactionId,
      kind: transaction.kind,
      target: transaction.target,
      committedAt: new Date().toISOString(),
      ...(transaction.rolledBack ? { rolledBack: true } : {}),
      ...(transaction.receipts ? { receipts: transaction.receipts } : {}),
      ...(transaction.requiredReceipts && transaction.requiredReceipts.length > 0 ? { requiredReceipts: [...transaction.requiredReceipts] } : {}),
    };
    if (state.pluginState) {
      const previous = await state.pluginState.read();
      await state.pluginState.write({
        updatedAt: previous?.updatedAt ?? marker.committedAt,
        overrides: previous?.overrides ?? {},
        piExtensions: previous?.piExtensions ?? {},
        commit: marker,
      });
    }
    state.pluginCommitGeneration = generation;
    state.lastPluginCommitTransactionId = marker.transactionId;
    state.lastPluginCommitMarker = marker;
  },
  {
    register: (transaction: any) => {
      state.activePluginTransactions.set(transaction.transactionId, transaction);
    },
    unregister: (transactionId: string) => {
      state.activePluginTransactions.delete(transactionId);
    },
  },
);

export {
  eventNamespace,
  canonicalEventNamespace,
  clonePayload,
  emitPluginEvent,
  emitPluginEventImpl,
  projectionMutation,
  pluginReadinessSnapshot,
  emitPluginReadinessEvent,
  pluginReadiness,
};
