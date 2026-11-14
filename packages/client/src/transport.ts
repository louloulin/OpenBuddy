/**
 * How the client reaches a host (20261115-md R5, §9). `ElectronTransport` rides the preload bridge through ipc.ts;
 * `MemoryTransport` is an in-process fake host for tests; a `WsTransport` follows in P4 against the same contract
 * (src/__tests__/transport.test.ts).
 *
 * Not wired in yet: the api/* wrappers still call ipc.ts directly, so their call paths (and the vi.mock seams the
 * renderer tests rely on) are unchanged. Switching them to a Transport is the next R5 step.
 */
import * as ipc from "./ipc";
import type { UnlistenFn } from "./ipc";

export type TransportState = "connecting" | "open" | "closed";

export interface Transport {
  /** Send one command to the host; resolves with its reply, rejects with its error. */
  invoke<T = unknown>(command: string, payload?: unknown): Promise<T>;
  /** Receive the payloads of one event until the returned function is called. */
  listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn>;
  /** Connection state; drives re-sync (agent_load_session + resume after the snapshot's seq) once reconnects exist. */
  state(): TransportState;
  onState(listener: (state: TransportState) => void): UnlistenFn;
}

/** Desktop transport: every call goes through ipc.ts, so `not_implemented` replies still reject exactly as before. */
export class ElectronTransport implements Transport {
  invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
    return ipc.invoke<T>(command, payload);
  }

  listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    return ipc.listen<T>(event, envelope => handler(envelope.payload));
  }

  /** IPC has no connection to lose: it is open for the window's lifetime. */
  state(): TransportState {
    return "open";
  }

  onState(): UnlistenFn {
    return () => {};
  }
}

export type MemoryHandler = (payload: unknown) => unknown;

/** In-memory host for tests: register a handler per command, push events with `emit`, flip `setState`. */
export class MemoryTransport implements Transport {
  /** Every invoke in order, including the ones that had no handler. */
  readonly calls: { command: string; payload: unknown }[] = [];
  private readonly handlers = new Map<string, MemoryHandler>();
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly stateListeners = new Set<(state: TransportState) => void>();
  private current: TransportState = "open";

  constructor(handlers: Record<string, MemoryHandler> = {}) {
    for (const [command, handler] of Object.entries(handlers)) this.handle(command, handler);
  }

  /** Register (or replace) the handler of one command; the returned function removes it again. */
  handle(command: string, handler: MemoryHandler): () => void {
    this.handlers.set(command, handler);
    return () => {
      if (this.handlers.get(command) === handler) this.handlers.delete(command);
    };
  }

  async invoke<T = unknown>(command: string, payload?: unknown): Promise<T> {
    this.calls.push({ command, payload });
    if (this.current !== "open") throw new Error(`MemoryTransport is ${this.current}: ${command}`);
    const handler = this.handlers.get(command);
    if (!handler) throw new Error(`MemoryTransport has no handler for ${command}`);
    return (await handler(payload)) as T;
  }

  async listen<T = unknown>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    const listener = (payload: unknown) => handler(payload as T);
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /** Deliver one event to every current listener; returns how many received it. */
  emit(event: string, payload?: unknown): number {
    const current = [...(this.listeners.get(event) ?? [])];
    for (const listener of current) listener(payload);
    return current.length;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  state(): TransportState {
    return this.current;
  }

  onState(listener: (state: TransportState) => void): UnlistenFn {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /** Simulate a dropped or re-opened connection. */
  setState(state: TransportState): void {
    if (state === this.current) return;
    this.current = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }
}
