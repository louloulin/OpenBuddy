import { createHash, randomUUID } from "node:crypto";
import {
  startMcpSignIn,
  completeMcpSignIn,
  listenForLoopbackSignIn,
  waitForLoopbackSignIn,
  McpSignInCancelledError,
  type McpOAuthState,
  type McpOAuthSettings,
  type McpOAuthServerStore,
} from "@earendil-works/pi-mcp/oauth";
import type { McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import type { Settings } from "../settings/settings.js";
import type { Emit } from "@openbuddy/kernel";
import { AuthAttemptStore, type AuthAttemptInfo } from "./auth-attempts.js";

/** Implements the SDK credential operations, with every state byte encrypted by safeStorage. */
export class EncryptedMcpCredentials {
  private refreshes = new Map<string, Promise<unknown>>();
  constructor(private settings: Settings) {}
  private key(name: string, url: string) {
    return `mcp-oauth:${createHash("sha256")
      .update(JSON.stringify([name, new URL(url).href]))
      .digest("hex")}`;
  }
  private load(name: string, url: string): McpOAuthState | undefined {
    const raw = this.settings.secrets.get(this.key(name, url));
    if (!raw) return undefined;
    const state = JSON.parse(raw) as McpOAuthState;
    return new URL(state.serverUrl).href === new URL(url).href
      ? state
      : undefined;
  }
  forServer(name: string, url: string): McpOAuthServerStore {
    const key = this.key(name, url);
    return {
      load: () => this.load(name, url),
      save: (state) => {
        if (new URL(state.serverUrl).href !== new URL(url).href)
          throw Error("OAuth server identity mismatch");
        this.settings.secrets.set(key, JSON.stringify(state));
      },
      withRefreshLock: async <T>(fn: () => Promise<T>): Promise<T> => {
        const previous = this.refreshes.get(key) ?? Promise.resolve();
        const work = previous.catch(() => {}).then(fn);
        this.refreshes.set(key, work);
        try {
          return await work;
        } finally {
          if (this.refreshes.get(key) === work) this.refreshes.delete(key);
        }
      },
    };
  }
  tokens(name: string, url: string) {
    return this.load(name, url)?.tokens;
  }
  remove(name: string, url: string) {
    const key = this.key(name, url),
      existed = this.settings.secrets.has(key);
    this.settings.secrets.set(key, undefined);
    return existed;
  }
  clearPending(name: string, url: string) {
    const state = this.load(name, url);
    if (!state) return;
    delete state.codeVerifier;
    delete state.oauthState;
    this.settings.secrets.set(this.key(name, url), JSON.stringify(state));
  }
  status(name: string, url: string) {
    const state = this.load(name, url);
    const expiresAt = state?.tokensExpireAt;
    return {
      serverName: name,
      status:
        state?.tokens?.access_token &&
        (expiresAt === undefined || expiresAt > Date.now())
          ? "authenticated"
          : "needs_auth",
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
  }
  asSdkCredentials(): NonNullable<McpExtensionOptions["credentials"]> {
    // The public option is nominally typed to an internal, unexported class. Its runtime
    // contract is precisely forServer/tokens/remove; use no non-public SDK import paths.
    return this as unknown as NonNullable<McpExtensionOptions["credentials"]>;
  }
}
export class McpAuthService {
  readonly credentials: EncryptedMcpCredentials;
  private pending = new Map<
    string,
    {
      sessionId: string;
      controller: AbortController;
      done: Promise<{ status: string; error?: string }>;
    }
  >();
  /** 授权尝试 (B3a): id + expiry + cancel, mirrored to the UI via `agent://mcp-auth`. */
  readonly attempts: AuthAttemptStore;
  constructor(
    private settings: Settings,
    private openUrl: (url: string) => Promise<void>,
    private emit: Emit,
    private timeoutMs = 120000,
  ) {
    this.credentials = new EncryptedMcpCredentials(settings);
    this.attempts = new AuthAttemptStore(Date.now, (info) => this.emit("agent://mcp-auth", info), timeoutMs);
  }
  status(name: string, url: string) {
    return this.credentials.status(name, url);
  }
  /** Start a sign-in without waiting; the attempt id is the UI's handle for countdown / cancel. */
  begin(
    sessionId: string,
    name: string,
    url: string,
    oauth: McpOAuthSettings = {},
  ): AuthAttemptInfo {
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
      )
    )
      throw Error("OAuth requires HTTPS except on loopback");
    if (this.pending.has(name)) throw Error("该 MCP 服务已有认证请求");
    const controller = new AbortController();
    const attempt = this.attempts.start({
      id: randomUUID(),
      sessionId,
      serverName: name,
      controller,
      ttlMs: this.timeoutMs,
    });
    const done = this.signIn(name, url, oauth, controller)
      .then((result) => {
        if (this.attempts.get(attempt.id)?.status === "pending") {
          if (result.status === "authenticated") this.attempts.settle(attempt.id, "authorized");
          else if (result.status === "failed") this.attempts.settle(attempt.id, "failed", result.error);
          // The store's timer aborts with "timeout"; anything else is a user/session cancel.
          else this.attempts.settle(attempt.id, controller.signal.reason === "timeout" ? "expired" : "cancelled");
        }
        return result;
      })
      .finally(() => this.pending.delete(name));
    this.pending.set(name, { sessionId, controller, done });
    return attempt;
  }
  trigger(
    sessionId: string,
    name: string,
    url: string,
    oauth: McpOAuthSettings = {},
  ): Promise<{ status: string; error?: string }> {
    const attempt = this.begin(sessionId, name, url, oauth);
    return this.pending.get(name)?.done ?? Promise.resolve({ status: "cancelled" });
  }
  attempt(id: string) {
    return this.attempts.get(id);
  }
  attemptsFor(sessionId?: string) {
    return this.attempts.list(sessionId);
  }
  cancelAttempt(id: string) {
    return this.attempts.cancel(id);
  }
  private async signIn(
    name: string,
    url: string,
    oauth: McpOAuthSettings,
    controller: AbortController,
  ) {
    const signal = controller.signal,
      store = this.credentials.forServer(name, url);
    let callback:
      | Awaited<ReturnType<typeof listenForLoopbackSignIn>>["callback"]
      | undefined;
    try {
      signal.throwIfAborted();
      const listener = await listenForLoopbackSignIn({
        serverUrl: url,
        store,
        settings: oauth,
      });
      callback = listener.callback;
      signal.throwIfAborted();
      const options = {
        serverUrl: url,
        store,
        settings: oauth,
        clientName: "OpenBuddy",
        redirectUrl: listener.redirectUrl,
        signal,
      };
      const authorization = await startMcpSignIn(options);
      if (authorization.kind === "redirect") {
        const responsePromise = waitForLoopbackSignIn({
          callback,
          authorization,
          signal,
        });
        // Arm state validation before opening the browser; a fast local redirect can race it.
        void responsePromise.catch(() => {});
        await this.openUrl(authorization.authorizationUrl);
        const response = await responsePromise;
        await completeMcpSignIn({ ...options, authorization, response });
      }
      this.emit("agent://mcp-status", {
        serverName: name,
        status: "authenticated",
      });
      return { status: "authenticated" };
    } catch (error) {
      if (signal.aborted || error instanceof McpSignInCancelledError)
        return { status: "cancelled" };
      return {
        status: "failed",
        error: String(
          this.settings.secrets.redact(
            error instanceof Error ? error.message : String(error),
          ),
        ),
      };
    } finally {
      try {
        await callback?.close();
      } finally {
        this.credentials.clearPending(name, url);
      }
    }
  }
  cancel(sessionId?: string) {
    for (const pending of this.pending.values())
      if (!sessionId || pending.sessionId === sessionId)
        pending.controller.abort("cancelled");
  }
  async settle() {
    await Promise.all([...this.pending.values()].map((p) => p.done));
  }
}
