/**
 * host-modules/facade/session-lifecycle-facade.ts
 *
 * v6-G M1 — 把 agent-host.ts 中 session lifecycle forwarders
 * (newSession / ensureNewSession / plugin transactions) 提取到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import {
  newSession as newSessionImpl,
  ensureNewSession as ensureNewSessionImpl,
} from "../session-swap";
import {
  reportActivePluginTransaction as reportActivePluginTransactionImpl,
  listActivePluginTransactions as listActivePluginTransactionsImpl,
} from "../plugin-state";

export function buildSessionLifecycleFacade(_state: AgentHostState) {
  return {
    newSession: (
      cwd: string,
      modelId?: string,
      options?: { traceId?: string; sessionId?: string },
    ) => newSessionImpl(cwd, modelId, options),
    ensureNewSession: (
      cwd: string,
      modelId?: string,
      options?: { traceId?: string },
    ) => ensureNewSessionImpl(cwd, modelId, options),
    // captureFileSnapshot: local helper, kept in agent-host.ts
    reportActivePluginTransaction: (
      transactionId: string,
      surface: string,
      details?: Record<string, unknown>,
    ) => reportActivePluginTransactionImpl(transactionId, surface, details),
    listActivePluginTransactions: () => listActivePluginTransactionsImpl(),
  };
}
