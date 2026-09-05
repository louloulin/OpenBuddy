import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Context, Service } from "@openbuddy/cordis";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { HarnessPluginLoader, parseCordisPatch } from "@openbuddy/plugin-host";
import { resolveDeepSeekModule } from "./deepseek-compat";
import {
  DeepSeekAgentService,
  DeepSeekSessionQueryService,
  DeepSeekTypertService,
  DeepSeekTypertGatewayService,
  DeepSeekWorkspaceRegistryService,
  DeepSeekPersistenceService,
  DeepSeekSessionService,
} from "./deepseek-runtime";
import { discoverHookConfigs } from "../agent/agent-hooks";

describe("DeepSeek module compatibility", () => {
  it("maps the DeepSeek sessionPersistence seam to Pi JSONL without a second agent store", async () => {
    const entries = new Map<string, unknown[]>([["session-a", []]]);
    const host = {
      readSessionHeader: async () => ({ id: "session-a", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-a", path: "/pi/session-a.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      createPersistedSession: async ({ id }: { id: string }) => { entries.set(id, []); return { sessionId: id, sessionFile: `/pi/${id}.jsonl`, cwd: "/workspace" }; },
      appendSessionEntry: async (id: string, customType: string, data: unknown) => { const row = { type: "custom", customType, data }; entries.get(id)?.push(row); return `entry-${entries.get(id)?.length ?? 0}`; },
      readSessionEntries: async (id: string) => entries.get(id) ?? [],
    };
    const context = new Context();
    context.provide("agentHost", host);
    const persistence = new DeepSeekPersistenceService(context);
    await persistence.create({ id: "session-a", cwd: "/workspace" });
    await expect(persistence.append("session-a", [{ seq: 0, type: "user/message", data: { text: "hello" } }, { seq: 1, type: "assistant/message", data: { message: { content: "world" } } }], { expectedRevision: 1 })).resolves.toMatchObject({ revision: 3, appended: 2 });
    await expect(persistence.append("session-a", [{ seq: 2, type: "assistant/message", data: { text: "stale" } }], { expectedRevision: 1 })).rejects.toMatchObject({ code: "revision-conflict", expectedRevision: 1, actualRevision: 3 });
    await expect(persistence.append("session-a", [{ seq: 2, type: "assistant/message", data: { text: "fresh" } }], { expectedRevision: 3 })).resolves.toMatchObject({ revision: 4, appended: 1 });
    const concurrent = await Promise.allSettled([
      persistence.append("session-a", [{ seq: 3, type: "assistant/message", data: { text: "one" } }], { expectedRevision: 4 }),
      persistence.append("session-a", [{ seq: 4, type: "assistant/message", data: { text: "two" } }], { expectedRevision: 4 }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(persistence.load("session-a")).resolves.toMatchObject({ meta: { id: "session-a", cwd: "/workspace" }, events: [{ seq: 0 }, { seq: 1 }, { seq: 2 }, { seq: 3 }] });
    await expect(persistence.readFrom("session-a", 1)).resolves.toMatchObject({ events: [{ seq: 1 }, { seq: 2 }, { seq: 3 }] });
    await expect(persistence.list()).resolves.toMatchObject([{ header: { id: "session-a" }, revision: { kind: "pi-jsonl" } }]);
    expect(persistence.locate({ id: "session-a" })).toEqual({ kind: "pi-jsonl", path: "/pi/session-a.jsonl" });
    const preparation = await persistence.prepare("session-a");
    expect(preparation.session).toMatchObject({ id: "session-a", seq: 4 });
    expect(preparation.revision).toBe(5);
    expect(preparation.session.deriveMessages()).toEqual([{ text: "hello" }, { content: "world" }]);
    preparation.dispose();
    await expect(persistence.prepare("session-a")).resolves.toMatchObject({ session: { id: "session-a" } });
  });

  it("exposes the real Pi JSONL artifact and validates only the logical DeepSeek header version", async () => {
    const content = [
      JSON.stringify({ type: "session", version: 3, id: "session-raw", timestamp: "2026-08-30T00:00:00.000Z", cwd: "/workspace" }),
      JSON.stringify({ type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-raw" } }),
      '{"type":"custom","customType":"deepseek/session-event","data":{"type":"user/message","raw":true}}',
      "",
    ].join("\n");
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-raw", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      readSessionRaw: async (id: string) => id === "session-raw" ? ({
        path: "/pi/session-raw.jsonl",
        content,
        header: { type: "session", version: 3, id: "session-raw", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" },
      }) : undefined,
      readSessionEntries: async () => [],
    });
    const persistence = new DeepSeekPersistenceService(context);

    expect(persistence.supportsRawArtifacts).toBe(true);
    await expect(persistence.readRaw("missing")).resolves.toBeUndefined();
    const raw = await persistence.readRaw("session-raw");
    expect(raw).toMatchObject({ filename: "session.jsonl", meta: { id: "session-raw", version: 0 }, content });
    expect(raw?.content).toBe(content);
  });

  it("refuses unsupported logical session versions without rejecting Pi physical version 3", async () => {
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-version", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      readSessionEntries: async () => [
        { type: "session", version: 3, id: "session-version" },
        { type: "custom", customType: "deepseek/session-header", data: { version: 1, id: "session-version" } },
      ],
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.inspect("session-version")).rejects.toMatchObject({ code: "session-format-unsupported", version: 1 });
  });

  it("keeps readFrom detached, physical, and non-repairing", async () => {
    const entries: unknown[] = [
      { type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-read-from" } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "turn/start", data: { turn: 1 } } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "step/start", data: { turn: 1, step: 1 } } },
    ];
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-read-from", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-read-from", path: "/pi/session-read-from.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => entries,
      appendSessionEntry: async (_id: string, customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); return "entry"; },
    });
    const persistence = new DeepSeekPersistenceService(context);
    const before = entries.length;
    await expect(persistence.readFrom("session-read-from", 0)).resolves.toMatchObject({ events: [{ type: "turn/start" }, { type: "step/start" }] });
    expect(entries).toHaveLength(before);
    await expect(persistence.readFrom("session-read-from", 99)).resolves.toMatchObject({ events: [] });
    await expect(persistence.readFrom("session-read-from", -1)).rejects.toThrow(/non-negative safe integer/);
  });

  it("uses source-qualified revisions when the entry count stays unchanged", async () => {
    let sourceRevision = "file:1";
    const entries = [{ type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-source" } }];
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-source", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-source", path: "/pi/session-source.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => [...entries],
      readSessionRevision: async () => ({ path: "/pi/session-source.jsonl", revision: sourceRevision, entryCount: entries.length }),
      appendSessionEntry: async () => "entry-2",
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.list()).resolves.toMatchObject([{ revision: { sourceRevision: "file:1", sequence: 1 } }]);
    sourceRevision = "file:2";
    await expect(persistence.append("session-source", [], { expectedSourceRevision: "file:1" })).rejects.toMatchObject({
      code: "revision-conflict",
      expectedSourceRevision: "file:1",
      actualSourceRevision: "file:2",
    });
  });

  it("uses the host batch append seam for one CAS-protected persistence write", async () => {
    const entries: unknown[] = [{ type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-batch" } }];
    const calls: unknown[] = [];
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-batch", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      readSessionEntries: async () => [...entries],
      readSessionRevision: async () => ({ path: "/pi/session-batch.jsonl", revision: `file:${entries.length}`, entryCount: entries.length }),
      appendSessionEntries: async (id: string, batch: ReadonlyArray<{ customType: string; data: unknown }>, options?: { expectedRevision?: number; expectedSourceRevision?: string }) => {
        calls.push({ id, batch, options });
        for (const entry of batch) entries.push({ type: "custom", ...entry });
        return { entryIds: batch.map((_entry, index) => `entry-${index}`), sourceRevision: `file:${entries.length}`, entryCount: entries.length };
      },
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.append("session-batch", [{ seq: 0, type: "user/message", data: { text: "batched" } }], { expectedRevision: 1, expectedSourceRevision: "file:1" })).resolves.toMatchObject({ revision: 2, sourceRevision: "file:2" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ options: { expectedRevision: 1, expectedSourceRevision: "file:1" }, batch: [{ customType: "deepseek/session-event" }] });
  });

  it("rejects a corrupt raw artifact header and does not repair it", async () => {
    const appendCalls: unknown[] = [];
    const context = new Context();
    context.provide("agentHost", {
      readSessionRaw: async () => ({ path: "/pi/corrupt.jsonl", content: "not-json\n", header: {} }),
      appendSessionEntry: async (...args: unknown[]) => { appendCalls.push(args); return "entry-1"; },
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.readRaw("corrupt")).rejects.toThrow(/invalid first line/);
    expect(appendCalls).toHaveLength(0);
  });

  it("rejects corrupt raw event lines instead of silently dropping them", async () => {
    const context = new Context();
    context.provide("agentHost", {
      readSessionRaw: async () => ({
        path: "/pi/corrupt-event.jsonl",
        content: [
          JSON.stringify({ type: "session", version: 3, id: "corrupt-event" }),
          "{\"type\":\"custom\",\"customType\":\"deepseek/session-header\",\"data\":{\"version\":0}}",
          "not-json-event",
          "",
        ].join("\n"),
        header: { type: "session", version: 3, id: "corrupt-event" },
      }),
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.readRaw("corrupt-event")).rejects.toMatchObject({ code: "session-corrupt", path: "/pi/corrupt-event.jsonl", line: 3 });
    await expect(persistence.readRaw("corrupt-event")).rejects.toThrow(/invalid JSON on line 3/);
  });

  it("keeps unsupported logical raw versions distinct from corruption", async () => {
    const context = new Context();
    context.provide("agentHost", {
      readSessionRaw: async () => ({
        path: "/pi/unsupported-raw.jsonl",
        content: [
          JSON.stringify({ type: "session", version: 3, id: "unsupported-raw" }),
          JSON.stringify({ type: "custom", customType: "deepseek/session-header", data: { version: 1, id: "unsupported-raw" } }),
          "",
        ].join("\n"),
        header: { type: "session", version: 3, id: "unsupported-raw" },
      }),
    });
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.readRaw("unsupported-raw")).rejects.toMatchObject({ code: "session-format-unsupported", version: 1 });
  });

  it("repairs interrupted cold turns on load but keeps inspect and live reads non-mutating", async () => {
    const entries: unknown[] = [
      { type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-repair" } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "turn/start", data: { turn: 1 } } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "step/start", data: { turn: 1, step: 1 } } },
      { type: "custom", customType: "deepseek/session-event", data: {
        type: "assistant/message",
        data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "tool-call", id: "call-1", name: "shell", arguments: "{}" }] } },
      } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "tool/call", data: { turn: 1, step: 1, callId: "call-1" } } },
    ];
    const host = {
      readSessionHeader: async () => ({ id: "session-repair", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-repair", path: "/pi/session-repair.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => entries,
      appendSessionEntry: async (_id: string, customType: string, data: unknown) => {
        entries.push({ type: "custom", customType, data });
        return `entry-${entries.length}`;
      },
    };
    const context = new Context();
    context.provide("agentHost", host);
    const persistence = new DeepSeekPersistenceService(context);

    const beforeInspect = entries.length;
    await expect(persistence.inspect("session-repair")).resolves.toMatchObject({ events: [{ type: "turn/start" }, { type: "step/start" }, { type: "assistant/message" }, { type: "tool/call" }] });
    expect(entries).toHaveLength(beforeInspect);

    const repaired = await persistence.load("session-repair");
    expect(entries).toHaveLength(beforeInspect + 5);
    expect(entries.slice(-5).map((entry) => (entry as { customType?: string; data?: { operation?: string } }).data?.operation)).toEqual(["begin", undefined, undefined, undefined, "commit"]);
    expect(repaired.events.slice(-3)).toMatchObject([
      { type: "tool/result", surfaceOp: "append", sourceEventSeqs: [3], data: { error: { code: "TOOL_OUTCOME_UNKNOWN" }, message: { role: "user", source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", isError: true }] } } },
      { type: "step/end", data: { turn: 1, step: 1 } },
      { type: "turn/end", data: { turn: 1, reason: { kind: "interrupted" } } },
    ]);

    const liveContext = new Context();
    liveContext.provide("agentHost", { ...host, getSessionId: () => "session-repair" });
    const livePersistence = new DeepSeekPersistenceService(liveContext);
    const liveBefore = entries.length;
    const live = await livePersistence.load("session-repair");
    expect(live.events.at(-1)).toMatchObject({ type: "turn/end" });
    expect(entries).toHaveLength(liveBefore);
  });

  it("resumes an interrupted repair from its durable marker without duplicating closers", async () => {
    const entries: unknown[] = [
      { type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-repair-marker" } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "turn/start", data: { turn: 1 } } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "step/start", data: { turn: 1, step: 1 } } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "assistant/message", data: { message: { role: "assistant", content: [{ type: "tool-call", id: "marker-call", name: "shell", arguments: "{}" }] } } } },
      { type: "custom", customType: "deepseek/session-event", data: { type: "tool/call", data: { callId: "marker-call" } } },
    ];
    let failCloserBatch = true;
    const host = {
      readSessionHeader: async () => ({ id: "session-repair-marker", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-repair-marker", path: "/pi/session-repair-marker.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => [...entries],
      readSessionRevision: async () => ({ path: "/pi/session-repair-marker.jsonl", revision: `file:${entries.length}`, entryCount: entries.length }),
      appendSessionEntries: async (_id: string, batch: ReadonlyArray<{ customType: string; data: unknown }>) => {
        if (batch[0]?.customType === "deepseek/session-event" && failCloserBatch) {
          failCloserBatch = false;
          throw new Error("simulated repair crash");
        }
        entries.push(...batch.map((entry) => ({ type: "custom", ...entry })));
        return { entryIds: batch.map((_entry, index) => `entry-${index}`), sourceRevision: `file:${entries.length}`, entryCount: entries.length };
      },
    };
    const context = new Context();
    context.provide("agentHost", host);
    const persistence = new DeepSeekPersistenceService(context);
    await expect(persistence.load("session-repair-marker")).rejects.toThrow("simulated repair crash");
    expect(entries.filter((entry) => (entry as { customType?: string }).customType === "deepseek/session-repair")).toHaveLength(1);

    const repaired = await persistence.load("session-repair-marker");
    expect(repaired.events.slice(-3)).toMatchObject([{ type: "tool/result" }, { type: "step/end" }, { type: "turn/end" }]);
    expect(entries.filter((entry) => (entry as { customType?: string }).customType === "deepseek/session-repair").map((entry) => (entry as { data?: { operation?: string } }).data?.operation)).toEqual(["begin", "commit"]);
    expect(repaired.events.filter((event) => (event as { type?: string }).type === "turn/end")).toHaveLength(1);
  });

  it("recognizes Pi-persisted agent-event envelopes during crash repair", async () => {
    const entries: unknown[] = [
      { type: "custom", customType: "deepseek/agent-event", data: { version: 1, type: "turn/start", data: { turn: 2 } } },
      { type: "custom", customType: "deepseek/agent-event", data: { version: 1, type: "step/start", data: { turn: 2, step: 1 } } },
      { type: "message", message: { role: "assistant", content: [{ type: "tool-call", id: "call-envelope", name: "bash", arguments: "{}" }] } },
      { type: "custom", customType: "deepseek/agent-event", data: { version: 1, type: "tool/start", data: { turn: 2, step: 1, toolCallId: "call-envelope", toolName: "bash" } } },
    ];
    const context = new Context();
    context.provide("agentHost", {
      readSessionHeader: async () => ({ id: "session-envelope", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-envelope", path: "/pi/session-envelope.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => entries,
      appendSessionEntry: async (_id: string, customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); return `entry-${entries.length}`; },
    });
    const persistence = new DeepSeekPersistenceService(context);
    const loaded = await persistence.load("session-envelope");
    expect(loaded.events.slice(0, 2)).toMatchObject([
      { type: "turn/start", data: { turn: 2 } },
      { type: "step/start", data: { turn: 2, step: 1 } },
    ]);
    expect(loaded.events.slice(-3)).toMatchObject([
      { type: "tool/result", data: { error: { code: "TOOL_OUTCOME_UNKNOWN" }, message: { source: { callId: "call-envelope" } } } },
      { type: "step/end" },
      { type: "turn/end", data: { reason: { kind: "interrupted" } } },
    ]);
  });

  it("round-trips the persistence facade through a real Pi SessionManager file", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-persistence-facade-"));
    try {
      const managers = new Map<string, SessionManager>();
      const host = {
        readSessionHeader: async (id: string) => {
          const header = managers.get(id)?.getHeader();
          return header ? { id: header.id, cwd: header.cwd, timestamp: header.timestamp, parentSessionId: header.parentSession } : undefined;
        },
        listSessionInfos: async () => [...managers.values()].map((value) => ({ id: value.getSessionId(), path: value.getSessionFile(), cwd: value.getCwd(), timestamp: value.getHeader()?.timestamp })),
        createPersistedSession: async ({ id, cwd }: { id: string; cwd?: string }) => {
          const created = SessionManager.create(cwd ?? "/workspace", root, { id });
          managers.set(id, created);
          return { sessionId: created.getSessionId(), sessionFile: created.getSessionFile(), cwd: created.getCwd() };
        },
        appendSessionEntry: async (id: string, customType: string, data: unknown) => managers.get(id)!.appendCustomEntry(customType, data),
        readSessionEntries: async (id: string) => managers.get(id)?.getEntries() ?? [],
      };
      const context = new Context();
      context.provide("agentHost", host);
      const persistence = new DeepSeekPersistenceService(context);
      await persistence.create({ id: "session-real", cwd: "/workspace" });
      const manager = managers.get("session-real");
      if (!manager) throw new Error("real Pi session was not created");
      await persistence.append("session-real", [
        { seq: 0, type: "user/message", time: 1, data: { text: "hello" } },
        { seq: 1, type: "assistant/message", time: 2, data: { text: "world" } },
      ]);
      const loaded = await persistence.load("session-real");
      expect(loaded.events).toHaveLength(2);
      expect(persistence.locate({ id: "session-real" })?.path).toBe(manager.getSessionFile());
      await expect(persistence.readFrom("session-real", 1)).resolves.toMatchObject({ events: [{ seq: 1 }] });
      expect(manager.getEntries().filter((entry) => entry.type === "custom")).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("projects native Pi message entries into the Harness session event model", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-pi-native-persistence-"));
    try {
      const manager = SessionManager.create("/workspace", root, { id: "session-native" });
      manager.appendMessage({ role: "user", content: "native Pi message", timestamp: 1 });
      const context = new Context();
      context.provide("agentHost", {
        readSessionHeader: async () => {
          const header = manager.getHeader();
          return header ? { id: header.id, cwd: header.cwd, timestamp: header.timestamp } : undefined;
        },
        listSessionInfos: async () => [{ id: manager.getSessionId(), path: manager.getSessionFile(), cwd: manager.getCwd(), timestamp: manager.getHeader()?.timestamp }],
        readSessionEntries: async () => manager.getEntries(),
      });
      const persistence = new DeepSeekPersistenceService(context);
      const loaded = await persistence.load("session-native");
      expect(loaded.events).toMatchObject([{ seq: 0, type: "user/message", data: { role: "user", content: "native Pi message" } }]);
      const preparation = await persistence.prepare("session-native");
      expect(preparation.session.deriveMessages()).toEqual([{ role: "user", content: "native Pi message", timestamp: 1 }]);
      preparation.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps prepared sessions detached, cancellable, and exclusive with the live Pi session", async () => {
    let liveSessionId: string | undefined;
    const context = new Context();
    context.provide("agentHost", {
      getSessionId: () => liveSessionId,
      readSessionHeader: async () => ({ id: "prepared", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "prepared", path: "/pi/prepared.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => [{ type: "custom", customType: "deepseek/session-event", data: { seq: 0, type: "user/message", data: { text: "detached" } } }],
    });
    const persistence = new DeepSeekPersistenceService(context);
    const preparation = await persistence.prepare("prepared");
    await expect(persistence.prepare("prepared")).rejects.toThrow("already prepared");
    liveSessionId = "prepared";
    preparation.dispose();
    await expect(persistence.prepare("prepared")).rejects.toThrow("cannot prepare live session");
    liveSessionId = undefined;
    const controller = new AbortController();
    controller.abort();
    await expect(persistence.prepare("prepared", controller.signal)).rejects.toThrow();
  });

  it("serializes preparation ownership and rejects appends while a preparation is in flight", async () => {
    const entries: unknown[] = [{ type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-reservation" } }];
    let readEntered!: () => void;
    const entered = new Promise<void>((resolve) => { readEntered = resolve; });
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let firstRead = true;
    const host = {
      readSessionHeader: async () => ({ id: "session-reservation", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-reservation", path: "/pi/session-reservation.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => {
        if (firstRead) {
          firstRead = false;
          readEntered();
          await readGate;
        }
        return entries;
      },
      appendSessionEntry: async (_id: string, customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); return `entry-${entries.length}`; },
    };
    const context = new Context();
    context.provide("agentHost", host);
    const persistence = new DeepSeekPersistenceService(context);
    const first = persistence.prepare("session-reservation");
    await entered;
    await expect(persistence.prepare("session-reservation")).rejects.toMatchObject({ code: "preparation-conflict", sessionId: "session-reservation" });
    await expect(persistence.append("session-reservation", [{ seq: 1, type: "user/message", data: { text: "late" } }])).rejects.toMatchObject({ code: "preparation-conflict" });
    releaseRead();
    await first;
  });

  it("honors a host-owned preparation lease across persistence instances", async () => {
    const entries: unknown[] = [{ type: "custom", customType: "deepseek/session-header", data: { version: 0, id: "session-cross-process" } }];
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    let firstRead = true;
    let leaseHeld = false;
    let releaseCount = 0;
    const host = {
      readSessionHeader: async () => ({ id: "session-cross-process", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }),
      listSessionInfos: async () => [{ id: "session-cross-process", path: "/pi/session-cross-process.jsonl", cwd: "/workspace", timestamp: "2026-08-30T00:00:00.000Z" }],
      readSessionEntries: async () => {
        if (firstRead) { firstRead = false; await readGate; }
        return entries;
      },
      reservePreparation: async () => {
        if (leaseHeld) throw Object.assign(new Error("preparation lease is held"), { code: "preparation-conflict", sessionId: "session-cross-process" });
        leaseHeld = true;
        return { token: "lease-1", release: async () => { leaseHeld = false; releaseCount += 1; } };
      },
    };
    const firstContext = new Context();
    firstContext.provide("agentHost", host);
    const secondContext = new Context();
    secondContext.provide("agentHost", host);
    const firstPersistence = new DeepSeekPersistenceService(firstContext);
    const secondPersistence = new DeepSeekPersistenceService(secondContext);
    const first = firstPersistence.prepare("session-cross-process");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(secondPersistence.prepare("session-cross-process")).rejects.toMatchObject({ code: "preparation-conflict" });
    releaseRead();
    const preparation = await first;
    preparation.dispose();
    expect(releaseCount).toBe(1);
  });

  it("enforces Typert gateway request, cancellation, and withdrawn strict definitions", async () => {
    const calls: unknown[] = [];
    const context = new Context();
    context.provide("dshRemote", { invoke: async (request: unknown) => { calls.push(request); return { ok: true }; } });
    let strictActive = true;
    context.provide("typert", { local: { get: (endpoint: string) => strictActive && endpoint === "demo/ping" ? {} : undefined, hasSeen: (endpoint: string) => endpoint === "demo/ping" } });
    const gateway = new DeepSeekTypertGatewayService(context);
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: { value: 1 } })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: [1] })).rejects.toMatchObject({ code: "arguments-invalid" });
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: {}, extra: true })).rejects.toMatchObject({ code: "input-invalid" });
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: {}, signal: {} })).rejects.toMatchObject({ code: "input-invalid" });

    strictActive = false;
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: {} })).rejects.toMatchObject({ code: "definition-unavailable" });
  });

  it("keeps strict Typert endpoints bound to their declaring package", async () => {
    const context = new Context();
    context.provide("dshRemote", { invoke: async () => ({ ok: true }) });
    context.provide("typert", {
      local: { get: (endpoint: string) => endpoint === "demo/ping" ? { namespace: "demo", method: "ping" } : undefined, hasSeen: () => true },
      listPackages: () => [{ package: "@fixture/owner", face: "host", invocations: [{ namespace: "demo", method: "ping" }] }],
    });
    const gateway = new DeepSeekTypertGatewayService(context);
    await expect(gateway.invoke({ package: "@fixture/other", namespace: "demo", method: "ping", args: {} })).rejects.toMatchObject({ code: "provider-mismatch" });
    await expect(gateway.invoke({ package: "@fixture/owner", namespace: "demo", method: "ping", args: {} })).resolves.toEqual({ ok: true });
  });

  it("executes strict Typert descriptors through Pi services instead of the legacy remote fallback", async () => {
    const fallback = { invoke: async () => { throw new Error("legacy fallback must not run"); } };
    const context = new Context();
    context.provide("dshRemote", fallback);
    const demo = {
      ping: (request: { value: number }) => ({ value: request.value + 1 }),
    } as Record<string, unknown>;
    demo.typertRemote = { service: demo, serviceKey: "demo", namespace: "demo" };
    context.provide("demo", demo);
    context.provide("typert", {
      local: {
        get: (endpoint: string) => endpoint === "demo/ping" ? {
          namespace: "demo",
          method: "ping",
          service: "demo",
          parameters: [{ name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "fixture/Request", schema: { type: "object", properties: { value: { schema: { type: "integer" } } } } } }],
          result: { mode: "strict", typeSymbol: "fixture/Result", schema: { type: "object", properties: { value: { schema: { type: "integer" } } } } },
        } : undefined,
        hasSeen: () => false,
      },
    });
    const gateway = new DeepSeekTypertGatewayService(context);

    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: { request: { value: 4 } } })).resolves.toEqual({ value: 5 });
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: { request: { value: 1.5 } } })).rejects.toMatchObject({ code: "input-invalid", field: "request" });
  });

  it("rejects non-JSON-safe strict gateway inputs and results", async () => {
    const context = new Context();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const demo = { echo: (value: unknown) => value } as Record<string, unknown>;
    demo.typertRemote = { service: demo, serviceKey: "demo", namespace: "demo" };
    context.provide("demo", demo);
    context.provide("typert", {
      local: {
        get: (endpoint: string) => endpoint === "demo/echo" ? {
          namespace: "demo", method: "echo", service: "demo",
          parameters: [{ name: "value", wire: "value", source: "json", codec: { mode: "src-json" } }],
          result: { mode: "src-json" },
        } : undefined,
        hasSeen: () => false,
      },
    });
    const gateway = new DeepSeekTypertGatewayService(context);
    await expect(gateway.invoke({ namespace: "demo", method: "echo", args: { value: cyclic } })).rejects.toMatchObject({ code: "input-invalid" });
    await expect(gateway.invoke({ namespace: "demo", method: "echo", args: { value: { ok: true } } })).resolves.toEqual({ ok: true });
  });

  it("rejects strict descriptors whose service binding is missing or inconsistent", async () => {
    const context = new Context();
    context.provide("demo", { ping: () => "ok" });
    context.provide("typert", {
      local: {
        get: (endpoint: string) => endpoint === "demo/ping"
          ? { namespace: "demo", method: "ping", service: "demo", parameters: [], result: { mode: "src-json" } }
          : undefined,
        hasSeen: () => false,
      },
    });
    const gateway = new DeepSeekTypertGatewayService(context);
    await expect(gateway.invoke({ namespace: "demo", method: "ping", args: {} })).rejects.toMatchObject({ code: "binding-invalid" });
  });

  it("resolves strict lookup and context receivers before invoking the Pi service", async () => {
    const scoped = new Context();
    const scopedService = { greet: (agent: { id: string }, request: { text: string }) => `${agent.id}:${request.text}` } as Record<string, unknown>;
    scopedService.typertRemote = { service: scopedService, serviceKey: "scoped", namespace: "scoped" };
    scoped.provide("scoped", scopedService);
    const root = new Context();
    const typert = {
      local: {
        get: (endpoint: string) => endpoint === "scoped/greet" ? {
          namespace: "scoped",
          method: "greet",
          service: "scoped",
          invocation: { kind: "context", context: "agent", wire: "agentId", codec: { mode: "src-json" } },
          parameters: [
            { name: "agent", wire: "agent", source: "lookup", lookup: "agent", codec: { mode: "src-json" } },
            { name: "request", wire: "request", source: "json", codec: { mode: "strict", typeSymbol: "fixture/Request", schema: { type: "object", properties: { text: { schema: { type: "string" } } } } } },
          ],
          result: { mode: "strict", typeSymbol: "fixture/Result", schema: { type: "string" } },
        } : undefined,
        hasSeen: () => false,
      },
      contexts: { getHost: (key: string) => key === "agent" ? { wire: "agentId", resolve: async (id: unknown) => id === "a1" ? scoped : undefined } : undefined },
      lookups: { get: (key: string) => key === "agent" ? { resolve: async (id: unknown) => ({ id: String(id) }) } : undefined },
    };
    root.provide("typert", typert);
    const gateway = new DeepSeekTypertGatewayService(root);

    await expect(gateway.invoke({ namespace: "scoped", method: "greet", args: { agentId: "a1", agent: "a1", request: { text: "hello" } } })).resolves.toBe("a1:hello");
    await expect(gateway.invoke({ namespace: "scoped", method: "greet", args: { agentId: "missing", agent: "missing", request: { text: "hello" } } })).rejects.toMatchObject({ code: "context-not-found" });
  });
  it("exposes a real Pi-backed session-query service and package faces", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionHeaders: async () => [{ id: "session-1", cwd: "/workspace", name: "Demo", timestamp: "2026-08-29T00:00:00.000Z" }],
    });
    context.provide("eventLog", {
      list: () => [{ sequence: 1, timestamp: "2026-08-29T00:00:01.000Z", type: "assistant/message", sessionId: "session-1", payload: { text: "DeepSeek Harness" } }],
    });
    context.provide("agents", { list: () => [] });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-session-query")).toMatchObject({ SessionQueryEngine: DeepSeekSessionQueryService });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-session-query/types")).toMatchObject({ SessionSearchCursor: expect.any(Function) });
    const service = new DeepSeekSessionQueryService(context);
    await expect(service.listSessions()).resolves.toMatchObject([{ header: { id: "session-1" }, persisted: true }]);
    await expect(service.searchSessions({ query: "harness", limit: 1 })).resolves.toMatchObject({ items: [{ header: { id: "session-1" }, bestMatch: { seq: 1 } }] });
    await expect(service.searchEvents({ sessionId: "session-1", query: "deepseek" })).resolves.toMatchObject({ session: { id: "session-1" }, items: [{ seq: 1 }] });
  });

  it("reads persisted Pi entries before the legacy OpenBuddy event log", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [{
        id: "child-session",
        cwd: "/workspace",
        name: "Pi history",
        timestamp: "2026-08-29T00:00:00.000Z",
        parentSessionId: "parent-session",
        messageCount: 2,
        allMessagesText: "Persisted Pi message",
      }],
      readSessionEntries: async () => [
        { id: "entry-1", parentId: null, type: "message", timestamp: "2026-08-29T00:00:01.000Z", message: { role: "user", content: "Persisted Pi message" } },
        { id: "entry-2", parentId: "entry-1", type: "custom", customType: "dsh-plan", timestamp: "2026-08-29T00:00:02.000Z", data: { name: "execution plan" } },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });

    const service = new DeepSeekSessionQueryService(context);
    await expect(service.listSessions()).resolves.toMatchObject([{
      header: { id: "child-session", parentSessionId: "parent-session", allMessagesText: "Persisted Pi message" },
    }]);
    await expect(service.searchSessions({ query: "persisted pi", limit: 1 })).resolves.toMatchObject({
      items: [{ header: { id: "child-session" }, bestMatch: { seq: 0, type: "message" } }],
    });
    await expect(service.listEvents("child-session")).resolves.toMatchObject([
      { seq: 0, type: "message", text: "Persisted Pi message" },
      { seq: 1, type: "custom", text: "execution plan", parentSeq: 0 },
    ]);
  });

  it("validates search cursors and authorizes workspace-scoped searches", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [
        { id: "in-workspace", cwd: "/workspace", timestamp: "2026-08-29T00:00:00.000Z", messageCount: 1, allMessagesText: "inside" },
        { id: "outside", cwd: "/other", timestamp: "2026-08-28T00:00:00.000Z", messageCount: 1, allMessagesText: "inside" },
      ],
      listWorkspaces: async () => [{ workspaceId: "workspace-1", sessionIds: ["in-workspace"] }],
      readSessionEntries: async (sessionId: string) => [{ id: `${sessionId}-entry`, parentId: null, type: "message", timestamp: "2026-08-29T00:00:01.000Z", message: { role: "user", content: "inside" } }],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);

    await expect(service.searchSessions({ query: "inside", workspaceId: "workspace-1" })).resolves.toMatchObject({
      items: [{ header: { id: "in-workspace" } }],
    });
    await expect(service.searchSessions({ query: "inside", cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID_CURSOR" });
    await expect(service.searchSessions({ query: "inside", workspaceId: "missing" })).rejects.toMatchObject({ code: "SESSION_QUERY_WORKSPACE_NOT_FOUND" });
  });

  it("uses the registry authorization snapshot instead of a mutable workspace projection", async () => {
    const context = new Context();
    context.provide("workspaceRegistry", {
      authorizeSessionQueryWorkspace: async (workspaceId: string) => ({
        workspaceId,
        revision: 7,
        sessionIds: Object.freeze(["in-workspace"]),
      }),
    });
    context.provide("agentHost", {
      listSessionInfos: async () => [
        { id: "in-workspace", cwd: "/workspace", timestamp: "2026-08-29T00:00:00.000Z", messageCount: 1, allMessagesText: "inside" },
        { id: "outside", cwd: "/other", timestamp: "2026-08-28T00:00:00.000Z", messageCount: 1, allMessagesText: "inside" },
      ],
      listWorkspaces: async () => [{ workspaceId: "workspace-1", sessionIds: ["outside"] }],
      readSessionEntries: async (sessionId: string) => [{ id: `${sessionId}-entry`, type: "message", message: { role: "user", content: "inside" } }],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);

    await expect(service.searchSessions({ query: "inside", workspaceId: "workspace-1" })).resolves.toMatchObject({
      items: [{ header: { id: "in-workspace" } }],
    });
  });

  it("supports Harness session filters, recursive lineage, and partial ancestry", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [
        { id: "root", created: "2026-08-29T00:00:00.000Z" },
        { id: "child", parentSessionId: "root", created: "2026-08-29T00:00:01.000Z" },
        { id: "grandchild", parentSessionId: "child", created: "2026-08-29T00:00:02.000Z" },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);

    await expect(service.filterSessions([{ kind: "created-at", from: Date.parse("2026-08-29T00:00:01.000Z") }, { kind: "parent", values: ["root"] }])).resolves.toMatchObject([{ header: { id: "child" } }]);
    await expect(service.traceSession("root")).resolves.toMatchObject({
      complete: true,
      root: { header: { id: "root" } },
      descendants: [{ session: { header: { id: "child" } }, descendants: [{ session: { header: { id: "grandchild" } } }] }],
    });

    const partialContext = new Context();
    partialContext.provide("agentHost", { listSessionHeaders: async () => [{ id: "orphan", parentSessionId: "missing" }] });
    partialContext.provide("eventLog", { list: () => [] });
    partialContext.provide("agents", { list: () => [] });
    await expect(new DeepSeekSessionQueryService(partialContext).traceSession("orphan")).resolves.toMatchObject({ complete: false, unresolvedParentId: "missing" });
  });

  it("rejects cyclic session lineage instead of recursing forever", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionHeaders: async () => [
        { id: "a", parentSessionId: "b" },
        { id: "b", parentSessionId: "a" },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    await expect(new DeepSeekSessionQueryService(context).traceSession("a")).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID_LINEAGE" });
  });

  it("folds Pi surface replacements and rejects stale cursors", async () => {
    const context = new Context();
    let entries: unknown[] = [
      { id: "e0", type: "user/message", timestamp: "2026-08-29T00:00:00.000Z", message: { content: "old user" }, surfaceOp: "append" },
      { id: "e1", type: "assistant/message", timestamp: "2026-08-29T00:00:01.000Z", message: { content: "old answer" }, surfaceOp: "append" },
      { id: "e2", type: "turn/start", timestamp: "2026-08-29T00:00:02.000Z", data: { trace: true } },
      { id: "e3", type: "user/message", timestamp: "2026-08-29T00:00:03.000Z", message: { content: "replacement" }, surfaceOp: { op: "replace", start: 0, end: 1 }, sourceEventSeqs: [0, 1] },
    ];
    context.provide("agentHost", {
      listSessionInfos: async () => [{ id: "surface-session", timestamp: "2026-08-29T00:00:00.000Z" }],
      readSessionEntries: async () => entries,
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);

    await expect(service.listEvents("surface-session")).resolves.toMatchObject([
      { seq: 0, surface: "shadowed", replacedBy: 3 },
      { seq: 1, surface: "shadowed", replacedBy: 3 },
      { seq: 2, surface: "log-only" },
      { seq: 3, surface: "current", replacedEventSeqs: [0, 1] },
    ]);
    await expect(service.filterEvents("surface-session", [{ kind: "surface", values: ["current"] }])).resolves.toHaveLength(1);
    const firstPage = await service.searchEvents({ sessionId: "surface-session", query: "", limit: 1 });
    expect(firstPage.nextCursor).toBeDefined();
    await expect(service.searchEvents({ sessionId: "surface-session", query: "changed", limit: 1, cursor: firstPage.nextCursor })).rejects.toMatchObject({ code: "SESSION_QUERY_STALE_CURSOR" });
    entries = [...entries, { id: "e4", type: "turn/end", timestamp: "2026-08-29T00:00:04.000Z" }];
    await expect(service.searchEvents({ sessionId: "surface-session", query: "", limit: 1, cursor: firstPage.nextCursor })).rejects.toMatchObject({ code: "SESSION_QUERY_STALE_CURSOR" });
  });

  it("recovers Pi compaction boundaries and active branch lineage", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [{ id: "pi-branch-session", timestamp: "2026-08-29T00:00:00.000Z" }],
      readSessionEntries: async () => [
        { id: "root", parentId: null, type: "message", timestamp: "2026-08-29T00:00:00.000Z", message: { role: "user", content: "root" } },
        { id: "old", parentId: "root", type: "message", timestamp: "2026-08-29T00:00:01.000Z", message: { role: "assistant", content: "old context" } },
        { id: "branch", parentId: "root", type: "message", timestamp: "2026-08-29T00:00:02.000Z", message: { role: "user", content: "abandoned branch" } },
        { id: "branch-child", parentId: "branch", type: "message", timestamp: "2026-08-29T00:00:03.000Z", message: { role: "assistant", content: "abandoned answer" } },
        { id: "compact", parentId: "old", type: "compaction", firstKeptEntryId: "old", summary: "summary of root", timestamp: "2026-08-29T00:00:04.000Z" },
        { id: "retained", parentId: "compact", type: "message", timestamp: "2026-08-29T00:00:05.000Z", message: { role: "user", content: "retained tail" } },
        { id: "branch-summary", parentId: "retained", type: "branch_summary", fromId: "branch-child", summary: "abandoned branch summary", timestamp: "2026-08-29T00:00:06.000Z" },
        { id: "current", parentId: "branch-summary", type: "message", timestamp: "2026-08-29T00:00:07.000Z", message: { role: "assistant", content: "current answer" } },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });

    const service = new DeepSeekSessionQueryService(context);
    const events = await service.listEvents("pi-branch-session");
    expect(events).toMatchObject([
      { seq: 0, entryId: "root", surface: "shadowed", replacedBy: 4 },
      { seq: 1, entryId: "old", surface: "current" },
      { seq: 2, entryId: "branch", parentSeq: 0, surface: "log-only" },
      { seq: 3, entryId: "branch-child", parentSeq: 2, surface: "log-only" },
      { seq: 4, entryId: "compact", parentSeq: 1, surface: "current", replacedEventSeqs: [0] },
      { seq: 5, entryId: "retained", parentSeq: 4, surface: "current" },
      { seq: 6, entryId: "branch-summary", parentSeq: 5, fromSeq: 3, surface: "log-only" },
      { seq: 7, entryId: "current", parentSeq: 6, surface: "current" },
    ]);
    await expect(service.readSurface("pi-branch-session")).resolves.toMatchObject({
      events: [{ entryId: "old" }, { entryId: "compact" }, { entryId: "retained" }, { entryId: "current" }],
    });
  });

  it("rejects a Pi compaction whose retained entry is not on its active path", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [{ id: "invalid-pi-session" }],
      readSessionEntries: async () => [
        { id: "root", parentId: null, type: "message", message: { role: "user", content: "root" } },
        { id: "compact", parentId: "root", type: "compaction", firstKeptEntryId: "missing", summary: "invalid" },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    await expect(new DeepSeekSessionQueryService(context).listEvents("invalid-pi-session")).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID_LINEAGE" });
  });

  it("exposes surface snapshots and event lineage through the session-query facade", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [{ id: "trace-session", timestamp: "2026-08-29T00:00:00.000Z" }],
      readSessionEntries: async () => [
        { id: "e0", type: "user/message", timestamp: "2026-08-29T00:00:00.000Z", message: { content: "first" }, surfaceOp: "append" },
        { id: "e1", type: "custom", customType: "todo/write", timestamp: "2026-08-29T00:00:01.000Z", data: { todos: [] } },
        { id: "e2", type: "user/message", timestamp: "2026-08-29T00:00:02.000Z", message: { content: "replacement" }, surfaceOp: { op: "replace", start: 0, end: 0 }, sourceEventSeqs: [0] },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);
    await expect(service.readSurface("trace-session")).resolves.toMatchObject({ capturedThroughSeq: 2, events: [{ seq: 2, surface: "current" }] });
    await expect(service.traceEvent({ sessionId: "trace-session", seq: 0 })).resolves.toMatchObject({
      target: { seq: 0, surface: "shadowed" },
      replacedBy: 2,
      replacementChain: [2],
      derivedEventSeqs: [2],
    });
    await expect(service.listEvents("trace-session")).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ seq: 1, surface: "log-only" })]));
  });

  it("reads a bounded event window with Harness error codes", async () => {
    const context = new Context();
    context.provide("agentHost", {
      listSessionInfos: async () => [{ id: "session-1", cwd: "/workspace", timestamp: "2026-08-29T00:00:00.000Z" }],
      readSessionEntries: async () => [
        { id: "e0", parentId: null, type: "message", timestamp: "2026-08-29T00:00:00.000Z", message: { content: "zero" } },
        { id: "e1", parentId: "e0", type: "message", timestamp: "2026-08-29T00:00:01.000Z", message: { content: "one" } },
        { id: "e2", parentId: "e1", type: "message", timestamp: "2026-08-29T00:00:02.000Z", message: { content: "two" } },
      ],
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("agents", { list: () => [] });
    const service = new DeepSeekSessionQueryService(context);
    await expect(service.readEvent({ sessionId: "session-1", seq: 1, before: 1, after: 1 })).resolves.toMatchObject({ startSeq: 0, endSeq: 2, target: { seq: 1 } });
    await expect(service.readEvent({ sessionId: "session-1", seq: 1, before: 51 })).rejects.toMatchObject({ code: "SESSION_QUERY_INVALID_WINDOW" });
    await expect(service.readEvent({ sessionId: "session-1", seq: 9 })).rejects.toMatchObject({ code: "SESSION_QUERY_EVENT_NOT_FOUND" });
  });

  it("forwards plan-mode to pi-plan-mode via passthrough (Stage G-1b)", async () => {
    // openbuddy-plan is removed; plan-mode is owned by pi-plan-mode
    // (passthrough). The deepseek bridge resolves `dsh-plan-mode` to
    // `concretePlanTools()` which now returns no tools — the pi-native
    // plugin is the single authority for plan-mode.
    const { isPassthroughed, recordPassthrough } = await import("@openbuddy/plugin-host");
    recordPassthrough("plan", "installed", "pi-plan-mode");
    expect(isPassthroughed("plan")).toBe(true);
    const { concretePlanTools } = await import("./deepseek-generic");
    const ctx = new Context();
    expect(concretePlanTools(ctx, "@deepseek-ai/dsh-plan-mode")).toEqual([]);
    expect(concretePlanTools(ctx, "anything-else")).toEqual([]);
  });
  it("keeps Typert lookup providers live and disposable", () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    const provider = {
      parameter: "goal",
      wire: "goalId",
      hostTypeSymbol: "@fixture/goal#Goal",
      wireTypeSymbol: "@fixture/goal#GoalId",
      resolve: (id: unknown) => ({ id }),
    };
    const dispose = typert.lookups.register("goal", provider);
    expect(typert.lookups.get("goal")).toBe(provider);
    expect(typert.lookups.definitions()).toEqual([{ key: "goal", parameter: "goal", wire: "goalId", hostTypeSymbol: "@fixture/goal#Goal", wireTypeSymbol: "@fixture/goal#GoalId" }]);
    dispose();
    expect(typert.lookups.get("goal")).toBeUndefined();
    expect(typert.lookups.definitions()).toHaveLength(1);
    expect(() => typert.lookups.register("goal", { ...provider, wire: "otherId" })).toThrow(/changed its wire declaration/);
  });

  it("preserves lookup declarations when a resolver is configured", () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    const provider = {
      parameter: "goal",
      wire: "goalId",
      hostTypeSymbol: "@fixture/goal#Goal",
      wireTypeSymbol: "@fixture/goal#GoalId",
      resolve: (id: unknown) => ({ id }),
    };
    typert.lookups.register("goal", provider);
    typert.lookups.configure("goal", async (id) => ({ configured: id }));
    expect(typert.lookups.get("goal")).toMatchObject({
      parameter: "goal",
      wire: "goalId",
      hostTypeSymbol: "@fixture/goal#Goal",
      wireTypeSymbol: "@fixture/goal#GoalId",
    });
    expect(typert.lookups.definitions()).toEqual([{ key: "goal", parameter: "goal", wire: "goalId", hostTypeSymbol: "@fixture/goal#Goal", wireTypeSymbol: "@fixture/goal#GoalId" }]);
  });

  it("keeps Host and Client Context providers live and disposable", () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    const clientBinder = { identity: (scope: Context) => scope.get("sessionId") };
    const hostProvider = {
      wire: "agentId",
      wireTypeSymbol: "@fixture/session#SessionId",
      resolve: async (id: unknown) => id === "s1" ? context : undefined,
    };
    const disposeClient = typert.contexts.registerClient("agent", clientBinder);
    const disposeHost = typert.contexts.registerHost("agent", hostProvider);
    expect(typert.contexts.getClient("agent")).toBe(clientBinder);
    expect(typert.contexts.getHost("agent")).toBe(hostProvider);
    disposeClient();
    disposeHost();
    expect(typert.contexts.getClient("agent")).toBeUndefined();
    expect(typert.contexts.getHost("agent")).toBeUndefined();
  });

  it("binds registry registrations to the Cordis service lifetime", async () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    typert.lookups.register("goal", {
      parameter: "goal",
      wire: "goalId",
      hostTypeSymbol: "@fixture/goal#Goal",
      wireTypeSymbol: "@fixture/goal#GoalId",
      resolve: (id: unknown) => ({ id }),
    });
    typert.contexts.registerHost("agent", { wire: "agentId", wireTypeSymbol: "@fixture/session#SessionId", resolve: async () => context });
    typert.register({
      package: "@fixture/lifecycle",
      face: "host",
      schemas: [],
      invocations: [{ id: "@fixture/lifecycle#ping", namespace: "fixture", method: "ping", service: "fixture", parameters: [] }],
      model: { services: [], events: [], objects: [] },
    });
    expect(typert.lookups.get("goal")).toBeDefined();
    expect(typert.contexts.getHost("agent")).toBeDefined();
    expect(typert.local.get("fixture/ping")).toBeDefined();
    await context.lifecycle.stop();
    expect(typert.lookups.get("goal")).toBeUndefined();
    expect(typert.contexts.getHost("agent")).toBeUndefined();
    expect(typert.local.get("fixture/ping")).toBeUndefined();
  });

  it("registers generated host reflection and local descriptors transactionally", () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    const changes: string[] = [];
    const unsubscribe = typert.local.subscribe((change) => changes.push(change.key));
    const invocation = { id: "fixture/remote/ping", namespace: "fixture", method: "ping", service: "fixture", parameters: [] };
    const dispose = typert.register({
      package: "@fixture/remote",
      face: "host",
      schemas: [{ name: "Request", schema: {} }],
      invocations: [invocation],
      model: { services: [], events: [], objects: [] },
    });
    expect(typert.get("@fixture/remote#Request")?.name).toBe("Request");
    expect(typert.local.get("fixture/ping")).toBe(invocation);
    expect(typert.local.list()).toEqual([invocation]);
    expect(typert.getPackage("@fixture/remote")?.package).toBe("@fixture/remote");
    dispose();
    expect(typert.get("@fixture/remote#Request")).toBeUndefined();
    expect(typert.local.get("fixture/ping")).toBeUndefined();
    expect(changes).toEqual(["fixture/ping", "fixture/ping"]);
    unsubscribe();
  });

  it("publishes one committed Typert package change and suppresses failed transactions", () => {
    const context = new Context();
    const typert = new DeepSeekTypertService(context);
    const changes: Array<{ kind: string; operation: string; package?: string; revision: number }> = [];
    const unsubscribe = typert.subscribe((change) => changes.push(change));
    const contribution = {
      package: "@fixture/transaction",
      face: "host" as const,
      schemas: [],
      invocations: [{ id: "fixture/transaction/ping", namespace: "fixture", method: "ping", service: "fixture", parameters: [] }],
      model: { services: [], events: [], objects: [] },
    };
    const transaction = typert.beginTransaction();
    const dispose = typert.register(contribution);
    transaction.commit();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "transaction", operation: "changed", revision: 1 });
    dispose();
    expect(changes.at(-1)).toMatchObject({ kind: "package", operation: "removed", package: "@fixture/transaction", revision: 2 });

    const failed = typert.beginTransaction();
    const failedDispose = typert.register({ ...contribution, package: "@fixture/failed" });
    failedDispose();
    failed.rollback();
    expect(changes).toHaveLength(2);
    unsubscribe();
  });

  it("maps DeepSeek Cordis imports to the OpenBuddy singleton surface", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/cordis")).toMatchObject({ Context, Service });
    expect(resolveDeepSeekModule("@cordisjs/core")).toMatchObject({ Context, Service });
  });

  it("maps loader/include and leaves unrelated package imports untouched", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/cordis-plugin-loader")).toMatchObject({ default: { name: "@deepseek-ai/cordis-plugin-loader" } });
    expect(resolveDeepSeekModule("@deepseek-ai/cordis-plugin-include")).toMatchObject({ default: { name: "@deepseek-ai/cordis-plugin-include" } });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-session")).toMatchObject({
      Session: expect.any(Function),
      SessionPreparation: expect.any(Function),
      SessionStore: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-typert-protocol")).toMatchObject({
      Remote: expect.any(Function),
      RemoteScope: expect.any(Function),
      TypertRemoteService: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-api-remotes")).toMatchObject({
      default: { name: "@deepseek-ai/dsh-api-remotes" },
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-client-connection")).toMatchObject({
      HostConnectionService: expect.any(Function),
    });
  });

  it("bridges real DeepSeek hook entries into the shared Pi hook registry", async () => {
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([{
      id: "claude-hooks",
      name: "@deepseek-ai/dsh-hooks-claude-code",
      config: {
        pluginRoot: process.cwd(),
        hooks: { PreToolUse: [{ matcher: "bash", hooks: [{ type: "command", command: "true" }] }] },
      },
    }]);
    try {
      const configs = await discoverHookConfigs([]);
      expect(configs).toEqual(expect.arrayContaining([
        expect.objectContaining({ packageName: "@deepseek-ai/dsh-hooks-claude-code", dialect: "claude-code" }),
      ]));
    } finally {
      await loader.dispose();
    }
    expect(await discoverHookConfigs([])).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ packageName: "@deepseek-ai/dsh-hooks-claude-code" }),
    ]));
  });

  it("exposes Pi-backed DeepSeek runtime services", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-llm")).toMatchObject({
      LlmRuntime: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-agent")).toMatchObject({
      AgentRegistry: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-agent-loop")).toMatchObject({
      AgentLoop: expect.any(Function),
    });
  });

  it("resolves standard Harness capability package aliases", () => {
    for (const name of [
      "@deepseek-ai/dsh-commands",
      "@deepseek-ai/dsh-goal",
      "@deepseek-ai/dsh-file-reference",
      "@deepseek-ai/dsh-host-plugin-inventory",
      "@deepseek-ai/dsh-message-feedback",
      "@deepseek-ai/dsh-session-reference",
      "@deepseek-ai/dsh-cordis-host-runner",
    ]) {
      const module = resolveDeepSeekModule(name) as Record<string, unknown>;
      expect(module.default).toEqual(expect.any(Function));
      expect(module.name).toBeDefined();
      expect(resolveDeepSeekModule(`${name}/remote`)).toMatchObject({
        default: { package: name, descriptors: expect.any(Array) },
        TYPERT_REMOTE: { package: name },
      });
    }
  });

  it("exposes real Harness-style capability services and forwards their methods", async () => {
    const context = new Context();
    context.provide("modelRuntime", {
      getProviders: () => [],
      getModels: () => [],
      getModel: () => undefined,
    });
    const sampleCommands = [
      { name: "compact", description: "compact the session" },
      { name: "review", description: "review staged changes" },
    ];
    const findTable = new Map(sampleCommands.map((c) => [c.name, c]));
    context.provide("dshRemotes", {
      commandsList: () => sampleCommands,
      commandsFind: (_agent: unknown, name: string) => findTable.get(name),
      commandsExecute: async (_agent: unknown, line: string) => ({ kind: "success", line }),
      commandsParseCommand: (line: string) => {
        if (typeof line !== "string") return undefined;
        const match = /^\/([a-z][a-z0-9_-]*)/u.exec(line);
        if (match === null) return undefined;
        const name = match[1];
        if (name === undefined) return undefined;
        const rest = line.slice(match[0].length);
        if (rest.length > 0 && !/^[\t\n\r ]/u.test(rest)) return undefined;
        return Object.freeze({ name, rawInput: rest.replace(/^[\t\n\r ]+/u, "") });
      },
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([{ id: "commands", name: "@deepseek-ai/dsh-commands" }]);
    const commands = context.get("commands") as {
      list: () => unknown[];
      find: (agent: unknown, name: string) => unknown;
      execute: (agent: unknown, line: string) => Promise<unknown>;
      parseCommand: (line: string) => unknown;
    };
    expect(commands.list()).toEqual(sampleCommands);
    expect(commands.find("agent", "compact")).toEqual(sampleCommands[0]);
    expect(commands.find("agent", "missing")).toBeUndefined();
    await expect(commands.execute("agent", "/compact x")).resolves.toEqual({ kind: "success", line: "/compact x" });
    expect(commands.parseCommand("/compact")).toEqual({ name: "compact", rawInput: "" });
    expect(commands.parseCommand("/compact arg1 arg2")).toEqual({ name: "compact", rawInput: "arg1 arg2" });
    expect(commands.parseCommand("compact")).toBeUndefined();
    await loader.dispose();
    expect(context.get("commands")).toBeUndefined();
  });

  it("loads every built-in capability as an independently disposable service", async () => {
    const context = new Context();
    context.provide("dshRemotes", {});
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    const entries = [
      ["commands", "@deepseek-ai/dsh-commands"],
      ["goals", "@deepseek-ai/dsh-goal"],
      ["fileReferences", "@deepseek-ai/dsh-file-reference"],
      ["pluginInventory", "@deepseek-ai/dsh-host-plugin-inventory"],
      ["messageFeedback", "@deepseek-ai/dsh-message-feedback"],
      ["sessionReferenceResolver", "@deepseek-ai/dsh-session-reference"],
      ["dynamicCordisRunner", "@deepseek-ai/dsh-cordis-host-runner"],
    ].map(([id, name]) => ({ id, name }));
    await loader.load(entries);
    expect(entries.map(({ id }) => context.get(id))).toEqual(entries.map(() => expect.any(Object)));
    expect(loader.list().every((entry) => entry.state === "loaded")).toBe(true);
    await loader.dispose();
    expect(entries.every(({ id }) => context.get(id) === undefined)).toBe(true);
  });

  it("exposes canonical Harness submodule exports", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-commands/brand")).toMatchObject({ CommandId: expect.any(Function) });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-file-reference/grammar")).toMatchObject({
      activeAtToken: expect.any(Function),
      formatFileMention: expect.any(Function),
    });
  });

  it("exposes browser-safe dsh-session types and surface faces", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-session/types")).toMatchObject({
      SessionId: expect.any(Function),
      SESSION_FORMAT_VERSION: expect.any(Number),
    });
    const surface = resolveDeepSeekModule("@deepseek-ai/dsh-session/surface") as Record<string, unknown>;
    expect(surface).toMatchObject({
      isSurfaceEligibleType: expect.any(Function),
      isSurfaceEvent: expect.any(Function),
      deriveEventMessage: expect.any(Function),
      foldSurface: expect.any(Function),
    });
    expect((surface.isSurfaceEligibleType as (type: string) => boolean)("user/message")).toBe(true);
    expect((surface.isSurfaceEligibleType as (type: string) => boolean)("turn/start")).toBe(false);
    const foldSurface = surface.foldSurface as (events: readonly unknown[]) => { nodes: number[]; replacements: unknown[] };
    expect(foldSurface([
      { type: "user/message", seq: 1, data: "one", surfaceOp: "append" },
      { type: "assistant/message", seq: 2, data: { message: { content: "two" } }, surfaceOp: "append" },
      { type: "assistant/message", seq: 3, data: { message: { content: "three" } }, surfaceOp: { op: "replace", start: 2, end: 2 } },
    ])).toEqual({ nodes: [1, 3], replacements: [{ seq: 3, start: 2, end: 2, shadowedSeqs: [2] }] });
    const derive = surface.deriveEventMessage as (event: unknown) => unknown;
    expect(derive({ type: "assistant/message", data: { message: { content: "ok" } } })).toEqual({ content: "ok" });
    expect(derive({ type: "assistant/message", data: { message: { content: "" } } })).toBeNull();
  });

  it("exposes the dsh-workspace registry with durable-compatible core behavior", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-dsh-workspace-"));
    const workspacePath = join(root, "workspace");
    await mkdir(workspacePath);
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = root;
    try {
      expect(resolveDeepSeekModule("@deepseek-ai/dsh-workspace/types")).toMatchObject({ WorkspaceId: expect.any(Function) });
      expect(resolveDeepSeekModule("@deepseek-ai/dsh-workspace/invariant")).toMatchObject({ inject: ["workspaceRegistry"] });
      expect(resolveDeepSeekModule("@deepseek-ai/dsh-workspace")).toMatchObject({
        default: DeepSeekWorkspaceRegistryService,
        WorkspaceRegistry: DeepSeekWorkspaceRegistryService,
        WorkspaceId: expect.any(Function),
      });
      const context = new Context();
      context.provide("agentHost", {
        listAllSessions: async () => [
          { sessionId: "session-1", cwd: workspacePath },
          { sessionId: "session-2", cwd: workspacePath },
        ],
      });
      const registry = new DeepSeekWorkspaceRegistryService(context);
      const changes: unknown[] = [];
      context.on("workspace/changed", (change) => changes.push(change));
      const created = await registry.create(workspacePath, "OpenBuddy");
      expect(created.path).toBe(await realpath(workspacePath));
      expect(created.title).toBe("OpenBuddy");
      expect(await registry.create(workspacePath)).toBe(created);
      expect(await registry.resolveByPath(join(workspacePath, "..", "workspace"))).toBe(created);
      await created.attachSession("session-1");
      await created.attachSession("session-2");
      await expect(created.attachSession("missing-session")).rejects.toThrow("unknown session");
      await registry.insertBefore(created.id, undefined);
      await created.insertSessionBefore("session-1");
      await created.setTitle("Renamed");
      expect(created.sessionIds).toEqual(["session-2", "session-1"]);
      expect(created.title).toBe("Renamed");
      await registry.archiveSession("session-2");
      expect(registry.archivedSessionIds).toEqual(["session-2"]);
      await registry.archiveSession("session-2", false);
      expect(registry.archivedSessionIds).toEqual([]);
      await expect(registry.archiveSession("missing-session")).rejects.toThrow("cannot archive session");
      expect(changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "created" }),
        expect.objectContaining({ kind: "updated" }),
        expect.objectContaining({ kind: "archive-changed", sessionId: "session-2" }),
      ]));
      const reloaded = new DeepSeekWorkspaceRegistryService(new Context());
      await reloaded.ready();
      expect(reloaded.list()[0]).toMatchObject({ id: created.id, path: created.path, title: "Renamed", sessionIds: ["session-2", "session-1"] });
      expect(await registry.delete(created.id)).toBe(true);
      expect(registry.list()).toEqual([]);
      expect(await registry.delete(created.id)).toBe(false);
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads standard dsh-base package facades and delegates shared seams", async () => {
    const registeredTools: unknown[] = [];
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => [{ name: "bash" }],
      registerTool: (tool: unknown) => {
        registeredTools.push(tool);
        return () => {
          const index = registeredTools.indexOf(tool);
          if (index >= 0) registeredTools.splice(index, 1);
        };
      },
    });
    context.provide("settings", { configure: (value: unknown) => ({ source: "settings", value }) });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    const entries = [
      ["tools", "@deepseek-ai/dsh-tools"],
      ["tool-bash", "@deepseek-ai/dsh-tool-bash"],
      ["settings", "@deepseek-ai/dsh-settings-file"],
      ["credentials", "@deepseek-ai/dsh-credentials-local"],
      ["fs", "@deepseek-ai/dsh-fs-local"],
      ["subagents", "@deepseek-ai/dsh-subagent"],
      ["workflow", "@deepseek-ai/dsh-workflow-worker-thread"],
    ].map(([id, name]) => ({ id, name }));
    await loader.load(entries);
    const tools = context.get("tools") as { list: () => unknown[]; configure: (value: unknown) => unknown };
    expect(tools.list()).toEqual([{ name: "bash" }]);
    expect(tools.configure({ mode: "native" })).toEqual({ mode: "native" });
    expect(context.get("fs")).toBeDefined();
    expect(context.get("subagents")).toBeDefined();
    expect(registeredTools.map((tool) => (tool as { name: string }).name)).toEqual(["bash"]);
    expect(loader.list().every((entry) => entry.state === "loaded")).toBe(true);
    await loader.dispose();
    expect(context.get("tools")).toBeUndefined();
    expect(registeredTools).toEqual([]);
  });

  it("mounts Pi-native tools for DeepSeek shell and filesystem packages", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => {
          const index = registeredTools.indexOf(tool);
          if (index >= 0) registeredTools.splice(index, 1);
        };
      },
    });
    context.provide("mcpResources", { getCwd: () => process.cwd() });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "bash", name: "@deepseek-ai/dsh-tool-bash", inject: [] },
      { id: "fs", name: "@deepseek-ai/dsh-tool-fs", inject: [] },
      { id: "search", name: "@deepseek-ai/dsh-tool-fs-search", inject: [] },
    ]);
    expect(registeredTools.map((tool) => tool.name)).toEqual(["bash", "read", "write", "edit", "grep", "find", "ls"]);
    expect(registeredTools.every((tool) => typeof tool.execute === "function")).toBe(true);
    await loader.dispose();
    expect(registeredTools).toEqual([]);
  });

  it("runs Pi-backed subagents and controls background jobs", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    let backgroundSignal: AbortSignal | undefined;
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => {
          const index = registeredTools.indexOf(tool);
          if (index >= 0) registeredTools.splice(index, 1);
        };
      },
    });
    context.provide("teamRunner", {
      runMember: async (input: { goal: string }, signal: AbortSignal) => {
        backgroundSignal = signal;
        if (input.goal === "foreground task") return "foreground result";
        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
        return "unreachable";
      },
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "subagent", name: "@deepseek-ai/dsh-tool-subagent", inject: [] },
      { id: "jobs", name: "@deepseek-ai/dsh-tool-jobs", inject: [] },
    ]);
    const subagent = registeredTools.find((tool) => tool.name === "subagent");
    const jobList = registeredTools.find((tool) => tool.name === "job_list");
    const jobOutput = registeredTools.find((tool) => tool.name === "job_output");
    const jobKill = registeredTools.find((tool) => tool.name === "job_kill");
    expect(subagent).toBeDefined();
    expect(jobList).toBeDefined();
    expect(jobOutput).toBeDefined();
    expect(jobKill).toBeDefined();

    const foreground = await subagent!.execute("foreground", {
      description: "foreground",
      prompt: "foreground task",
    });
    expect(foreground.content[0].text).toBe("foreground result");

    const background = await subagent!.execute("background", {
      description: "background",
      prompt: "background task",
      run_in_background: true,
    });
    const jobId = background.details.jobId as string;
    expect(background.content[0].text).toContain(jobId);
    const listed = await jobList!.execute("list", {});
    expect(listed.content[0].text).toContain(jobId);
    const output = await jobOutput!.execute("output", { job_id: jobId });
    expect(output.content[0].text).toBe("(job running)");
    const killed = await jobKill!.execute("kill", { job_id: jobId });
    expect(killed.content[0].text).toContain(jobId);
    expect(backgroundSignal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await jobOutput!.execute("output", { job_id: jobId })).content[0].text).toContain("aborted");
    await loader.dispose();
    expect(registeredTools).toEqual([]);
  });

  it("assembles and disposes real system-prompt contributions", async () => {
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([{ id: "system-prompt", name: "@deepseek-ai/dsh-system-prompt", inject: [] }]);
    const prompt = context.get("systemPrompt") as {
      section: (value: { name: string; order: number; text: string }) => () => void;
      context: (value: { name: string; order: number; text: string }) => () => void;
      variable: (name: string, provider: () => string) => () => void;
      tools: (provider: () => { schemas: unknown[] }) => () => void;
      assemble: () => Promise<{ sections: Array<{ text: string }>; contexts: Array<{ text: string }>; tools: unknown[] }>;
      render: () => string;
    };
    const disposeSection = prompt.section({ name: "persona", order: 0, text: "Hello {{name}}" });
    const disposeContext = prompt.context({ name: "runtime", order: 0, text: "runtime context" });
    prompt.variable("name", () => "Pi");
    prompt.tools(() => ({ schemas: [{ name: "bash" }] }));
    const assembly = await prompt.assemble();
    expect(assembly.sections).toEqual([{ name: "persona", text: "Hello {{name}}" }]);
    expect(assembly.contexts).toEqual([{ name: "runtime", text: "runtime context" }]);
    expect(assembly.tools).toEqual([{ name: "bash" }]);
    expect(prompt.render()).toBe("Hello Pi");
    expect((prompt as unknown as { renderContext: () => string }).renderContext()).toBe("runtime context");
    disposeSection();
    disposeContext();
    expect(prompt.render()).toBe("");
    await loader.dispose();
    expect(context.get("systemPrompt")).toBeUndefined();
  });

  it("provides persistent settings and credentials seams", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-dsh-"));
    const previousRoot = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = root;
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    try {
      await loader.load([
        { id: "settings", name: "@deepseek-ai/dsh-settings-file", inject: [] },
        { id: "credentials", name: "@deepseek-ai/dsh-credentials-local", inject: [] },
      ]);
      const settings = context.get("settings") as {
        register: (namespace: string, schema: (value: unknown) => unknown, options?: { base?: Record<string, unknown> }) => { get: () => unknown; update: (patch: unknown) => Promise<void>; replace: (value: unknown) => Promise<void>; watch: (callback: (next: unknown, previous: unknown) => void) => () => void };
        describe: () => Array<{ ns: string; revision: number }>;
      };
      const changes: unknown[] = [];
      const scope = settings.register("llm-pi-ai", (value) => value, { base: { enabled: true } });
      scope.watch((next) => changes.push(next));
      expect(scope.get()).toEqual({ enabled: true });
      await scope.update({ provider: "deepseek" });
      expect(scope.get()).toEqual({ enabled: true, provider: "deepseek" });
      await scope.replace({ model: "deepseek-chat" });
      expect(scope.get()).toEqual({ enabled: true, model: "deepseek-chat" });
      expect(changes).toHaveLength(2);
      expect(settings.describe()[0]).toMatchObject({ ns: "llm-pi-ai", revision: 2 });

      const credentials = context.get("credentials") as {
        set: (ref: string, value: string) => Promise<void>;
        resolve: (ref: string) => Promise<{ value: string; source: string } | undefined>;
        describe: (ref: string) => Promise<{ configured: boolean; source?: string; writable: boolean }>;
        modifyRecord: (key: string, mutate: (current: unknown) => Promise<unknown>) => Promise<unknown>;
        readRecord: (key: string) => Promise<unknown>;
      };
      await credentials.set("OPENBUDDY_TEST_KEY", "file-secret");
      await expect(credentials.resolve("OPENBUDDY_TEST_KEY")).resolves.toEqual({ value: "file-secret", source: "keychain" });
      process.env.OPENBUDDY_TEST_KEY = "env-secret";
      await expect(credentials.resolve("OPENBUDDY_TEST_KEY")).resolves.toEqual({ value: "env-secret", source: "env" });
      await expect(credentials.describe("OPENBUDDY_TEST_KEY")).resolves.toEqual({ configured: true, source: "env", writable: false });
      await credentials.modifyRecord("llm-pi-ai/deepseek", async () => ({ kind: "grant", payload: { token: "opaque" } }));
      await expect(credentials.readRecord("llm-pi-ai/deepseek")).resolves.toEqual({ kind: "grant", payload: { token: "opaque" } });
      expect(await readFile(join(root, "dsh-settings.json"), "utf8")).toContain("deepseek-chat");
      if (existsSync(join(root, "dsh-credentials.json"))) expect((await readFile(join(root, "dsh-credentials.json"), "utf8")).includes("file-secret")).toBe(false);
    } finally {
      delete process.env.OPENBUDDY_TEST_KEY;
      await loader.dispose();
      if (previousRoot === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists the default model through the settings-backed agent service", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-dsh-model-"));
    const previousRoot = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = root;
    const context = new Context();
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    try {
      await loader.load([
        { id: "settings", name: "@deepseek-ai/dsh-settings-file", inject: [] },
        { id: "llm", name: "@deepseek-ai/dsh-llm", inject: [] },
        { id: "agent-default", name: "@deepseek-ai/dsh-agent-default-model", config: { provider: "pi", model: "demo" }, inject: [] },
      ]);
      const agentDefault = context.get("agentDefaultModel") as { get: () => unknown; saveSelection: (value: unknown) => Promise<void> };
      expect(agentDefault.get()).toEqual({ provider: "pi", model: "demo" });
      await agentDefault.saveSelection({ provider: "deepseek", model: "deepseek-chat" });
      expect(agentDefault.get()).toEqual({ provider: "deepseek", model: "deepseek-chat" });
      expect(await readFile(join(root, "dsh-settings.json"), "utf8")).toContain("deepseek-chat");
    } finally {
      await loader.dispose();
      if (previousRoot === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousRoot;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("maps dsh todo_write onto the persistent OpenBuddy task service", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    const entries: Array<{ id: string; content: string; status: string; order: number }> = [];
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => { const index = registeredTools.indexOf(tool); if (index >= 0) registeredTools.splice(index, 1); };
      },
    });
    context.provide("agentHost", { getSessionId: () => "todo-session" });
    context.provide("task", {
      list: async () => entries.map(({ id }) => ({ id })),
      add: async (_sessionId: string, content: string) => { const item = { id: `task-${entries.length}`, content, status: "pending", order: entries.length }; entries.push(item); return item; },
      update: async (_sessionId: string, id: string, patch: { status: string; order: number }) => { const item = entries.find((entry) => entry.id === id); if (item) Object.assign(item, patch); return item; },
      remove: async (_sessionId: string, id: string) => { const index = entries.findIndex((entry) => entry.id === id); if (index >= 0) entries.splice(index, 1); },
    });
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    await loader.load([{ id: "todo", name: "@deepseek-ai/dsh-tool-todo", config: { allowParallelInProgress: false }, inject: [] }]);
    const todo = registeredTools.find((tool) => tool.name === "todo_write");
    expect(todo).toBeDefined();
    const result = await todo!.execute("todo", { todos: [{ content: "inspect code", status: "in_progress" }, { content: "write tests", status: "pending" }] });
    expect(result.details.counts).toEqual({ pending: 1, inProgress: 1, completed: 0 });
    expect(entries.map(({ content, status, order }) => ({ content, status, order }))).toEqual([
      { content: "inspect code", status: "in_progress", order: 0 },
      { content: "write tests", status: "pending", order: 1 },
    ]);
    await expect(todo!.execute("todo", { todos: [{ content: "a", status: "in_progress" }, { content: "b", status: "in_progress" }] })).rejects.toThrow("at most one");
    await expect(todo!.execute("todo", { todos: [{ content: "a", status: "pending" }, { content: "a", status: "completed" }] })).rejects.toThrow("duplicate");
    await loader.dispose();
    expect(registeredTools).toEqual([]);
  });

  it("maps Harness goal tools onto Pi-backed OpenBuddy services", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    const goal: {
      id: string;
      revision: number;
      objective: string;
      phase: string;
      roundsStarted: number;
      maxGoalRounds: number;
      activation: string;
      blockedReason?: { code: string; message: string };
    } = { id: "goal-1", revision: 1, objective: "ship", phase: "active", roundsStarted: 0, maxGoalRounds: 3, activation: "armed" };
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => { const index = registeredTools.indexOf(tool); if (index >= 0) registeredTools.splice(index, 1); };
      },
    });
    context.provide("agentHost", { getSessionId: () => "goal-web-session" });
    context.provide("dshRemotes", {
      goalsGet: async () => ({ ...goal }),
      goalsCreate: async (_agent: unknown, request: { objective: string }) => { goal.objective = request.objective; goal.revision = 1; return { ref: { id: goal.id, revision: goal.revision } }; },
      goalsEdit: async (_agent: unknown, ref: { revision: number }, patch: { objective?: string }) => { if (ref.revision !== goal.revision) throw new Error("goal revision conflict"); goal.revision += 1; if (patch.objective) goal.objective = patch.objective; return { ...goal }; },
      goalsPause: async () => { goal.revision += 1; goal.phase = "paused"; goal.activation = "disarmed"; return { ...goal }; },
      goalsResume: async () => { goal.revision += 1; goal.phase = "active"; goal.activation = "armed"; return { ...goal }; },
      goalsComplete: async () => { goal.revision += 1; goal.phase = "complete"; goal.activation = "disarmed"; return { ...goal }; },
      goalsBlocked: async (_agent: unknown, _ref: unknown, reason: string) => { goal.revision += 1; goal.phase = "blocked"; goal.activation = "disarmed"; goal.blockedReason = { code: "MODEL_REPORTED_BLOCKED", message: reason }; return { ...goal }; },
    });
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    await loader.load([
      { id: "goal", name: "@deepseek-ai/dsh-tool-goal", inject: [] },
    ]);
    const getGoal = registeredTools.find((tool) => tool.name === "get_goal");
    const createGoal = registeredTools.find((tool) => tool.name === "create_goal");
    const updateGoal = registeredTools.find((tool) => tool.name === "update_goal");
    expect(getGoal && createGoal && updateGoal).toBeTruthy();
    expect((await getGoal!.execute("get", {})).details.goal.objective).toBe("ship");
    await createGoal!.execute("create", { objective: "new objective" });
    await updateGoal!.execute("update", { goal_id: "goal-1", revision: 1, action: "complete" });
    // dsh-tool-web is no-op now: openbuddy-web-search is removed; web access
    // is delegated to the pi-web-access extension. Loading dsh-tool-web must
    // not register any tools.
    await loader.load([{ id: "web", name: "@deepseek-ai/dsh-tool-web", inject: [] }]);
    const webSearch = registeredTools.find((tool) => tool.name === "web_search");
    const webFetch = registeredTools.find((tool) => tool.name === "web_fetch");
    expect(webSearch).toBeUndefined();
    expect(webFetch).toBeUndefined();
    await loader.dispose();
    expect(registeredTools).toEqual([]);
  });

  it("maps Harness editor and skill tools onto OpenBuddy resource seams", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-editor-"));
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    const files = new Map<string, string>();
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => { const index = registeredTools.indexOf(tool); if (index >= 0) registeredTools.splice(index, 1); };
      },
    });
    context.provide("mcpResources", { getCwd: () => root });
    context.provide("fsLocal", {
      stat: async (path: string) => ({ exists: files.has(path), kind: "file", absolute: path }),
      readTextFile: async (path: string) => files.get(path) ?? (() => { throw new Error("missing"); })(),
      writeTextFile: async (path: string, content: string) => { files.set(path, content); return path; },
      listDir: async () => [],
    });
    context.provide("piResources", {
      listSkills: async () => [{ name: "release", description: "Release checklist", path: join(root, "skills", "release") }],
      readSkill: async (name: string) => ({ name, description: "Release checklist", path: join(root, "skills", name), content: "Run tests before shipping." }),
    });
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    await loader.load([
      { id: "editor", name: "@deepseek-ai/dsh-tool-str-replace-editor", inject: [] },
      { id: "skill", name: "@deepseek-ai/dsh-tool-skill", inject: [] },
    ]);
    const editor = registeredTools.find((tool) => tool.name === "str_replace_editor");
    const skill = registeredTools.find((tool) => tool.name === "skill");
    expect(editor && skill).toBeTruthy();
    const file = join(root, "note.txt");
    await editor!.execute("create", { command: "create", path: file, file_text: "hello\nworld" });
    expect((await editor!.execute("view", { command: "view", path: file })).details.kind).toBe("file");
    await editor!.execute("insert", { command: "insert", path: file, insert_line: 1, new_str: "middle" });
    await editor!.execute("replace", { command: "str_replace", path: file, old_str: "middle", new_str: "there" });
    expect(files.get(file)).toBe("hello\nthere\nworld");
    await expect(editor!.execute("replace", { command: "str_replace", path: file, old_str: "o", new_str: "x" })).rejects.toThrow("must be unique");
    const loaded = await skill!.execute("skill", { name: "release" });
    expect(loaded.details).toMatchObject({ name: "release", content: "Run tests before shipping." });
    await loader.dispose();
    expect(registeredTools).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });

  it("runs Harness workflow scripts through the Pi team runner", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    const calls: string[] = [];
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => { const index = registeredTools.indexOf(tool); if (index >= 0) registeredTools.splice(index, 1); };
      },
    });
    context.provide("teamRunner", {
      runMember: async (input: { goal: string }, signal: AbortSignal) => {
        signal.throwIfAborted();
        calls.push(input.goal);
        return `done:${input.goal}`;
      },
    });
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    await loader.load([{ id: "workflow", name: "@deepseek-ai/dsh-tool-workflow", inject: [], config: { maxTotalAgents: 4 } }]);
    const workflow = registeredTools.find((tool) => tool.name === "workflow");
    expect(workflow).toBeDefined();
    const result = await workflow!.execute("workflow", {
      meta: { name: "fan-out", description: "fan out" },
      args: { values: ["a", "b"] },
      script: "const results = await parallel(args.values.map((value) => () => agent(`work:${value}`))); return { results };",
    });
    expect(result.details).toMatchObject({ agentsStarted: 2, result: { results: ["done:work:a", "done:work:b"] } });
    expect(calls).toEqual(["work:a", "work:b"]);
    await expect(workflow!.execute("workflow", { meta: { name: "bad", description: "bad" }, script: "return await parallel([1]);" })).rejects.toThrow("parallel entries");
    await loader.dispose();
    expect(registeredTools).toEqual([]);
  });

  it("enforces workflow parse, agent-cap, and cancellation semantics", async () => {
    const registeredTools: Array<{ name: string; execute: Function }> = [];
    let startedSignal: AbortSignal | undefined;
    const context = new Context();
    context.provide("toolRegistry", {
      list: () => registeredTools,
      registerTool: (tool: { name: string; execute: Function }) => {
        registeredTools.push(tool);
        return () => { const index = registeredTools.indexOf(tool); if (index >= 0) registeredTools.splice(index, 1); };
      },
    });
    context.provide("teamRunner", {
      runMember: async (_input: { goal: string }, signal: AbortSignal) => {
        startedSignal = signal;
        await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      },
    });
    const loader = new HarnessPluginLoader({ context, importer: async (specifier) => resolveDeepSeekModule(specifier) });
    await loader.load([{ id: "workflow", name: "@deepseek-ai/dsh-tool-workflow", inject: [], config: { maxTotalAgents: 1 } }]);
    const workflow = registeredTools.find((tool) => tool.name === "workflow")!;
    await expect(workflow.execute("parse", { meta: { name: "parse", description: "parse" }, script: "export const meta = {};" })).rejects.toThrow("meta request field");
    await expect(workflow.execute("cap", { meta: { name: "cap", description: "cap" }, script: "return await parallel([() => agent('one'), () => agent('two')]);" })).rejects.toThrow("agent cap");
    const controller = new AbortController();
    const pending = workflow.execute("cancel", { meta: { name: "cancel", description: "cancel" }, script: "return await agent('wait');" }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(startedSignal?.aborted).toBe(true);
    await loader.dispose();
  });

  it("resolves and loads every enabled package from the dsh-base patch", async () => {
    const source = await readFile(
      "/Users/louloulin/appx/deepseek-harness/packages/bundle/base/cordis.patch.yml",
      "utf8",
    );
    const rows = parseCordisPatch(source).layers.flatMap((layer) => layer.rows);
    const packages = [...new Set(rows.flatMap((row) => {
      if (!("insert" in row)) return [];
      return row.insert
        .filter((entry) => entry.disabled !== true && entry.name.startsWith("@deepseek-ai/"))
        .map((entry) => entry.name);
    }))];
    expect(packages.length).toBeGreaterThan(60);
    expect(packages.every((name) => resolveDeepSeekModule(name) !== undefined)).toBe(true);

    const context = new Context();
    context.provide("dshRemotes", {});
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load(packages.map((name, index) => ({ id: `dsh-base-${index}`, name, inject: [] })));
    expect(loader.list().filter((entry) => entry.state !== "loaded")).toEqual([]);
    await loader.dispose();
  });

  it("resolves generic host, remote, client, and invariant package faces", () => {
    const host = resolveDeepSeekModule("@deepseek-ai/dsh-tool-bash") as Record<string, unknown>;
    expect(host).toMatchObject({ default: expect.any(Object), apply: expect.any(Function) });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-tool-bash/remote")).toMatchObject({
      default: { package: "@deepseek-ai/dsh-tool-bash", descriptors: expect.any(Array) },
      TYPERT_REMOTE: expect.any(Object),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-tool-bash/client")).toMatchObject({
      default: expect.any(Object),
      apply: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/dsh-tool-bash/invariant")).toMatchObject({
      name: expect.stringContaining("dsh-tool-bash"),
      apply: expect.any(Function),
    });
    expect(resolveDeepSeekModule("react")).toBeUndefined();
  });

  it("loads the Pi-backed service graph through the normal Harness loader", async () => {
    const context = new Context();
    context.provide("modelRuntime", {
      getProviders: () => [{ id: "pi", name: "Pi" }],
      getModels: () => [{
        provider: "pi",
        id: "demo",
        name: "Demo",
        input: ["text"],
        contextWindow: 4096,
        maxTokens: 512,
      }],
      getModel: () => undefined,
    });
    context.provide("eventLog", { list: () => [] });
    context.provide("dshRemotes", {});
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "typert", name: "@deepseek-ai/dsh-typert-registry" },
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
      { id: "agent-default-model", name: "@deepseek-ai/dsh-agent-default-model", config: { provider: "pi", model: "demo" } },
      { id: "persistence", name: "@deepseek-ai/dsh-session-persistence-jsonl" },
    ]);
    expect((context.get("llm") as { listProviders: () => unknown[] }).listProviders()).toEqual([{ id: "pi", name: "Pi" }]);
    const sessions = context.get("sessions") as unknown as { list: (...args: unknown[]) => unknown[] };
    const singularSession = context.get("session") as unknown as { list: () => unknown[] };
    expect(sessions).toBeDefined();
    expect(singularSession).toBeDefined();
    expect(singularSession.list()).toEqual(sessions.list());
    expect(singularSession).toHaveProperty("get");
    expect(sessions.list()).toEqual([]);
    expect((context.get("agentDefaultModel") as { get: () => unknown }).get()).toEqual({ provider: "pi", model: "demo" });
    expect(loader.list().every((entry) => entry.state === "loaded")).toBe(true);
    await loader.dispose();
    expect(context.get("llm")).toBeUndefined();
    expect(context.get("sessions")).toBeUndefined();
    expect(context.get("session")).toBeUndefined();
  });

  it("owns Pi-backed AgentLoop handles, rolls back setup, and rejects persisted create collisions", async () => {
    const disposed: string[] = [];
    const persisted = new Set<string>();
    const sourceListeners = new Map<string, (event: unknown) => void>();
    const lifecycle: string[] = [];
    const reservations = new Set<string>();
    const renewals = new Map<string, number>();
    const context = new Context();
    const createSource = (sessionId: string) => ({
      sessionId,
      cwd: "/workspace",
      messages: [],
      isStreaming: false,
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      inject: async () => undefined,
      abort: async () => undefined,
      waitForIdle: async () => undefined,
      subscribe: (listener: (event: unknown) => void) => {
        sourceListeners.set(sessionId, listener);
        return () => sourceListeners.delete(sessionId);
      },
      dispose: async () => { disposed.push(sessionId); },
    });
    context.on("session/event", (session: { sessionId: string }, event: { type: string }) => lifecycle.push(`event:${session.sessionId}:${event.type}`));
    context.on("agent/session-start", ({ agent, source }: { agent: { id: string }; source: string }) => lifecycle.push(`start:${agent.id}:${source}`));
    context.provide("agentHost", {
      listAllSessions: async () => [...persisted].map((id) => ({ id })),
      reserveAgent: async (sessionId: string, operation: "create" | "resume") => {
        if (reservations.has(sessionId)) throw Object.assign(new Error(`reserved: ${sessionId}`), { code: "agent-reservation-conflict", operation });
        reservations.add(sessionId);
        return {
          token: sessionId,
          heartbeatMs: 5,
          renew: () => { renewals.set(sessionId, (renewals.get(sessionId) ?? 0) + 1); },
          release: () => { reservations.delete(sessionId); },
        };
      },
      createAgent: async ({ sessionId }: { sessionId: string }) => createSource(sessionId),
      resumeAgent: async ({ sessionId }: { sessionId: string }) => createSource(sessionId),
    });
    context.provide("modelRuntime", {
      getProviders: () => [],
      getModels: () => [],
      getModel: () => undefined,
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
    ]);

    const agents = context.get("agents") as DeepSeekAgentService;
    const setupDisposed: string[] = [];
    const first = await agents.create({
      sessionId: "owned-agent",
      setup: async () => () => { setupDisposed.push("owned-agent"); },
    });
    expect(reservations.has("owned-agent")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(renewals.get("owned-agent")).toBeGreaterThan(0);
    expect(agents.get("owned-agent")).toBe(first.agent);
    sourceListeners.get("owned-agent")?.({ type: "agent_start" });
    expect(lifecycle).toEqual(["start:owned-agent:startup", "event:owned-agent:agent_start"]);
    await first.dispose();
    expect(reservations.has("owned-agent")).toBe(false);
    const renewalsAfterDispose = renewals.get("owned-agent") ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(renewals.get("owned-agent") ?? 0).toBe(renewalsAfterDispose);
    expect(disposed).toEqual(["owned-agent"]);
    expect(setupDisposed).toEqual(["owned-agent"]);
    expect(agents.get("owned-agent")).toBeUndefined();

    const reusable = await agents.create({ sessionId: "owned-agent" });
    await reusable.dispose();
    expect(disposed).toEqual(["owned-agent", "owned-agent"]);

    persisted.add("persisted-agent");
    await expect(agents.create({ sessionId: "persisted-agent" })).rejects.toThrow("already exists");

    await expect(agents.create({
      sessionId: "setup-failure",
      setup: async () => { throw new Error("setup failed"); },
    })).rejects.toThrow("setup failed");
    expect(disposed).toContain("setup-failure");
    expect(agents.get("setup-failure")).toBeUndefined();

    await loader.dispose();
    expect(context.get("agents")).toBeUndefined();
  });

  it("cancels in-flight Pi lifecycle work when the AgentLoop plugin unloads", async () => {
    let createAborted = false;
    let createStarted!: () => void;
    const started = new Promise<void>((resolve) => { createStarted = resolve; });
    const context = new Context();
    context.provide("agentHost", {
      createAgent: ({ signal }: { signal?: AbortSignal }) => new Promise<never>((_, reject) => {
        createStarted();
        signal?.addEventListener("abort", () => { createAborted = true; reject(signal.reason); }, { once: true });
      }),
      resumeAgent: async () => { throw new Error("not reached"); },
      listAllSessions: async () => [],
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
    ]);
    const create = (context.get("agents") as DeepSeekAgentService).create({ sessionId: "in-flight" });
    const settledCreate = create.then(() => undefined, () => undefined);
    await started;
    await loader.dispose();
    await expect(create).rejects.toThrow("agent factory is disposed");
    await settledCreate;
    expect(createAborted).toBe(true);
  });

  it("releases a prepared session when Pi resume fails", async () => {
    let preparationDisposed = 0;
    const context = new Context();
    context.provide("agentHost", {
      resumeAgent: async () => { throw new Error("resume failed"); },
      createAgent: async () => { throw new Error("not reached"); },
      listAllSessions: async () => [{ id: "resume-agent" }],
    });
    context.provide("sessionPersistence", {
      prepare: async () => ({ dispose: () => { preparationDisposed += 1; } }),
    });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([
      { id: "llm", name: "@deepseek-ai/dsh-llm" },
      { id: "session", name: "@deepseek-ai/dsh-session" },
      { id: "agent", name: "@deepseek-ai/dsh-agent" },
      { id: "agent-loop", name: "@deepseek-ai/dsh-agent-loop" },
    ]);
    await expect((context.get("agents") as DeepSeekAgentService).resume({ resumeSessionId: "resume-agent" })).rejects.toThrow("resume failed");
    expect(preparationDisposed).toBe(1);
    await loader.dispose();
  });

  it("keeps the DSH session facade separate from the canonical OpenBuddy sessions service", async () => {
    const piSession = {
      sessionId: "pi-session-1",
      messages: [],
      prompt: async () => undefined,
      steer: async () => undefined,
      followUp: async () => undefined,
      abort: async () => undefined,
      subscribe: () => () => undefined,
    };
    const canonicalSessions = {
      get: () => { throw new Error("canonical sessions API must not be used by DSH agent"); },
      list: () => { throw new Error("canonical sessions API must not be used by DSH agent"); },
    };
    const context = new Context();
    context.provide("sessions", canonicalSessions);
    context.provide("pi", { getSession: () => piSession });
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });

    await loader.load([
      { id: "session", name: "@deepseek-ai/dsh-session", inject: [] },
      { id: "agent", name: "@deepseek-ai/dsh-agent", inject: [] },
    ]);

    expect(context.get("sessions")).toBeDefined();
    expect(context.get("sessions")).not.toBe(context.get("dshSessions"));
    expect(context.get("dshSessions")).toMatchObject({ get: expect.any(Function), list: expect.any(Function) });
    expect(context.get("session")).toMatchObject({ get: expect.any(Function), list: expect.any(Function) });
    expect((context.get("session") as { get: () => { sessionId: string } }).get().sessionId).toBe("pi-session-1");
    expect((context.get("agents") as DeepSeekAgentService).get()?.sessionId).toBe("pi-session-1");
    expect((context.get("agents") as DeepSeekAgentService).list()).toHaveLength(1);

    await loader.dispose();
    expect(context.get("sessions")).toBeDefined();
    expect(context.get("sessions")).not.toBe(context.get("dshSessions"));
    expect(context.get("dshSessions")).toBeUndefined();
    expect(context.get("session")).toBeUndefined();
  });

  it("provides the Harness session preparation and publication lifecycle without a second Pi loop", async () => {
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([{ id: "session", name: "@deepseek-ai/dsh-session", inject: [] }]);
    const sessions = context.get("sessions") as unknown as DeepSeekSessionService;
    const prepared = sessions.prepare("harness-lifecycle", { meta: { cwd: "/workspace" } });
    const detach = sessions.enter(prepared);
    sessions.announce(prepared);
    expect(sessions.get("harness-lifecycle")).toMatchObject({ id: "harness-lifecycle", sessionId: "harness-lifecycle" });
    await expect(sessions.flush(prepared)).resolves.toBe(false);
    detach();
    expect(sessions.get("harness-lifecycle")).toBeUndefined();
    await loader.dispose();
  });

  it("provides the reusable Cordis infrastructure facades used by dsh-base", () => {
    expect(resolveDeepSeekModule("@deepseek-ai/cordis-plugin-timer")).toMatchObject({
      default: expect.any(Function),
      TimerService: expect.any(Function),
    });
    expect(resolveDeepSeekModule("@deepseek-ai/cordis-plugin-group")).toMatchObject({
      default: { name: "@deepseek-ai/cordis-plugin-group" },
      Group: { name: "@deepseek-ai/cordis-plugin-group" },
    });
    expect(resolveDeepSeekModule("@deepseek-ai/cordis-plugin-hmr")).toMatchObject({
      default: expect.any(Function),
      Hmr: expect.any(Function),
    });
  });

  it("runs the timer facade as a reversible Cordis service", async () => {
    const context = new Context();
    const loader = new HarnessPluginLoader({
      context,
      importer: async (specifier) => resolveDeepSeekModule(specifier),
    });
    await loader.load([{ id: "timer", name: "@deepseek-ai/cordis-plugin-timer" }]);
    const timer = context.get("timer") as { timeout(delay: number): Promise<void>; debounce(callback: () => void, delay: number): { (): void; dispose(): void } };
    await expect(timer.timeout(0)).resolves.toBeUndefined();
    let calls = 0;
    const debounced = timer.debounce(() => { calls += 1; }, 1);
    debounced();
    debounced.dispose();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(calls).toBe(0);
    await loader.dispose();
    expect(context.get("timer")).toBeUndefined();
  });
});
