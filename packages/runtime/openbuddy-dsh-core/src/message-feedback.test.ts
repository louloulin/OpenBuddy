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
import { __resetDshCoreStateForTests, listFeedbackEntries, putFeedbackEntry } from "./state";

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

  it("registers 3 feedback.* commands on init", () => {
    const factory = createDshMessageFeedbackExtension();
    const { api, commands } = buildMockApi("session-1");
    factory(api);
    expect(commands.has("feedback.list")).toBe(true);
    expect(commands.has("feedback.put")).toBe(true);
    expect(commands.has("feedback.delete")).toBe(true);
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
});