/**
 * host-modules/facade/deepseek-facade.ts
 *
 * v6-G M1 (facade 化) — 把 agent-host.ts 中 deepseek / collaboration
 * forwarders 提取到独立 facade.
 *
 * 反向依赖不变: 此模块不 import agent-host.ts.
 */
import type { AgentHostState } from "../_state-shape";
import { invokeConnection as invokeConnectionImpl } from "../remote-connection";
import {
  questionAnswer as questionAnswerImpl,
  deepSeekCordisSnapshot as deepSeekCordisSnapshotImplFn,
  deepSeekPiBridgeDescription as deepSeekPiBridgeDescriptionImplFn,
  invokeDeepSeekCordis as invokeDeepSeekCordisImplFn,
} from "../dsh-bridge-helpers";
import { invokeRemote as invokeRemoteImpl } from "../deepseek/bridge";
import { remoteServiceContext } from "../workbench-scope";
import {
  createDeepSeekAgent as createDeepSeekAgentImpl,
  resumeDeepSeekAgent as resumeDeepSeekAgentImpl,
} from "../deepseek/agent-runtime";
// createDeepSeekAgentRuntime 是 module-internal helper, facade 用 createDeepSeekAgent / resumeDeepSeekAgent 替代.

export function buildDeepseekFacade(state: AgentHostState) {
  return {
    questionAnswer: (value: any, questionKey?: string) => questionAnswerImpl(value, questionKey),
    deepSeekCordisSnapshot: () => deepSeekCordisSnapshotImplFn(),
    deepSeekPiBridgeDescription: () => deepSeekPiBridgeDescriptionImplFn(),
    invokeDeepSeekCordis: (invocation: any) => invokeDeepSeekCordisImplFn(invocation),
    invokeRemote: (request: unknown) =>
      invokeRemoteImpl({
        context: state.context as never,
        remoteDispatcher: state.remoteDispatcher as never,
        remoteServiceContext,
        request,
      }),
    invokeConnection: (method: string, payload: unknown, request?: unknown) =>
      invokeConnectionImpl(state as never, method, payload, request as never),
    // createDeepSeekAgentRuntime: module-internal, use createDeepSeekAgent / resumeDeepSeekAgent instead.
    createDeepSeekAgent: (options: any) => createDeepSeekAgentImpl(options),
    resumeDeepSeekAgent: (options: any) => resumeDeepSeekAgentImpl(options),
  };
}
