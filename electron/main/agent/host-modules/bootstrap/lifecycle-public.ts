/**
 * host-modules/bootstrap/lifecycle-public.ts
 *
 * v6-G M1 - 把 agent-host.ts 的 public lifecycle functions (dispose,
 * bindRendererEventEmitter, emitRendererEvent, rebindSession, init, etc.)
 * 抽到独立文件, agent-host.ts 通过 1 行 re-export 暴露.
 *
 * 这些函数都属于 "IPC + init/teardown surface", 共享 module-level singleton
 * (rendererEventEmitter) 或单纯转发到其他 host-module.
 *
 * 反向依赖不变量: 此模块不 import agent-host.ts.
 */
import { boundEventPayload } from "@openbuddy/plugin-host";
import { casdoorAuth } from "../../../casdoor/casdoor-auth";
import { disposeInternal } from "../dispose-internal";
import { init as initImpl } from "../init-orchestration";
import { rebindSession as rebindSessionImpl } from "../session-rebind";
import { resolveUiRequest as resolveUiRequestImpl } from "../ui-request-resolver";
import { telemetrySink as telemetrySinkImpl } from "../telemetry-sink";
import {
  assistantMessageText as assistantMessageTextImpl,
  createTeamRunner as createTeamRunnerImpl,
} from "../team-runner";
import {
  __registerDefaultRendererEventEmitter,
  __registerDefaultState,
  __registerDefaultCasdoorStatus,
} from "../workbench-scope-sync";
import { __registerDefaultState as __registerDefaultDshState } from "../dsh-bridge-helpers";
import type { OpenBuddyTelemetrySink } from "../../pi-telemetry-bridge";
import type { AgentHostState } from "../_state-shape";

// Module-level singleton for the renderer event emitter
let rendererEventEmitter: ((channel: string, payload: unknown) => void) | null = null;

export function bindRendererEventEmitter(emitter: (channel: string, payload: unknown) => void): () => void {
  rendererEventEmitter = emitter;
  return () => { if (rendererEventEmitter === emitter) rendererEventEmitter = null; };
}

export function emitRendererEvent(channel: string, payload: unknown): void {
  rendererEventEmitter?.(channel, boundEventPayload(payload).value);
}

// Bridge to workbench-scope-sync's module-level emit registry so module-load
// can register immediately without waiting for installMicrokernelHost.
__registerDefaultRendererEventEmitter(emitRendererEvent);
__registerDefaultCasdoorStatus(() => casdoorAuth.status());

// These need state passed in
export function registerLifecycleDefaultState(state: AgentHostState): void {
  __registerDefaultState(state);
  __registerDefaultDshState(state);
}

export function dispose(enqueueLifecycle: <T>(op: () => Promise<T>) => Promise<T>): () => Promise<void> {
  return () => enqueueLifecycle(disposeInternal);
}

/**
 * Initialize the agent host with optional opts. Direct delegate to
 * `initImpl` from `host-modules/init-orchestration`. Exposed both as a
 * free function (so `waitUntilReady()` can `await init()` without args)
 * and as a method on `agentHost.init` (so the IPC layer can pass opts).
 */
export function init(opts?: { cwd?: string; sessionPath?: string; force?: boolean; traceId?: string; sessionId?: string }): Promise<void> {
  return initImpl(opts);
}

export { rebindSessionImpl as rebindSession };
export { resolveUiRequestImpl as resolveUiRequest };
export function telemetrySink(): OpenBuddyTelemetrySink | undefined { return telemetrySinkImpl(); }
export function assistantMessageText(messages: unknown): string { return assistantMessageTextImpl(messages); }
export function createTeamRunner(modelRuntime: any, cwd: string, getModel: () => any): any {
  return createTeamRunnerImpl(modelRuntime, cwd, getModel);
}
