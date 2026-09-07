/**
 * session-projection.test.ts — smoke tests for session projection baselines.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  installSessionProjection,
  sessionBaselines,
  sessionProjectionBaseline,
  __resetSessionProjectionForTest,
} from "./session-projection";
import { createDefaultAgentHostState } from "./_default-state";

afterEach(() => {
  __resetSessionProjectionForTest();
});

describe("session-projection", () => {
  it("sessionBaselines aggregates event sequences + persists IDs", async () => {
    installSessionProjection({
      state: createDefaultAgentHostState(),
      pluginEvents: () => [
        { sessionId: "s1", sessionSequence: 5, sequence: 5 } as any,
        { sessionId: "s1", sessionSequence: 10, sequence: 10 } as any,
        { sessionId: "s2", sessionSequence: 3, sequence: 3 } as any,
        { sessionId: undefined, sequence: 999 } as any,
      ],
      listPersistedSessionInfos: async () => [{ id: "s3" }, { id: "s4" }],
      readPersistedSessionHeader: async () => ({}),
    });
    const baselines = await sessionBaselines();
    const map = new Map(baselines.map((b) => [b.sessionId, b.lastSeq]));
    expect(map.get("s1")).toBe(10);
    expect(map.get("s2")).toBe(3);
    expect(map.get("s3")).toBe(-1); // not in event log, fallback to -1
    expect(map.get("s4")).toBe(-1);
  });

  it("sessionBaselines tolerates persisted session info throwing", async () => {
    installSessionProjection({
      state: createDefaultAgentHostState(),
      pluginEvents: () => [{ sessionId: "s1", sessionSequence: 5, sequence: 5 } as any],
      listPersistedSessionInfos: async () => { throw new Error("disk gone"); },
      readPersistedSessionHeader: async () => ({}),
    });
    const baselines = await sessionBaselines();
    expect(baselines).toEqual([{ sessionId: "s1", lastSeq: 5 }]);
  });

  it("sessionProjectionBaseline reads session/projection entries, last-write-wins", async () => {
    installSessionProjection({
      state: createDefaultAgentHostState(),
      pluginEvents: (q: any) => {
        if (q?.sessionId !== "s1") return [];
        return [
          { sessionId: "s1", type: "session/projection", payload: { key: "a", value: 1 }, sessionSequence: 5, sequence: 5 } as any,
          { sessionId: "s1", type: "session/projection", payload: { key: "b", value: 2 }, sessionSequence: 6, sequence: 6 } as any,
          { sessionId: "s1", type: "session/projection", payload: { key: "a", value: 99 }, sessionSequence: 7, sequence: 7 } as any,
          { sessionId: "s1", type: "session/projection", payload: { key: 5, value: "bad" }, sessionSequence: 8, sequence: 8 } as any,
        ];
      },
      listPersistedSessionInfos: async () => [],
      readPersistedSessionHeader: async () => ({}),
    });
    const result = await sessionProjectionBaseline("s1");
    expect(result.asOfSeq).toBe(8);
    expect(result.values).toEqual({ a: 99, b: 2 });
  });

  it("sessionProjectionBaseline falls back to persisted header.title", async () => {
    installSessionProjection({
      state: createDefaultAgentHostState(),
      pluginEvents: () => [],
      listPersistedSessionInfos: async () => [],
      readPersistedSessionHeader: async () => ({ title: "MySession" }),
    });
    const result = await sessionProjectionBaseline("s1");
    expect(result.values.title).toBe("MySession");
  });
});
