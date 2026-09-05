/**
 * pi-tool-bridge.ts — convert compatibilityAdapter invokeInvocation handlers
 * into real pi ExtensionAPI tool registrations.
 *
 * Stage G-1d (2026-09-02): each adapter with an `invokeInvocation` now also
 * registers a `pi.registerTool` call so the LLM can reach the canonical
 * OpenBuddy service from inside the agent loop. Before G-1d, the adapter
 * only registered `pi.registerCommand`, which is only useful for slash
 * commands invoked by humans — the LLM never saw those capabilities as
 * tools. This bridge closes that gap so the open-source WorkBuddy actually
 * wires its preserved Cordis services into pi's tool registry.
 *
 * The bridge serializes typed tool-call arguments back into the legacy
 * `${verb} ${rest}` string form the existing `invokeXxxCommand` handlers
 * expect, so the existing business logic stays the single source of truth.
 * Adapters opt in by adding a `tools` array to their `PiCompatibilityAdapter`
 * entry; the resolver reads it when wiring the factory.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "@earendil-works/pi-ai";

export interface AdapterToolSpec<TParams extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParams;
  /**
   * Convert typed tool-call args back to the legacy command-args string
   * the existing invokeInvocation handler parses (e.g. "pin s-1"). Returns
   * just the verb when no positional argument is required.
   *
   * Accepts `unknown` because TypeBox's `Static<TParams>` collapses to
   * `unknown` for nested Union/Optional schemas; callers narrow inside
   * the lambda so the bridge stays free of TypeBox-specific typing.
   */
  serializeArgs: (args: unknown) => string;
}

export interface AdapterToolContext {
  cwd?: string;
  /** Pi session id; flows through to invoke handlers that need a session key. */
  sessionId?: string;
  /**
   * Read-only SessionManager shim exposing `getSessionId()` so legacy
   * `invokeXxxCommand` handlers written against `CompatibilityCommandContext`
   * (slash-command path) keep working on the tool path without a parallel
   * rewrite. The shim is synthetic; it always returns the resolved
   * session id and never throws.
   */
  sessionManager?: { getSessionId?: () => string };
}

export interface RegisterAdapterToolOptions {
  invokeInvocation: (service: unknown, args: string, context: AdapterToolContext) => Promise<string | undefined>;
  resolveService: () => unknown;
}

/**
 * Register a single tool on the given pi ExtensionAPI. No-ops when the
 * runtime does not expose `registerTool` (older pi builds, RPC stubs in
 * tests that only mock `registerCommand`).
 */
export function registerAdapterTool<TParams extends TSchema>(
  pi: ExtensionAPI,
  spec: AdapterToolSpec<TParams>,
  options: RegisterAdapterToolOptions,
): void {
  if (typeof pi.registerTool !== "function") return;
  pi.registerTool({
    name: spec.name,
    label: spec.name.replace(/_/g, " "),
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, args, _signal, _onUpdate, ctx) => {
      const service = options.resolveService();
      const argString = spec.serializeArgs(args);
      const context = buildContextFromExtension(ctx);
      try {
        const summary = await options.invokeInvocation(service, argString, context);
        const text = summary ?? "OpenBuddy adapter tool completed without text summary.";
        return {
          content: [{ type: "text", text }],
          details: { ok: true, summary: text, capability: spec.name },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `OpenBuddy adapter tool ${spec.name} failed: ${message}` }],
          details: { ok: false, error: message, capability: spec.name },
        };
      }
    },
  });
}

/**
 * Register a "passthrough-fallback" tool that surfaces a human-readable
 * explanation to the LLM when the upstream Pi package is not installed.
 * Used for adapters whose adapter-side surface is pure passthrough
 * (e.g. `plan` → pi-plan-mode): the LLM still gets a tool it can call,
 * but the response explains how to install / enable the upstream package
 * instead of trying to dispatch into a non-existent Cordis service.
 *
 * Distinct from `registerAdapterTool`: there is no `invokeInvocation` —
 * the describe handler produces the entire response body.
 */
export function registerDescribeFallbackTool<TParams extends TSchema>(
  pi: ExtensionAPI,
  spec: AdapterToolSpec<TParams> & {
    describeInvocation: (service: unknown, args: string) => string | Promise<string>;
    resolveService: () => unknown;
  },
): void {
  if (typeof pi.registerTool !== "function") return;
  pi.registerTool({
    name: spec.name,
    label: spec.name.replace(/_/g, " "),
    description: spec.description,
    parameters: spec.parameters,
    execute: async (_toolCallId, args, _signal, _onUpdate, _ctx) => {
      const service = spec.resolveService();
      try {
        const text = await spec.describeInvocation(service, spec.serializeArgs(args));
        return {
          content: [{ type: "text", text }],
          details: { ok: true, summary: text, capability: spec.name, fallback: true },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `OpenBuddy adapter tool ${spec.name} failed: ${message}` }],
          details: { ok: false, error: message, capability: spec.name, fallback: true },
        };
      }
    },
  });
}

/**
 * Project the pi `ExtensionContext` down to the minimal
 * `CompatibilityCommandContext` shape the legacy invokeInvocation handlers
 * need. `cwd` flows through so workspace-scoped services see the right
 * root; `sessionManager.getSessionId()` is exposed when the runtime
 * provides a read-only session manager so session-scoped verbs (e.g. task
 * management) can target the active session instead of failing with
 * "Pi session id is unavailable".
 */
function buildContextFromExtension(ctx: ExtensionContext | undefined): AdapterToolContext {
  const sessionManager = ctx?.sessionManager as { getSessionId?: () => string } | undefined;
  let sessionId: string | undefined;
  if (sessionManager && typeof sessionManager.getSessionId === "function") {
    try {
      const candidate = sessionManager.getSessionId();
      sessionId = typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
    } catch {
      sessionId = undefined;
    }
  }
  // Synthetic shim that always returns the resolved id (never throws) so
  // legacy `requireSessionId(context)` calls on the slash-command path
  // keep reading a valid value on the tool path too.
  const shim = sessionId ? { getSessionId: () => sessionId as string } : undefined;
  return {
    cwd: typeof ctx?.cwd === "string" ? ctx.cwd : undefined,
    sessionId,
    sessionManager: shim,
  };
}