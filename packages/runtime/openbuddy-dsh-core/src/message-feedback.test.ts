/**
 * @openbuddy/dsh-core/message-feedback — Phase B.3 step 2b tests.
 *
 * Verifies the message-feedback state machine extracted from
 * electron/main/agent/host-modules/bootstrap/wire-dsh-services.ts
 * now lives as a standalone PI ExtensionFactory. Same shape as
 * goals.test.ts — see that file for the shared-state rationale.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import createDshMessageFeedbackExtension from "./message-feedback";
import {
  __resetDshCoreStateForTests,
  feedbackEntryCount,
  feedbackSessionCount,
  listFeedbackEntries,
  putFeedbackEntry,
  searchFeedbackEntries,
  sessionSummary,
} from "./state";

interface CapturedCommand {
  name: string;
  description: string;
  handler: (args: unknown) => Promise<unknown> | unknown;
}

function buildMockApi(sessionId: string): {
  api: ExtensionAPI;
  commands: Map<string, CapturedCommand>;
} {
  const commands = new Map<string, CapturedCommand>();
  const ctx = {
    ui: {} as ExtensionContext["ui"],
    mode: "rpc" as ExtensionMode,
    hasUI: false,
    cwd: "/work",
    get: (name: string) => (name === "sessionFallbackKey" ? sessionId : undefined),
  } as unknown as ExtensionContext;
  const api = {
    on: () => undefined,
    registerCommand: (spec: CapturedCommand) => {
      commands.set(spec.name, spec);
      return undefined;
    },
    registerTool: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    setActiveTools: () => undefined,
    setModel: () => undefined,
    setThinkingLevel: () => undefined,
    setLabel: () => undefined,
    getCommands: () => [],
    getAllTools: () => [],
    getActiveTools: () => [],
    getCommand: (name: string) => commands.get(name),
    getThinkingLevel: () => undefined,
    getModel: () => undefined,
    getLabel: () => undefined,
    context: ctx,
  } as unknown as ExtensionAPI;
  return { api, commands };
}

describe("@openbuddy/dsh-core/message-feedback (Phase B.3 step 2b)", () => {
  beforeEach(() => {
    __resetDshCoreStateForTests();
  });

  it("registers 6 feedback.* commands on init (Phase C.2: + feedback.stats, Phase C.3: + feedback.search + feedback.session-summary)", () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-1");
    factory(api);
    expect(commands.has("feedback.list")).toBe(true);
    expect(commands.has("feedback.put")).toBe(true);
    expect(commands.has("feedback.delete")).toBe(true);
    expect(commands.has("feedback.stats")).toBe(true);
    expect(commands.has("feedback.search")).toBe(true);
    expect(commands.has("feedback.session-summary")).toBe(true);
  });

  it("feedback.put + feedback.list round-trip via the shared state map", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-2");
    factory(api);
    const put = (await commands.get("feedback.put")!.handler({
      messageId: "msg-1",
      rating: "thumbs-up",
    })) as { messageId: string; version: number };
    expect(put.version).toBe(1);

    const list = (await commands.get("feedback.list")!.handler({})) as Array<{ messageId: string; version: number }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.messageId).toBe("msg-1");
    expect(list[0]?.version).toBe(1);

    // Round-trip through the shared map (state.ts direct call):
    const direct = listFeedbackEntries({}, "session-2");
    expect(direct).toHaveLength(1);
    expect(direct[0]?.rating).toBe("thumbs-up");
  });

  it("feedback.put enforces optimistic concurrency via ifVersion", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-3");
    factory(api);
    await commands.get("feedback.put")!.handler({ messageId: "msg-1", rating: "ok" });
    // ifVersion 0 (null) — works again because previous.version is now 1.
    await expect(
      commands.get("feedback.put")!.handler({
        messageId: "msg-1",
        rating: "wrong",
        ifVersion: 0,
      }),
    ).rejects.toThrow(/feedback version conflict/);
    // ifVersion 1 — should succeed.
    const next = (await commands.get("feedback.put")!.handler({
      messageId: "msg-1",
      rating: "ok-2",
      ifVersion: 1,
    })) as { version: number };
    expect(next.version).toBe(2);
  });

  it("feedback.delete removes the entry and returns absent for missing", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-4");
    factory(api);
    await commands.get("feedback.put")!.handler({ messageId: "msg-1", rating: "ok" });

    const deleted = (await commands.get("feedback.delete")!.handler({
      messageId: "msg-1",
      ifVersion: 1,
    })) as { absent: boolean };
    expect(deleted.absent).toBe(false);

    const list = (await commands.get("feedback.list")!.handler({})) as unknown[];
    expect(list).toHaveLength(0);

    const absentAgain = (await commands.get("feedback.delete")!.handler({
      messageId: "msg-1",
    })) as { absent: boolean };
    expect(absentAgain.absent).toBe(true);
  });

  it("PI feedback.put + Cordis shim listFeedbackEntries see identical state", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-shared");
    factory(api);
    await commands.get("feedback.put")!.handler({ messageId: "msg-shared", rating: "ok" });

    const direct = listFeedbackEntries({}, "session-shared");
    expect(direct).toHaveLength(1);

    // And vice versa: writing via state.ts shows up through PI's list.
    putFeedbackEntry({ messageId: "msg-direct", rating: "great" }, "session-shared");
    const list = (await commands.get("feedback.list")!.handler({})) as Array<{ messageId: string }>;
    expect(list.map((entry) => entry.messageId).sort()).toEqual(["msg-direct", "msg-shared"]);
  });

  it("feedback.stats returns { sessions, entries } across every session (Phase C.2)", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-stats");
    factory(api);

    // Empty state → zero sessions, zero entries.
    const empty = (await commands.get("feedback.stats")!.handler({})) as { sessions: number; entries: number };
    expect(empty).toEqual({ sessions: 0, entries: 0 });

    // Put two entries in the bound session + one in a different session
    // via state.ts directly (so the cross-session stats aggregate).
    await commands.get("feedback.put")!.handler({ messageId: "msg-1", rating: "ok" });
    await commands.get("feedback.put")!.handler({ messageId: "msg-2", rating: "great" });
    putFeedbackEntry({ messageId: "msg-3", rating: "neutral" }, "session-other");

    const populated = (await commands.get("feedback.stats")!.handler({})) as { sessions: number; entries: number };
    expect(populated).toEqual({ sessions: 2, entries: 3 });
    // Sanity-check the helpers directly.
    expect(feedbackSessionCount()).toBe(2);
    expect(feedbackEntryCount()).toBe(3);
  });

  it("feedback.search matches case-insensitive substring on rating + note (Phase C.3)", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-search");
    factory(api);
    await commands.get("feedback.put")!.handler({ messageId: "msg-1", rating: "thumbs-up", note: "Great shipping" });
    await commands.get("feedback.put")!.handler({ messageId: "msg-2", rating: "thumbs-down", note: "Late delivery" });
    putFeedbackEntry({ messageId: "msg-3", rating: "neutral" }, "session-other");
    putFeedbackEntry({ messageId: "msg-4", rating: "ok", note: "on time SHIPMENT" }, "session-other-2");

    // "ship" matches msg-1 (note contains "shipping") and msg-4 (note contains "SHIPMENT").
    const shipMatches = searchFeedbackEntries("ship");
    expect(shipMatches).toHaveLength(2);
    const messageIds = shipMatches.map((m) => m.messageId).sort();
    expect(messageIds).toEqual(["msg-1", "msg-4"]);

    // Rating match: "thumbs" matches msg-1 + msg-2.
    const ratingMatches = searchFeedbackEntries("thumbs");
    expect(ratingMatches).toHaveLength(2);
    const ratingMessageIds = ratingMatches.map((m) => m.messageId).sort();
    expect(ratingMessageIds).toEqual(["msg-1", "msg-2"]);

    // Empty query → empty list (defensive).
    expect(searchFeedbackEntries("")).toEqual([]);
    expect(searchFeedbackEntries("   ")).toEqual([]);

    // No match → empty list.
    expect(searchFeedbackEntries("nonexistent keyword xyzzy")).toEqual([]);

    // sessionId filter narrows the search.
    const onlyThisSession = searchFeedbackEntries("ship", { sessionId: "session-search" });
    expect(onlyThisSession).toHaveLength(1);
    expect(onlyThisSession[0]?.messageId).toBe("msg-1");
  });

  it("feedback.session-summary returns { sessionId, goal?, feedbackEntries } in one call (Phase C.3)", async () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-summary");
    factory(api);

    // Empty state for this session.
    const empty = await commands.get("feedback.session-summary")!.handler({});
    expect(empty).toEqual({ sessionId: "session-summary", goal: undefined, feedbackEntries: [] });

    // Add a feedback entry directly via state.ts to ensure the entry shows up.
    putFeedbackEntry({ messageId: "msg-1", rating: "ok" }, "session-summary");

    const populated = await commands.get("feedback.session-summary")!.handler({});
    expect(populated).toEqual({
      sessionId: "session-summary",
      goal: undefined,
      feedbackEntries: [{ messageId: "msg-1", rating: "ok", version: 1 }],
    });
  });

  it("sessionSummary helper returns the same shape as the slash command", () => {
    putFeedbackEntry({ messageId: "m1", rating: "ok", note: "first" }, "session-shape");
    putFeedbackEntry({ messageId: "m2", rating: "good", note: "second" }, "session-shape");
    const summary = sessionSummary({ id: "session-shape" }, "current");
    expect(summary.sessionId).toBe("session-shape");
    expect(summary.goal).toBeUndefined();
    expect(summary.feedbackEntries).toHaveLength(2);
    const notes = summary.feedbackEntries.map((entry) => entry.note).sort();
    expect(notes).toEqual(["first", "second"]);
  });
});