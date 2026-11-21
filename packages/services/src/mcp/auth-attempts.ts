/**
 * 授权尝试 (B3a): the host owns an attempt id, an expiry and a cancellation controller, so the
 * modal can show a countdown, copy the id for support, and closing it aborts the real Pi OAuth
 * sign-in instead of leaving a dangling loopback listener.
 *
 * The state machine is transport-agnostic on purpose: today it wraps the redirect + loopback flow
 * from `@earendil-works/pi-mcp/oauth`; a device-authorization endpoint can be plugged into the same
 * pending/authorized/failed/expired/cancelled surface when a server actually provides one.
 */
export type AuthAttemptStatus = "pending" | "authorized" | "failed" | "expired" | "cancelled";

export interface AuthAttemptInfo {
  id: string;
  sessionId: string;
  serverName: string;
  status: AuthAttemptStatus;
  startedAt: number;
  expiresAt: number;
  error?: string;
}

interface Stored {
  info: AuthAttemptInfo;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

export class AuthAttemptStore {
  private attempts = new Map<string, Stored>();
  constructor(
    private now: () => number = Date.now,
    private onChange?: (info: AuthAttemptInfo) => void,
    /** Default lifetime; a caller can override per attempt. */
    private defaultTtlMs = 120_000,
  ) {}

  start(input: { id: string; sessionId: string; serverName: string; controller: AbortController; ttlMs?: number }): AuthAttemptInfo {
    const startedAt = this.now();
    const info: AuthAttemptInfo = {
      id: input.id,
      sessionId: input.sessionId,
      serverName: input.serverName,
      status: "pending",
      startedAt,
      expiresAt: startedAt + (input.ttlMs ?? this.defaultTtlMs),
    };
    const stored: Stored = { info, controller: input.controller };
    // The expiry is real: it aborts the SDK flow and emits `expired` even if the UI is closed.
    stored.timer = setTimeout(() => {
      if (stored.info.status !== "pending") return;
      if (!input.controller.signal.aborted) input.controller.abort("timeout");
      this.settle(input.id, "expired");
    }, info.expiresAt - startedAt);
    stored.timer.unref?.();
    this.attempts.set(input.id, stored);
    this.onChange?.(info);
    return info;
  }

  get(id: string): AuthAttemptInfo | undefined {
    return this.attempts.get(id)?.info;
  }

  list(sessionId?: string): AuthAttemptInfo[] {
    return [...this.attempts.values()]
      .map((stored) => stored.info)
      .filter((info) => !sessionId || info.sessionId === sessionId);
  }

  settle(id: string, status: Exclude<AuthAttemptStatus, "pending">, error?: string): AuthAttemptInfo | undefined {
    const stored = this.attempts.get(id);
    if (!stored || stored.info.status !== "pending") return stored?.info;
    stored.info = { ...stored.info, status, ...(error ? { error } : {}) };
    if (stored.timer) clearTimeout(stored.timer);
    this.onChange?.(stored.info);
    return stored.info;
  }

  cancel(id: string): boolean {
    const stored = this.attempts.get(id);
    if (!stored || stored.info.status !== "pending") return false;
    stored.controller.abort("cancelled");
    this.settle(id, "cancelled");
    return true;
  }

  cancelSession(sessionId: string): number {
    let count = 0;
    for (const stored of this.attempts.values())
      if (stored.info.sessionId === sessionId && stored.info.status === "pending") {
        stored.controller.abort("cancelled");
        this.settle(stored.info.id, "cancelled");
        count += 1;
      }
    return count;
  }

  dispose() {
    for (const stored of this.attempts.values()) {
      if (stored.timer) clearTimeout(stored.timer);
      if (stored.info.status === "pending") stored.controller.abort("cancelled");
    }
    this.attempts.clear();
  }
}
