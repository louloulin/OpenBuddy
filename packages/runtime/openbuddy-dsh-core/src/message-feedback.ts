/**
 * @openbuddy/dsh-core/message-feedback — PI-native message-feedback extension.
 *
 * Phase B.3 step 2b of docs/OPENBUDDY_PI_NATIVE_PLAN.md (v13 §33.2):
 *   Extracts the per-session message-feedback state machine (formerly in
 *   `electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts`)
 *   into a standalone PI ExtensionFactory. Reads / writes the SHARED
 *   state maps from `@openbuddy/dsh-core/state` so the Cordis-bound
 *   `ctx.dshRemotes` API and the PI `feedback.*` commands stay consistent.
 *
 * v6 §24.4 step 2b: this file replaces the legacy
 * `@deepseek-ai/dsh-message-feedback` string specifier that used to
 * resolve through DSH `resolveDeepSeekModule()` to a local shim.
 *
 * PI ExtensionFactory shape (per `@earendil-works/pi-coding-agent`):
 *   `default export: (api: ExtensionAPI) => void | Promise<void>`
 */

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  bulkPutFeedbackEntries,
  deleteFeedbackEntry,
  feedbackEntryCount,
  feedbackSessionCount,
  listFeedbackEntries,
  putFeedbackEntry,
  searchFeedbackEntries,
  sessionKey,
  sessionSummary,
} from "./state";

export type { DshFeedbackEntry } from "./state";

/**
 * B.3 step 3 — explicit session-bound factory. Returns an
 * ExtensionFactory pre-bound to a specific session ID. The implicit
 * createDshMessageFeedbackExtension() (no args) is kept for backward
 * compatibility — it relies on sessionFallbackKey from the
 * ExtensionAPI context.
 */
export function createDshMessageFeedbackExtensionForSession(sessionId: string): ExtensionFactory {
  return (_api: ExtensionAPI): void => {
    const carrier = { sessionId };
    const fallback = sessionKey(carrier, "current");
    registerFeedbackCommands(_api, carrier, fallback);
  };
}

/**
 * Phase B.3 step 2b — PI-native message-feedback state machine extension.
 *
 * Registers 6 slash commands (`feedback.list / stats / search /
 * session-summary / put / delete`). Session keying mirrors
 * `goals.ts`: prefer `ctx.sessionFallbackKey` if exposed by PI
 * (B.3 step 3 will fully bind this); fall back to `"current"` so
 * the live `discoverAndLoadExtensions()` path still works.
 */
export default function createDshMessageFeedbackExtension(): ExtensionFactory {
  return (api: ExtensionAPI): void => {
    const carrier: unknown = (api as unknown as {
      context?: { get?: (name: string) => unknown };
    }).context?.get?.("sessionFallbackKey");
    const fallback = typeof carrier === "string" ? carrier : "current";
    registerFeedbackCommands(api, carrier, fallback);
  };
}

/**
 * B.3 step 3 — shared registration helper. Both the implicit
 * createDshMessageFeedbackExtension() and the explicit
 * createDshMessageFeedbackExtensionForSession() call this helper.
 * Same pattern as goals.ts so the two entry points share the same
 * command list without duplicating the 6 registerCommand calls.
 */
function registerFeedbackCommands(api: ExtensionAPI, carrier: unknown, fallback: string): void {
  const commands = api as unknown as {
    registerCommand?: (spec: {
      name: string;
      description: string;
      handler: (args: unknown) => Promise<unknown> | unknown;
    }) => void;
  };

  commands.registerCommand?.({
    name: "feedback.list",
    description: "List message-feedback entries for the active session.",
    handler: async (args) => listFeedbackEntries((args ?? {}) as { sessionId?: string }, fallback),
  });

  commands.registerCommand?.({
    name: "feedback.stats",
    description: "Return message-feedback surface stats: { sessions, entries } across every session.",
    handler: async () => ({
      sessions: feedbackSessionCount(),
      entries: feedbackEntryCount(),
    }),
  });

  commands.registerCommand?.({
    name: "feedback.search",
    description: "Search feedback entries by case-insensitive substring of rating or note (Phase C.3).",
    handler: async (args) => {
      const typed = (args ?? {}) as { query?: string; sessionId?: string };
      const query = typeof typed.query === "string" ? typed.query : "";
      return searchFeedbackEntries(
        query,
        typed.sessionId ? { sessionId: typed.sessionId } : undefined,
      );
    },
  });

  commands.registerCommand?.({
    name: "feedback.session-summary",
    description: "Return the goal (if any) + feedback entries for the active session in a single call (Phase C.3).",
    handler: async () => sessionSummary(carrier, fallback),
  });

  commands.registerCommand?.({
    name: "feedback.bulk-put",
    description: "Atomically put multiple feedback entries for the active session in one transaction (Phase C.3 follow-up).",
    handler: async (args) => {
      const typed = (args ?? {}) as { entries?: Array<{ messageId: string; rating: string; note?: string; ifVersion?: number | null }> };
      return bulkPutFeedbackEntries(typed.entries ?? [], fallback);
    },
  });

  commands.registerCommand?.({
    name: "feedback.put",
    description: "Submit a message-feedback entry.",
    handler: async (args) => putFeedbackEntry((args ?? {}) as {
      sessionId?: string;
      messageId: string;
      rating: string;
      note?: string;
      ifVersion?: number | null;
    }, fallback),
  });

  commands.registerCommand?.({
    name: "feedback.delete",
    description: "Delete a message-feedback entry.",
    handler: async (args) => deleteFeedbackEntry((args ?? {}) as {
      sessionId?: string;
      messageId: string;
      ifVersion?: number | null;
    }, fallback),
  });
}