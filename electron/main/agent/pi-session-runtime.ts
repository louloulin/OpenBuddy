import {
  createAgentSession,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";

import {
  bindCoreForSession,
  type BindCoreHostFunctions,
} from "./host-modules/pi-extension-runner-bind-core";

export type PiSessionEventHandler = (event: AgentSessionEvent, session: AgentSession) => void;

export interface PiSessionRuntimeFactory {
  create: (options: CreateAgentSessionOptions) => Promise<{ session: AgentSession }>;
}

export interface PiSessionRuntimeOptions {
  factory?: PiSessionRuntimeFactory;
  /**
   * B.2 — host-functions bridge. When set, every new session
   * immediately calls `extensionRunner.bindCore(host)` so the
   * runner's action methods (sendMessage / setModel / etc.) stop
   * throwing the default `not initialized` stub and start
   * delegating to OpenBuddy's host functions. Set this from the
   * agent-host lifecycle hook when the host is ready.
   */
  hostBridge?: BindCoreHostFunctions;
}

export interface PiSessionRuntimeDisposeOptions {
  abort?: boolean;
}

/**
 * Owns the lifetime of OpenBuddy's primary Pi AgentSession.
 */
export class PiSessionRuntime {
  private readonly factory: PiSessionRuntimeFactory;
  private hostBridge: BindCoreHostFunctions | null;
  private current: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private eventHandler: PiSessionEventHandler | null = null;
  private generation = 0;

  constructor(options: PiSessionRuntimeOptions = {}) {
    this.factory = options.factory ?? { create: createAgentSession };
    this.hostBridge = options.hostBridge ?? null;
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
    if (this.current) {
      throw new Error("pi-session-runtime: session is already active");
    }
    const created = await this.factory.create(options);
    this.current = created.session;
    this.generation += 1;
    this.bindCoreIfReady();
    return created.session;
  }

  async replace(options: CreateAgentSessionOptions): Promise<AgentSession> {
    const created = await this.factory.create(options);
    const previous = this.current;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = created.session;
    this.generation += 1;
    this.bindCoreIfReady();
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

  /**
   * B.2 — if a hostBridge is installed, bind the new session's
   * ExtensionRunner to the OpenBuddy host-functions. Called
   * automatically from `create` and `replace`. Also exposed as a
   * public method so external code (e.g. an init-session hook that
   * wants to install a hostBridge AFTER the runtime was constructed)
   * can invoke it directly.
   */
  bindCoreIfReady(): void {
    if (!this.hostBridge || !this.current) return;
    try {
      bindCoreForSession(this.current.extensionRunner, this.hostBridge);
    } catch (error) {
      // bindCore failures shouldn't break session creation — the
      // extension runner will keep working with the default no-op
      // actions and the error is logged for diagnostics.
      console.warn(
        "[pi-session-runtime] bindCore failed; runner keeps default stubs:",
        error,
      );
    }
  }

  /**
   * B.2 — install a hostBridge after construction. Useful when the
   * host-functions surface isn't ready at PiSessionRuntime
   * construction time (e.g. awaiting Cordis context init).
   * If a session is already active, also invokes bindCore on the
   * current session so the live runner gets the real actions.
   */
  installHostBridge(hostBridge: BindCoreHostFunctions): void {
    (this as { hostBridge: BindCoreHostFunctions | null }).hostBridge = hostBridge;
    this.bindCoreIfReady();
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
