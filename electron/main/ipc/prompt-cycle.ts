/**
 * IPC surface — prompt cycle domain.
 *
 * Phase B.1 round 5 of docs/OPENBUDDY_PI_NATIVE_PLAN.md. Owns the
 * 16 handlers that live on the prompt-mutation critical path:
 *
 *   - `agent:prompt` / `agent:steer` / `agent:follow-up`
 *       Send text into the active Pi session; each registers an
 *       AbortController in `inflightAbortControllers` so `agent:abort`
 *       can cancel without round-tripping a controller through IPC.
 *   - `agent:abort` / `agent:abort-bash` / `agent:abort-retry`
 *       Cancel in-flight prompts, in-flight bash, and queued retries.
 *   - `agent:set-model` / `agent:set-thinking-level` /
 *     `agent:set-permission-mode` / `agent:set-steering-mode` /
 *     `agent:set-follow-up-mode` / `agent:set-auto-compaction` /
 *     `agent:set-auto-retry`
 *       Session-mode mutators that the renderer topbar drives
 *       directly (without going through `/`-commands).
 *   - `agent:compact` / `agent:fork-session`
 *       Long-running session operations that close over the same
 *       traceId envelope as `agent:prompt`.
 *   - `agent:prompt-content`
 *       Multimodal (text + image) prompt variant; the renderer
 *       Composer uses it for image paste / drag-drop.
 *
 * Why this stays in a single file: every handler here touches the
 * `inflightAbortControllers` Map and the `awaitExtensionsBound()`
 * guard. Splitting them across multiple files would force those
 * shared locals into the deps bag, which loses the per-handler
 * "register, clear, error-wrap" contract that the traceId envelope
 * relies on for log correlation.
 *
 * `agents_action` (a different domain, plugin-side) lives in
 * `./plugin.ts`.
 */
import { ipcMain } from "electron";

import { generateTraceId } from "@openbuddy/logging-shared";

import {
  hostDispatched,
  hostFailed,
  hostReceived,
} from "../agent/agent-host-log";
import {
  assertPolicyModelAllowed,
  optionalString,
  promptContent,
  publicPermissionMode,
  recordValue,
  requiredBoolean,
  requiredString,
  stringValue,
  thinkingLevel,
} from "./validation";
import type { AgentHostIpcDeps } from "./_agent-host-deps";

/**
 * AbortSignal plumbing for prompt / steer / follow-up.
 *
 * The most recent in-flight request per sessionId is registered here
 * so `agent:abort` can cancel it without the renderer needing to
 * round-trip a controller through the IPC channel (AbortSignal is
 * not structured-cloneable). The map is keyed by sessionId so
 * concurrent sessions each have their own cancel target. A handler
 * clears its own entry once the request resolves.
 *
 * Module-scope (not inside `registerPromptCycleIpc`) so the abort
 * handler can reach it.
 */
const inflightAbortControllers = new Map<string, AbortController>();

/**
 * Module-scope helper. Mutating IPCs (`agent:prompt`,
 * `agent:set-model`, `agent:prompt-content`, …) call this before
 * issuing their RPC so they don't race with the fire-and-forget
 * `bindExtensions` that runs after `rebindSession` /
 * `initialize`. Errors are swallowed (bind failures are non-fatal —
 * the session is still usable, just without extension hooks).
 *
 * Resolves the host's optional `extensionsBound()` Promise; if the
 * host hasn't published one (older agent-host facade), the optional
 * chain returns `undefined` and the await is skipped.
 */
const awaitExtensionsBound = async (deps: AgentHostIpcDeps): Promise<void> => {
  await deps.agentHost.extensionsBound()?.catch(() => undefined);
};

export function registerPromptCycleIpc(deps: AgentHostIpcDeps): void {
  const { agentHost, ensureAgentHost } = deps;

  ipcMain.handle("agent:prompt", async (_e, input: string | { sessionId?: string; text: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = typeof input === "string" ? undefined : recordValue(input, "agent:prompt payload");
    const sessionId = payload?.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    const activeSessionId = agentHost.getSession()?.sessionId;
    if (sessionId !== undefined && sessionId !== activeSessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const text = requiredString(typeof input === "string" ? input : payload?.text, "prompt");
    const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
    hostReceived("agent:prompt", traceId, sessionId);
    // A-5: register a per-request AbortController so agent:abort can
    // cancel the in-flight prompt. If an earlier prompt is still
    // running for the same session, abort it first (back-pressure).
    const key = activeSessionId ?? traceId;
    inflightAbortControllers.get(key)?.abort();
    const controller = new AbortController();
    inflightAbortControllers.set(key, controller);
    try {
      await awaitExtensionsBound(deps);
      await agentHost.prompt(text, { traceId, sessionId, signal: controller.signal });
      hostDispatched("agent:prompt", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:prompt", traceId, err);
      throw err;
    } finally {
      if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
    }
  });
  ipcMain.handle("agent:steer", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:steer payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:steer", traceId, sessionId);
    const key = sessionId ?? traceId;
    inflightAbortControllers.get(key)?.abort();
    const controller = new AbortController();
    inflightAbortControllers.set(key, controller);
    try {
      await awaitExtensionsBound(deps);
      await agentHost.steer(requiredString(payload.text, "text"), { traceId, sessionId, signal: controller.signal });
      hostDispatched("agent:steer", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:steer", traceId, err);
      throw err;
    } finally {
      if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
    }
  });
  ipcMain.handle("agent:follow-up", async (_e, input: { sessionId?: string; text: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:follow-up payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:follow-up", traceId, sessionId);
    const key = sessionId ?? traceId;
    inflightAbortControllers.get(key)?.abort();
    const controller = new AbortController();
    inflightAbortControllers.set(key, controller);
    try {
      await awaitExtensionsBound(deps);
      await agentHost.followUp(requiredString(payload.text, "text"), { traceId, sessionId, signal: controller.signal });
      hostDispatched("agent:follow-up", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:follow-up", traceId, err);
      throw err;
    } finally {
      if (inflightAbortControllers.get(key) === controller) inflightAbortControllers.delete(key);
    }
  });
  ipcMain.handle("agent:abort", async (_e, input?: { sessionId?: string; traceId?: string }) => {
    await ensureAgentHost();
    let sessionId: string | undefined;
    const traceId = optionalString(input?.traceId, "traceId") ?? generateTraceId();
    if (input !== undefined) {
      const payload = recordValue(input, "agent:abort payload");
      sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
      if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    }
    hostReceived("agent:abort", traceId, sessionId);
    // A-5: abort the in-flight controller for this session (or traceId)
    // and delegate the heavier abort to the existing agentHost.abort.
    const key = sessionId ?? agentHost.getSession()?.sessionId ?? traceId;
    const inflight = inflightAbortControllers.get(key);
    inflight?.abort();
    if (inflight) inflightAbortControllers.delete(key);
    try {
      await awaitExtensionsBound(deps);
      await agentHost.abort({ traceId, sessionId });
      hostDispatched("agent:abort", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:abort", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:set-model", async (_e, input: string | { sessionId?: string; modelId: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = typeof input === "string" ? undefined : recordValue(input, "agent:set-model payload");
    const sessionId = payload?.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const modelId = requiredString(typeof input === "string" ? input : payload?.modelId, "modelId");
    const traceId = optionalString((typeof input === "string" ? undefined : payload?.traceId), "traceId") ?? generateTraceId();
    hostReceived("agent:set-model", traceId, sessionId);
    try {
      await awaitExtensionsBound(deps);
      await assertPolicyModelAllowed(modelId);
      await agentHost.setModel(modelId, { traceId, sessionId });
      hostDispatched("agent:set-model", traceId, sessionId);
      return { ok: true, model: agentHost.getModel() };
    } catch (err) {
      hostFailed("agent:set-model", traceId, err);
      throw err;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Phase 8.3 Batch D-11 — pi-web RPC API parity.
  // Each handler below corresponds to one method on the pi-web
  // `RpcClient` (see node_modules/@earendil-works/pi-coding-agent/dist/
  // modes/rpc/rpc-client.d.ts). The agentHost facade forwards them
  // to `host-modules/pi-session-capabilities.ts`.
  // ─────────────────────────────────────────────────────────────────

  ipcMain.handle("agent:compact", async (_e, input?: { sessionId?: string; customInstructions?: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = input === undefined ? {} : recordValue(input, "agent:compact payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:compact", traceId, sessionId);
    try {
      await awaitExtensionsBound(deps);
      const customInstructions = payload.customInstructions === undefined ? undefined : optionalString(payload.customInstructions, "customInstructions");
      const result = await agentHost.compact(customInstructions);
      hostDispatched("agent:compact", traceId, sessionId);
      return { ok: true, result };
    } catch (err) {
      hostFailed("agent:compact", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:set-auto-compaction", async (_e, input: { sessionId?: string; enabled: boolean; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:set-auto-compaction payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:set-auto-compaction", traceId, sessionId);
    try {
      agentHost.setAutoCompaction(requiredBoolean(payload.enabled, "enabled"));
      hostDispatched("agent:set-auto-compaction", traceId, sessionId);
      return { ok: true, enabled: requiredBoolean(payload.enabled, "enabled") };
    } catch (err) {
      hostFailed("agent:set-auto-compaction", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:set-auto-retry", async (_e, input: { sessionId?: string; enabled: boolean; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:set-auto-retry payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:set-auto-retry", traceId, sessionId);
    try {
      agentHost.setAutoRetry(requiredBoolean(payload.enabled, "enabled"));
      hostDispatched("agent:set-auto-retry", traceId, sessionId);
      return { ok: true, enabled: requiredBoolean(payload.enabled, "enabled") };
    } catch (err) {
      hostFailed("agent:set-auto-retry", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:abort-retry", async (_e, input?: { sessionId?: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = input === undefined ? {} : recordValue(input, "agent:abort-retry payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:abort-retry", traceId, sessionId);
    try {
      agentHost.abortRetry();
      hostDispatched("agent:abort-retry", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:abort-retry", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:abort-bash", async (_e, input?: { sessionId?: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = input === undefined ? {} : recordValue(input, "agent:abort-bash payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:abort-bash", traceId, sessionId);
    try {
      agentHost.abortBash();
      hostDispatched("agent:abort-bash", traceId, sessionId);
      return { ok: true };
    } catch (err) {
      hostFailed("agent:abort-bash", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:set-steering-mode", async (_e, input: { sessionId?: string; mode: "all" | "one-at-a-time"; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:set-steering-mode payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:set-steering-mode", traceId, sessionId);
    try {
      agentHost.setSteeringMode(stringValue(payload.mode, "mode") as "all" | "one-at-a-time");
      hostDispatched("agent:set-steering-mode", traceId, sessionId);
      return { ok: true, mode: payload.mode };
    } catch (err) {
      hostFailed("agent:set-steering-mode", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:set-follow-up-mode", async (_e, input: { sessionId?: string; mode: "all" | "one-at-a-time"; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:set-follow-up-mode payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    hostReceived("agent:set-follow-up-mode", traceId, sessionId);
    try {
      agentHost.setFollowUpMode(stringValue(payload.mode, "mode") as "all" | "one-at-a-time");
      hostDispatched("agent:set-follow-up-mode", traceId, sessionId);
      return { ok: true, mode: payload.mode };
    } catch (err) {
      hostFailed("agent:set-follow-up-mode", traceId, err);
      throw err;
    }
  });
  ipcMain.handle("agent:fork-session", async (_e, input: { sessionId?: string; entryId: string; traceId?: string }) => {
    await ensureAgentHost();
    const payload = recordValue(input, "agent:fork-session payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    const entryId = requiredString(payload.entryId, "entryId");
    hostReceived("agent:fork-session", traceId, sessionId);
    try {
      const result = await agentHost.forkSession(entryId);
      hostDispatched("agent:fork-session", traceId, sessionId);
      return result;
    } catch (err) {
      hostFailed("agent:fork-session", traceId, err);
      throw err;
    }
  });

  // R1 — content-based prompt (text + image). Mirrors the renderer
  // `piSendContent` surface. The session-bound guard matches
  // `agent:prompt` and the same trace telemetry envelope (received →
  // dispatched / failed) is reused so log queries stay uniform.
  ipcMain.handle("agent:prompt-content", async (_e, input: { sessionId?: string; content: Array<{ type: "text"; text: string } | { type: "image"; mediaType: string; data: string; name?: string }>; mode?: "queue" | "steer"; traceId?: string }) => {
    const payload = recordValue(input, "agent:prompt-content payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    const content = promptContent(payload.content, "content");
    hostReceived("agent:prompt-content", traceId, sessionId);
    try {
      // Reuse the existing promptContent IPC bridge in the harness RPC
      // router. The agent-host wrapper does the typed dispatch and
      // re-validates the content shape, so we go through `session.prompt`
      // (available via dispatchHarnessRpc) rather than re-implementing.
      const ctx = agentHost.getContext() as { get?: (k: string) => { promptContent?: (parts: readonly unknown[], mode?: "queue" | "steer") => Promise<{ itemId?: string }> } | undefined } | undefined;
      const piSession = ctx?.get?.("piSession");
      if (!piSession?.promptContent) throw new Error("Pi session prompt is unavailable");
      await awaitExtensionsBound(deps);
      const result = await piSession.promptContent(content, payload.mode === "steer" ? "steer" : "queue");
      hostDispatched("agent:prompt-content", traceId, sessionId);
      return { ok: true, itemId: result?.itemId };
    } catch (err) {
      hostFailed("agent:prompt-content", traceId, err);
      throw err;
    }
  });

  // R1 — set thinking level (off / low / medium / high). Pi persists
  // thinking_level_change to the session tree; we expose it as a
  // top-level IPC so the renderer topbar segmented control can drive
  // it without going through a command.
  ipcMain.handle("agent:set-thinking-level", async (_e, input: { sessionId?: string; level: "off" | "low" | "medium" | "high"; traceId?: string }) => {
    const payload = recordValue(input, "agent:set-thinking-level payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    const level = thinkingLevel(payload.level, "level");
    hostReceived("agent:set-thinking-level", traceId, sessionId);
    try {
      const ctx = agentHost.getContext() as { get?: (k: string) => { setThinkingLevel?: (l: "off" | "low" | "medium" | "high") => Promise<"off" | "low" | "medium" | "high"> } | undefined } | undefined;
      const piSession = ctx?.get?.("piSession");
      if (!piSession?.setThinkingLevel) throw new Error("Pi session setThinkingLevel is unavailable");
      // Pi clamps the requested level to the active model's capabilities,
      // so the returned value may differ from the requested one (e.g.
      // "high" downgraded to "medium"). Surface the *actual* level so the
      // renderer's optimistic UI and the persisted session entry stay in
      // sync.
      const applied = await piSession.setThinkingLevel(level);
      hostDispatched("agent:set-thinking-level", traceId, sessionId);
      return { ok: true, level: applied };
    } catch (err) {
      hostFailed("agent:set-thinking-level", traceId, err);
      throw err;
    }
  });

  // R1 — set public permission mode (default / acceptEdits / dontAsk /
  // plan / bypassPermissions). Mirrors Pi's `setMode`. The Cordis-
  // backed permission store (openbuddy/auth-permission) is the single
  // source of truth on disk; the in-memory mode is wired through the
  // same plugin so that Pi's tool interceptor and the OpenBuddy
  // permission rules see a consistent view.
  ipcMain.handle("agent:set-permission-mode", async (_e, input: { sessionId?: string; mode: "default" | "acceptEdits" | "dontAsk" | "plan" | "bypassPermissions"; traceId?: string }) => {
    const payload = recordValue(input, "agent:set-permission-mode payload");
    const sessionId = payload.sessionId === undefined ? undefined : requiredString(payload.sessionId, "sessionId");
    if (sessionId !== undefined && sessionId !== agentHost.getSession()?.sessionId) throw new Error(`Pi session is not loaded: ${sessionId}`);
    const traceId = optionalString(payload.traceId, "traceId") ?? generateTraceId();
    const mode = publicPermissionMode(payload.mode, "mode");
    hostReceived("agent:set-permission-mode", traceId, sessionId);
    try {
      const handlers = (await import("@openbuddy/auth-permission")).permissionHandlers;
      // writeMode takes the PermissionMode string directly (not an object).
      handlers.writeMode(mode as never);
      hostDispatched("agent:set-permission-mode", traceId, sessionId);
      return { ok: true, mode };
    } catch (err) {
      hostFailed("agent:set-permission-mode", traceId, err);
      throw err;
    }
  });
}
