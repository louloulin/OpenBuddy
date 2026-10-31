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
  /**
   * 计划 0.3 — 切走时仍在生成的会话"停到后台"继续跑完,而不是被中止。
   * 事件照常交给同一个 handler(各事件自带 sessionId,渲染层按会话分流);
   * 跑完自动释放;切回来时直接接回这个实例,不再从文件新建第二份。
   */
  private readonly parked = new Map<string, { session: AgentSession; unsubscribe: () => void }>();
  private readonly restored = new WeakSet<AgentSession>();

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
    const targetId = sessionIdOf(options.sessionManager);
    const parked = targetId ? this.parked.get(targetId) : undefined;
    let next: AgentSession;
    if (parked && targetId) {
      parked.unsubscribe();
      this.parked.delete(targetId);
      this.restored.add(parked.session);
      next = parked.session;
    } else {
      next = (await this.factory.create(options)).session;
    }
    const previous = this.current;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.current = next;
    this.generation += 1;
    if (!parked) this.bindCoreIfReady();
    if (this.eventHandler) this.attach(this.eventHandler);
    if (previous && previous !== next) {
      if (previous.isStreaming && this.eventHandler) {
        this.park(previous, this.eventHandler);
      } else {
        try {
          await previous.abort();
        } catch {
          // A replacement must remain usable even when the old turn cannot abort.
        }
        previous.dispose();
      }
    }
    return next;
  }

  /** `replace()` 接回的是后台里那个已经绑定过扩展的实例(调用方不要重复绑定)。 */
  wasRestored(session: AgentSession): boolean {
    return this.restored.has(session);
  }

  private park(session: AgentSession, handler: PiSessionEventHandler): void {
    const sessionId = session.sessionId;
    const unsubscribe = session.subscribe((event) => {
      handler(event, session);
      // agent_end 之后还可能有自动压缩 / 重试等收尾,等真正空闲再释放。
      if (event.type === "agent_end") setTimeout(() => this.releaseParked(sessionId, session), 0);
    });
    this.parked.set(sessionId, { session, unsubscribe });
  }

  private releaseParked(sessionId: string, session: AgentSession): void {
    const entry = this.parked.get(sessionId);
    if (!entry || entry.session !== session || session.isStreaming) return;
    entry.unsubscribe();
    this.parked.delete(sessionId);
    session.dispose();
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
    this.hostBridge = hostBridge;
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
    // 整体重建(换工作区 / 预设)时后台会话依赖的上下文也要换掉:先中止
    // (事件仍会送达,渲染层据此收尾),再释放。
    for (const [sessionId, entry] of [...this.parked]) {
      this.parked.delete(sessionId);
      try {
        await entry.session.abort();
      } catch {
        // Best effort: the session is being torn down either way.
      }
      entry.unsubscribe();
      entry.session.dispose();
    }
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

function sessionIdOf(sessionManager: unknown): string | undefined {
  const getter = (sessionManager as { getSessionId?: () => unknown } | undefined)?.getSessionId;
  if (typeof getter !== "function") return undefined;
  try {
    const id = getter.call(sessionManager);
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}
