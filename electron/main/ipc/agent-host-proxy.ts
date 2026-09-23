/**
 * agentHost Proxy — shared between `ipc/index.ts` (which owns the lazy-load
 * orchestration) and the IPC sub-modules (`agent.ts`, `collaboration.ts`,
 * `connectors.ts`, `harness.ts`, `misc.ts`) that need to call agentHost
 * inside their handlers.
 *
 * Without this module, the sub-modules would either:
 *   a) static-import `../agent/agent-host` → defeats the lazy load, OR
 *   b) import `agentHost` from `./index` → circular import (index.ts imports
 *      the sub-modules to register their handlers).
 *
 * The Proxy exposes the same `agentHost` shape. Callers that need the live
 * host explicitly await `ensureAgentHostLoaded()` before accessing it.
 */
import type * as AgentHostModule from "../agent/agent-host";

let _agentHostBinding: typeof AgentHostModule.agentHost | null = null;
let _agentHostLoadPromise: Promise<typeof AgentHostModule.agentHost> | null = null;

export function bindAgentHost(host: typeof AgentHostModule.agentHost): void {
  _agentHostBinding = host;
  _agentHostLoadPromise = Promise.resolve(host);
}

/** Resolved agent-host module (module-level exports like `emitRendererEvent`
 *  are NOT on the facade object, so we keep the namespace too). */
let _agentHostModule: typeof AgentHostModule | null = null;

let _bindRendererEventEmitter: typeof AgentHostModule.bindRendererEventEmitter | null = null;
export function bindRendererEventEmitterFn(fn: typeof AgentHostModule.bindRendererEventEmitter): void {
  _bindRendererEventEmitter = fn;
}

/**
 * Ensure agentHost module is loaded on an explicit lifecycle or IPC path.
 */
export function ensureAgentHostLoaded(): Promise<typeof AgentHostModule.agentHost> {
  if (_agentHostBinding) return Promise.resolve(_agentHostBinding);
  if (_agentHostLoadPromise) return _agentHostLoadPromise;
  _agentHostLoadPromise = (async () => {
    const mod = await import("../agent/agent-host");
    _agentHostBinding = mod.agentHost;
    _agentHostModule = mod;
    if (!_bindRendererEventEmitter) _bindRendererEventEmitter = mod.bindRendererEventEmitter;
    return mod.agentHost;
  })();
  return _agentHostLoadPromise;
}

export const agentHost: typeof AgentHostModule.agentHost = new Proxy(
  {} as typeof AgentHostModule.agentHost,
  {
    get(_target, prop) {
      if (_agentHostBinding) {
        const value = (_agentHostBinding as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(_agentHostBinding) : value;
      }
      if (!_agentHostLoadPromise) {
        throw new Error(
          `agentHost.${String(prop)} accessed before module load initiated; ` +
          `this is a programming error — use the async API or call ensureAgentHostLoaded()`,
        );
      }
      throw new Error(
        `agentHost.${String(prop)} accessed while module load is in flight; ` +
        `await ensureAgentHostLoaded() first or use bindAgentHost() to bind synchronously. ` +
        `(the load promise is still resolving — retry the access in a microtask)`,
      );
    },
    has(_target, prop) {
      return _agentHostBinding ? prop in (_agentHostBinding as object) : false;
    },
  },
);

export const bindRendererEventEmitter: typeof AgentHostModule.bindRendererEventEmitter = ((callback) => {
  if (!_bindRendererEventEmitter) {
    void ensureAgentHostLoaded();
    throw new Error(
      "bindRendererEventEmitter called before bindRendererEventEmitterFn() and module load is in flight",
    );
  }
  return _bindRendererEventEmitter(callback);
}) as typeof AgentHostModule.bindRendererEventEmitter;

/**
 * Forward an event to the renderer over the *bound* emitter.
 *
 * This MUST go through the agent-host module (bound by `ipc/index.ts` via
 * `bindRendererEventEmitter`). There is a second, unbound emitter module at
 * `agent/host-modules/_surface/renderer-event-emitter.ts` — importing that
 * one directly compiles fine but silently drops every event, because nothing
 * ever registers a sink on it. IPC sub-modules (e.g. `providers.ts`) use this
 * helper so a broadcast actually reaches the renderer.
 *
 * Fire-and-forget: if the agent-host module is still loading, we queue on the
 * load promise instead of dropping the event.
 */
export function emitRendererEvent(channel: string, payload: unknown): void {
  if (_agentHostModule) {
    _agentHostModule.emitRendererEvent(channel, payload);
    return;
  }
  // Not loaded yet — do not drop. Load, then emit.
  void ensureAgentHostLoaded()
    .then(() => { _agentHostModule?.emitRendererEvent(channel, payload); })
    .catch(() => { /* renderer events are best-effort */ });
}

/** Exposed for testing + boot orchestration that wants to await the load. */
export function agentHostReady(): Promise<typeof AgentHostModule.agentHost> {
  return ensureAgentHostLoaded();
}
