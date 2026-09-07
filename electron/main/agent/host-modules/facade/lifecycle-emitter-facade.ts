/**
 * host-modules/facade/lifecycle-emitter-facade.ts
 *
 * v6-G M1 - 把 agent-host.ts 中 ~80 行的 renderer-event emitter + dispose +
 * telemetry + team runner 工厂 cluster 抽到独立 facade.
 *
 * 这个 cluster 共同依赖 `state`, 但因为它们都是 module-level singleton
 * 写入器 (rendererEventEmitter) + 包装工厂 (telemetrySink / createTeamRunner),
 * 抽到独立 facade 让 agent-host.ts 保持微内核只负责 facade assembly.
 *
 * 反向依赖不变量: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import type { TeamRunner } from "@openbuddy/team-team";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { OpenBuddyTelemetrySink } from "../pi-telemetry-bridge";

import { telemetrySink as telemetrySinkImpl } from "../telemetry-sink";
import {
  assistantMessage as assistantMessageImpl,
  createTeamRunner as createTeamRunnerImpl,
} from "../team-runner";
import { disposeInternal } from "../dispose-internal";

import {
  bindRendererEventEmitter as bindRendererEventEmitterImpl,
  emitRendererEvent as emitRendererEventImpl,
  __registerDefaultRendererEventEmitter,
  __registerDefaultState,
  __registerDefaultCasdoorStatus,
} from "../workbench-scope-sync";
import { __registerDefaultState as __registerDefaultDshState } from "../dsh-bridge-helpers";
import { casdoorAuth } from "../../../casdoor/casdoor-auth";

let rendererEventEmitter: ((channel: string, payload: unknown) => void) | null = null;

export function buildLifecycleEmitterFacade(state: AgentHostState) {
  // Set up the renderer event emitter singleton
  function bindRendererEventEmitter(emitter: (channel: string, payload: unknown) => void): () => void {
    rendererEventEmitter = emitter;
    return () => { if (rendererEventEmitter === emitter) rendererEventEmitter = null; };
  }
  function emitRendererEvent(channel: string, payload: unknown): void {
    rendererEventEmitter?.(channel, payload);
  }

  // Bridge to workbench-scope-sync's module-level emit registry so module-load
  // can register immediately without waiting for installMicrokernelHost.
  __registerDefaultRendererEventEmitter(emitRendererEvent);
  __registerDefaultState(state);
  __registerDefaultCasdoorStatus(() => casdoorAuth.status());
  __registerDefaultDshState(state);

  return {
    bindRendererEventEmitter,
    emitRendererEvent,
    dispose: (enqueueLifecycle: <T>(op: () => Promise<T>) => Promise<T>) =>
      () => enqueueLifecycle(disposeInternal),
    telemetrySink: (): OpenBuddyTelemetrySink | undefined => telemetrySinkImpl(),
    createTeamRunner: (modelRuntime: ModelRuntime, cwd: string, getModel: () => Model<any> | undefined): TeamRunner =>
      createTeamRunnerImpl(modelRuntime, cwd, getModel),
    assistantMessageText: (messages: unknown): string => assistantMessageImpl(messages),
  };
}
