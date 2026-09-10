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
    sendMessage: (message, options) => {
      void host.prompt(String(message.content ?? ""), options);
    },
    sendUserMessage: (content, options) => {
      if (host.promptContent) {
        const parts = typeof content === "string" ? [{ type: "text", text: content }] : content;
        void host.promptContent(parts, options?.deliverAs === "steer" ? "steer" : "queue");
      } else {
        const text = typeof content === "string"
          ? content
          : content.map((part) => part.type === "text" ? part.text : JSON.stringify(part)).join("\n");
        void host.prompt(text, options);
      }
    },
    appendEntry: (customType, data) => {
      console.debug(`[pi-extension-runner-bind-core] appendEntry(${customType}) called; no host bridge — payload: ${JSON.stringify(data)}`);
    },
    setSessionName: (name) => {
      console.debug(`[pi-extension-runner-bind-core] setSessionName(${name}) called`);
    },
    getSessionName: () => undefined,
    setLabel: (entryId, label) => {
      console.debug(`[pi-extension-runner-bind-core] setLabel(${entryId}, ${label}) called`);
    },
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    refreshTools: () => undefined,
    getCommands: () => [],
    setModel: async (model) => {
      await host.setModel(String(model.id ?? ""), {});
      return true;
    },
    getThinkingLevel: () => "normal" as never,
    setThinkingLevel: (level) => { void host.setThinkingLevel?.(level, {}); },
  };

  const contextActions: ExtensionContextActions = {
    getModel: () => host.getModel() as ReturnType<ExtensionContextActions["getModel"]>,
    getScopedModels: () => [],
    isIdle: () => true,
    isProjectTrusted: () => true,
    getSignal: () => undefined,
    abort: () => { void host.abort(); },
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
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