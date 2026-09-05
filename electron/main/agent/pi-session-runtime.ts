import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

export type PiSessionEventHandler = (event: AgentSessionEvent, session: AgentSession) => void;

export interface PiSessionRuntimeFactory {
  create: (options: CreateAgentSessionOptions) => Promise<{ session: AgentSession }>;
}

export interface PiSessionRuntimeOptions {
  factory?: PiSessionRuntimeFactory;
}

export interface PiSessionRuntimeDisposeOptions {
  abort?: boolean;
}

/**
 * Owns the lifetime of OpenBuddy's primary Pi AgentSession.
 *
 * The host may keep a compatibility reference to the current session, but
 * creation, event attachment, and disposal must go through this boundary.
 * Generation checks make an event from a replaced session harmless even if a
 * Pi release delivers it after unsubscribe has been requested.
 */
export class PiSessionRuntime {
  private readonly factory: PiSessionRuntimeFactory;
  private current: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventHandler: PiSessionEventHandler | null = null;
  private generation = 0;

  constructor(options: PiSessionRuntimeOptions = {}) {
    this.factory = options.factory ?? { create: createAgentSession };
  }

  get session(): AgentSession | null {
    return this.current;
  }

  get sessionId(): string | undefined {
    return this.current?.sessionId;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  async create(options: CreateAgentSessionOptions): Promise<AgentSession> {
    if (this.current) throw new Error("pi-session-runtime: session is already active");
    const created = await this.factory.create(options);
    this.current = created.session;
    this.generation += 1;
    return created.session;
  }

  async replace(options: CreateAgentSessionOptions): Promise<AgentSession> {
    const created = await this.factory.create(options);
    const previous = this.current;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = created.session;
    this.generation += 1;
    if (this.eventHandler) this.attach(this.eventHandler);
    if (previous) {
      try {
        await previous.abort();
      } catch {
        // A replacement must remain usable even when the old turn cannot abort.
      }
      previous.dispose();
    }
    return created.session;
  }

  subscribe(handler: PiSessionEventHandler): () => void {
    if (!this.current) throw new Error("pi-session-runtime: session is not initialized");
    this.unsubscribe?.();
    this.eventHandler = handler;
    this.attach(handler);
    return () => {
      if (this.eventHandler !== handler) return;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.eventHandler = null;
    };
  }

  private attach(handler: PiSessionEventHandler): void {
    const session = this.current;
    if (!session) return;
    const generation = this.generation;
    const unsubscribe = session.subscribe((event) => {
      if (this.current !== session || this.generation !== generation) return;
      handler(event, session);
    });
    let active = true;
    let unsubscribeOnce: () => void;
    unsubscribeOnce = () => {
      if (!active) return;
      active = false;
      unsubscribe();
      if (this.unsubscribe === unsubscribeOnce) this.unsubscribe = null;
    };
    this.unsubscribe = unsubscribeOnce;
  }

  async dispose(options: PiSessionRuntimeDisposeOptions = {}): Promise<void> {
    const session = this.current;
    if (!session) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.eventHandler = null;
    this.current = null;
    this.generation += 1;
    if (options.abort !== false) {
      try {
        await session.abort();
      } catch {
        // The caller owns logging and may already have attempted abort.
      }
    }
    session.dispose();
  }
}
