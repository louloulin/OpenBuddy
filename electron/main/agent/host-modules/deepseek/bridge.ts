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

export type BridgeContext = {
  get?: (key: string) => unknown;
} | null;

export type BridgeRemoteDispatcher = {
  invoke: (value: unknown, context: unknown) => Promise<unknown>;
};

export type BridgeServiceContext = unknown;

/**
 * Phase L.2 (v6 plan) — `isNamedRemoteRequest` was previously a separate
 * helper exported from `harness/remote-invocation.ts` (deleted). It gates
 * whether a request is a "named" form (object args, not array) which is
 * the only shape the legacy typert gateway accepted. The fallback path
 * always passes the request through to the DSH `RemoteDispatcher` which
 * accepts both array and named forms.
 */
function isNamedRemoteRequest(request: unknown): boolean {
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  return typeof value.namespace === "string"
    && typeof value.method === "string"
    && value.args !== undefined
    && Boolean(value.args)
    && typeof value.args === "object"
    && !Array.isArray(value.args)
    && Object.getPrototypeOf(value.args) === Object.prototype;
}

export function invokeRemote(args: {
  context: BridgeContext;
  remoteDispatcher: BridgeRemoteDispatcher;
  remoteServiceContext: () => BridgeServiceContext;
  request: unknown;
}): Promise<unknown> {
  const gateway = args.context?.get?.("typertGateway") as
    | { invoke?: (value: unknown) => Promise<unknown> }
    | undefined;
  // Phase L.2 (v6 plan) — inline replacement for the deleted
  // `invokeRemoteWithGateway` helper: if the request is a named form
  // and a typert gateway is wired, delegate to the gateway; otherwise
  // fall back to the DSH RemoteDispatcher. The gateway is itself a
  // DSH-only concept slated for deletion in Phase L.4; once it goes
  // this conditional collapses to the fallback branch.
  if (gateway && typeof gateway.invoke === "function" && isNamedRemoteRequest(args.request)) {
    return gateway.invoke(args.request);
  }
  return args.remoteDispatcher.invoke(args.request, args.remoteServiceContext());
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