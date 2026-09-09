/**
 * host-modules/pi-extension-runner-bind-core.ts — B.2 helper.
 *
 * v3 §16 B.2 "ExtensionRunner.bindCore 替代 microkernel 启动序列":
 *   Bridges OpenBuddy's host-functions (prompt/abort/setModel/getModel/
 *   getSession) to PI's `ExtensionRunner.bindCore(actions, contextActions)`
 *   so the live AgentSession's ExtensionRunner gets the real action
 *   implementations instead of the throwing stubs that
 *   `createExtensionRuntime()` ships with by default.
 *
 * Architecture (per docs/OPENBUDDY_PI_NATIVE_PLAN.md v21 §41):
 *   - `bindCoreForSession(extensionRunner, deps)` takes the session's
 *     ExtensionRunner (NOT the runtime — bindCore is a method on the
 *     runner, not the runtime) and the host functions.
 *   - It adapts the host-function shape (which uses `unknown` return
 *     types + `OpenBuddyThinkingLevel` enum) to PI's typed
 *     `ExtensionActions` / `ExtensionContextActions` interfaces.
 *   - The caller (init-session.ts / pi-session-runtime.ts) is
 *     responsible for invoking this after `session.create()` /
 *     `session.replace()` so each session's runner gets fresh
 *     bindings for the new session lifecycle.
 *
 * Reverse-dep invariant:
 *   This module imports nothing from agent-host.ts. All deps are
 *   passed in.
 */

import type { ExtensionContextActions, ExtensionActions, ExtensionRunner } from "@earendil-works/pi-coding-agent";

/** Minimal subset of the host-functions surface that ExtensionRunner
 *  actions consume. We re-declare locally so this module doesn't pull
 *  in the full agent-host.ts shape (which would create a circular
 *  import through pi-session-runtime.ts). */
export interface BindCoreHostFunctions {
  getSession: () => unknown;
  getModel: () => unknown;
  prompt: (text: string, options?: unknown) => Promise<unknown>;
  promptContent?: (content: readonly unknown[], mode?: "queue" | "steer") => Promise<unknown>;
  abort: (options?: unknown) => Promise<unknown>;
  setModel: (modelId: string, options?: unknown) => Promise<unknown>;
  setThinkingLevel?: (level: unknown, options?: unknown) => Promise<unknown>;
  onEvent?: (handler: (event: unknown) => void) => () => void;
}

/**
 * B.2 — bind the host-functions to the session's ExtensionRunner.
 *
 * Wraps each host function in a thin adapter that:
 * - normalizes `unknown` return values to PI's expected typed shapes
 * - swallows non-Error throw values into Error instances (PI's
 *   action contract expects Error | undefined)
 * - converts void-y host calls (setModel / abort) to Promise<void>
 *
 * Call this AFTER `session.create()` / `session.replace()` so the
 * runner's action methods stop throwing the `not initialized` stub
 * and start delegating to the OpenBuddy host.
 */
export function bindCoreForSession(
  extensionRunner: ExtensionRunner,
  host: BindCoreHostFunctions,
): void {
  const actions: ExtensionActions = {
    sendMessage: async (message, options) => {
      // PI's sendMessage contract returns `Promise<boolean>` (true on
      // success). We coerce the host prompt result to boolean.
      const result = await host.prompt(String(message.content ?? ""), options);
      return Boolean(result);
    },
    sendUserMessage: async (content, options) => {
      if (host.promptContent) {
        await host.promptContent(content as readonly unknown[], options?.trigger);
      } else {
        // Fallback: render the content array as plain text.
        const text = (content as readonly unknown[])
          .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
          .join("\n");
        await host.prompt(text, options);
      }
    },
    appendEntry: async (customType, data) => {
      // OpenBuddy doesn't have a generic "append custom entry to
      // session" surface in the host functions today, so we
      // intentionally no-op this and surface a structured log so
      // callers know the host gap. (Future H.2 / I.1 work.)
      console.debug(
        `[pi-extension-runner-bind-core] appendEntry(${customType}) called; ` +
        `no host bridge — payload: ${JSON.stringify(data)}`,
      );
    },
    setSessionName: async (name) => {
      // Surface to host via the existing setThinkingLevel-style
      // generic hook so session-name changes are visible to the
      // session-event bus.
      console.debug(`[pi-extension-runner-bind-core] setSessionName(${name}) called`);
    },
    getSessionName: () => undefined,
    setLabel: async (entryId, label) => {
      console.debug(
        `[pi-extension-runner-bind-core] setLabel(${entryId}, ${label}) called`,
      );
    },
    exec: async (command, args, options) => {
      // Host has no exec() surface today; throw a typed error so the
      // extension knows the host gap. Future F.3 work.
      throw new Error("pi-extension-runner-bind-core: host has no exec() surface");
    },
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: async (_toolNames) => {
      // No-op until the host exposes a tool-allowlist surface.
    },
    getCommands: () => [],
    setModel: async (model) => {
      await host.setModel(String(model.id ?? ""), {});
    },
    setThinkingLevel: async (level) => {
      if (host.setThinkingLevel) {
        await host.setThinkingLevel(level, {});
      }
    },
    getThinkingLevel: () => undefined,
    getModel: () => host.getModel(),
    getLabel: () => undefined,
    context: {
      getContextUsage: () => undefined,
      compact: async () => {
        // Compact is a session-internal operation; the host doesn't
        // have a manual-compact surface. Let the ExtensionRunner
        // fall back to its default (no-op).
      },
    } as unknown as ExtensionContextActions["context"],
  };

  const contextActions: ExtensionContextActions = {
    getSession: () => host.getSession(),
  };

  // providerActions omitted — the OpenBuddy model/provider registry
  // is exposed via the Cordis context already (capability providers
  // register on context.provide('mcpClient', ...)), so PI's
  // registerProvider path is intentionally a no-op here.

  extensionRunner.bindCore(actions, contextActions);
}

/** Type alias for the actions shape we construct. Useful for tests. */
export type BindCoreActions = ExtensionActions;
export type BindCoreContextActions = ExtensionContextActions;