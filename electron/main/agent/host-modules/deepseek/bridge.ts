/**
 * host-modules/deepseek/bridge.ts — DeepSeek ↔ pi bridge helpers.
 *
 * Stage F-2 (extended): 从 agent-host.ts:479-507 抽出 4 个 helper:
 *   - invokeRemote: state.context.typertGateway → remoteDispatcher fallback
 *   - deepSeekCordisSnapshot: structuredClone of state.deepSeekCordisSnapshot
 *   - deepSeekPiBridgeDescription: protocol/capabilities tuple
 *   - invokeDeepSeekCordis: passthrough to state.deepSeekCordisRuntime.invoke
 *
 * 设计:
 *   - 全部是 thin wrapper + 纯函数
 *   - 通用 any-context 入参(避开 RemoteDispatcher 类型细节;agent-host.ts
 *     wrapper 把更严格的类型传进来)
 */

import type {
  DeepSeekCordisInvocation,
  DeepSeekCordisRuntimeSnapshot,
} from "@openbuddy/plugin-host";
import { invokeRemoteWithGateway } from "../../../harness/remote-invocation";

export type BridgeContext = {
  get?: (key: string) => unknown;
} | null;

export type BridgeRemoteDispatcher = {
  invoke: (value: unknown, context: unknown) => Promise<unknown>;
};

export type BridgeServiceContext = unknown;

export function invokeRemote(args: {
  context: BridgeContext;
  remoteDispatcher: BridgeRemoteDispatcher;
  remoteServiceContext: () => BridgeServiceContext;
  request: unknown;
}): Promise<unknown> {
  const gateway = args.context?.get?.("typertGateway") as
    | { invoke?: (value: unknown) => Promise<unknown> }
    | undefined;
  return invokeRemoteWithGateway(
    args.request,
    typeof gateway?.invoke === "function" ? { invoke: gateway.invoke.bind(gateway) } : undefined,
    (value: unknown) => args.remoteDispatcher.invoke(value, args.remoteServiceContext()),
  );
}

export function deepSeekCordisSnapshot(
  source: DeepSeekCordisRuntimeSnapshot | null,
): DeepSeekCordisRuntimeSnapshot | null {
  return source ? structuredClone(source) : null;
}

export function deepSeekPiBridgeDescription<P, C>(protocol: P, capabilities: C): {
  protocol: P;
  runtime: "pi";
  capabilities: C;
} {
  return {
    protocol,
    runtime: "pi",
    capabilities,
  };
}

export async function invokeDeepSeekCordis(
  runtime: { invoke: (invocation: DeepSeekCordisInvocation) => Promise<unknown> } | null,
  invocation: DeepSeekCordisInvocation,
): Promise<unknown> {
  if (!runtime) throw new Error("deepseek-cordis: runtime is not active");
  return runtime.invoke(invocation);
}