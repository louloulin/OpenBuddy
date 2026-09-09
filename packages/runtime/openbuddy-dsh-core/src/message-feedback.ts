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
  deleteFeedbackEntry,
  feedbackEntryCount,
  feedbackSessionCount,
  listFeedbackEntries,
  putFeedbackEntry,
} from "./state";

export type { DshFeedbackEntry } from "./state";

/**
 * Phase B.3 step 2b — PI-native message-feedback state machine extension.
 *
 * Registers 3 slash commands (`feedback.list`, `feedback.put`,
 * `feedback.delete`). Session keying mirrors `goals.ts`: prefer
 * `ctx.sessionFallbackKey` if exposed by PI (B.3 step 3 will fully
 * bind this); fall back to `"current"` so the live
 * `discoverAndLoadExtensions()` path still works.
 */
export default function createDshMessageFeedbackExtension(): ExtensionFactory {
  return (api: ExtensionAPI): void => {
    const carrier: unknown = (api as unknown as {
      context?: { get?: (name: string) => unknown };
    }).context?.get?.("sessionFallbackKey");
    const fallback = typeof carrier === "string" ? carrier : "current";

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
  };
}