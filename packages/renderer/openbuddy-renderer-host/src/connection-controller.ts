export type ConnectionState = "connected" | "reconnecting";

export type ConnectionConfig = {
  backoffBaseMs?: number;
  backoffFactor?: number;
  backoffMaxMs?: number;
};

export type ConnectionCarrier<Sink> = {
  open: (signal: AbortSignal, emit: (envelope: Sink) => void, onDisconnect: () => void) => Promise<{
    description: unknown;
    close: () => void | Promise<void>;
  }>;
};

export type ConnectionControllerOptions<Sink> = {
  carrier: ConnectionCarrier<Sink>;
  onConnected?: (description: unknown, generation: number) => void;
  onStateChange?: (state: ConnectionState) => void;
  onEnvelope?: (envelope: Sink, generation: number) => void;
  config?: ConnectionConfig;
  generationSeed?: number;
};

type RequiredConfig = Required<ConnectionConfig>;

const defaults: RequiredConfig = {
  backoffBaseMs: 100,
  backoffFactor: 2,
  backoffMaxMs: 5_000,
};

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export class ConnectionController<Sink> {
  private readonly config: RequiredConfig;
  private running = false;
  private generation: number;
  private attempt = 0;
  private state: ConnectionState | undefined;
  private current: { abort: AbortController; close?: () => void | Promise<void> } | undefined;
  private activeHandle: { generation: number; stop: () => void } | undefined;

  constructor(private readonly options: ConnectionControllerOptions<Sink>) {
    this.config = { ...defaults, ...(options.config ?? {}) };
    this.generation = options.generationSeed ?? 0;
  }

  getSnapshot(): { generation: number; state?: ConnectionState; started: boolean } {
    return { generation: this.generation, state: this.state, started: this.running };
  }

  start(): { generation: number; stop: () => void } {
    if (this.activeHandle) return this.activeHandle;
    this.running = true;
    const handle = {
      generation: this.generation + 1,
      stop: () => this.stop(),
    };
    this.activeHandle = handle;
    void this.loop();
    return handle;
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    this.activeHandle = undefined;
    const current = this.current;
    this.current = undefined;
    current?.abort.abort();
    void current?.close?.();
    if (wasRunning) this.emitState("reconnecting");
  }

  private emitState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    try {
      this.options.onStateChange?.(state);
    } catch {
      // Connection lifecycle must not be terminated by a UI callback.
    }
  }

  private backoff(attempt: number): number {
    const cap = Math.min(this.config.backoffMaxMs, this.config.backoffBaseMs * this.config.backoffFactor ** Math.max(0, attempt - 1));
    return cap / 2 + Math.random() * cap / 2;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const generation = ++this.generation;
      const abort = new AbortController();
      let closed = false;
      let resolveDisconnected!: () => void;
      const disconnected = new Promise<void>((resolve) => { resolveDisconnected = resolve; });
      const disconnect = () => {
        if (closed) return;
        closed = true;
        resolveDisconnected();
      };
      this.current = { abort };
      let connection: Awaited<ReturnType<ConnectionCarrier<Sink>["open"]>> | undefined;
      try {
        connection = await this.options.carrier.open(abort.signal, (envelope) => {
          if (!closed && this.running && this.generation === generation) {
            try { this.options.onEnvelope?.(envelope, generation); } catch { /* isolate consumers */ }
          }
        }, disconnect);
        if (abort.signal.aborted || !this.running || closed) {
          await connection.close();
          return;
        }
        this.current.close = connection.close;
        this.attempt = 0;
        this.emitState("connected");
        try { this.options.onConnected?.(connection.description, generation); } catch { /* isolate consumers */ }
        await disconnected;
        await connection.close();
      } catch {
        disconnect();
        if (connection) await connection.close();
      } finally {
        if (this.current?.abort === abort) this.current = undefined;
      }
      if (!this.running) return;
      this.emitState("reconnecting");
      this.attempt += 1;
      const wait = new AbortController();
      await delay(this.backoff(this.attempt), wait.signal);
    }
  }
}
