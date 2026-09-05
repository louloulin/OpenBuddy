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
 * The Proxy exposes the same `agentHost` shape; the first property access
 * either returns the bound value (if `bindAgentHost` has been called) or
 * throws a descriptive error pointing at `ensureAgentHostLoaded`.
 */
import type * as AgentHostModule from "../agent/agent-host";

let _agentHostBinding: typeof AgentHostModule.agentHost | null = null;
let _agentHostLoadPromise: Promise<typeof AgentHostModule.agentHost> | null = null;

export function bindAgentHost(host: typeof AgentHostModule.agentHost): void {
  _agentHostBinding = host;
  _agentHostLoadPromise = Promise.resolve(host);
}

let _bindRendererEventEmitter: typeof AgentHostModule.bindRendererEventEmitter | null = null;
export function bindRendererEventEmitterFn(fn: typeof AgentHostModule.bindRendererEventEmitter): void {
  _bindRendererEventEmitter = fn;
}

/**
 * Ensure agentHost module is loaded. Self-bootstraps on first access so
 * registerIpc can register event handlers BEFORE bootBackgroundServices
 * has finished its dynamic import.
 */
export function ensureAgentHostLoaded(): Promise<typeof AgentHostModule.agentHost> {
  if (_agentHostBinding) return Promise.resolve(_agentHostBinding);
  if (_agentHostLoadPromise) return _agentHostLoadPromise;
  _agentHostLoadPromise = (async () => {
    const mod = await import("../agent/agent-host");
    _agentHostBinding = mod.agentHost;
    if (!_bindRendererEventEmitter) _bindRendererEventEmitter = mod.bindRendererEventEmitter;
    return mod.agentHost;
  })();
  return _agentHostLoadPromise;
}

// Pre-warm: kick off the dynamic import as soon as this module is loaded.
// This lets the heavy 138-import graph parse & evaluate on a background
// microtask while the main thread continues with window create + first
// paint. By the time IPC handlers actually fire (user interaction),
// the load has usually already completed.
void ensureAgentHostLoaded();

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

/** Exposed for testing + boot orchestration that wants to await the load. */
export function agentHostReady(): Promise<typeof AgentHostModule.agentHost> {
  return ensureAgentHostLoaded();
}
