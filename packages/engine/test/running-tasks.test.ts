// @vitest-environment node
// 运行中 (pii W4.5): tasks_list maps live slots to automation / subagent / bash / task rows.
import { describe, expect, it } from "vitest";
import { running } from "../src/session-pool.js";
import type { EngineContext } from "../src/engine-context.js";
import type { Slot } from "../src/types.js";

function slot(id: string, patch: Partial<Slot> = {}): Slot {
  return {
    id,
    session: { sessionManager: { getCwd: () => "/ws" } },
    unsubscribe: () => {},
    busy: true,
    generation: 1,
    cancelledGeneration: -1,
    stale: false,
    lastActive: 0,
    failed: false,
    defaultTools: [],
    ...patch,
  } as unknown as Slot;
}

function engine(slots: Slot[]): EngineContext {
  return {
    slots: new Map(slots.map((s) => [s.id, s])),
    settings: { config: { read: () => ({ sessions: { a1: { title: "每日销售摘要" } } }) } },
    permissions: { countPending: (id: string) => (id === "a1" ? 2 : 0) },
    ui: { hasPending: (id: string) => id === "p1" },
  } as unknown as EngineContext;
}

describe("tasks_list (pii W4.5)", () => {
  it("maps kind, title, elapsed, pending and parent, sorted by start time", () => {
    const rows = running(engine([
      slot("p1", { busySince: 300, session: { sessionManager: { getCwd: () => "/ws" } } as Slot["session"] }),
      slot("a1", { busySince: 100, automation: { id: "task-1", name: "每日销售摘要" } }),
      slot("c1", { busySince: 200, subagent: true, parentId: "p1", agentName: "调研子代理" }),
      slot("b1", { busy: false, userBash: true, lastActive: 50 }),
      slot("idle"),
    ].map((s) => (s.id === "idle" ? { ...s, busy: false } : s))));
    expect(rows.map((row) => row.id)).toEqual(["b1", "a1", "c1", "p1"]);
    expect(rows.find((row) => row.id === "a1")).toMatchObject({
      kind: "automation",
      description: "每日销售摘要",
      title: "每日销售摘要",
      startedAt: 100,
      pending: 2,
      cwd: "/ws",
    });
    expect(rows.find((row) => row.id === "c1")).toMatchObject({
      kind: "subagent",
      description: "调研子代理",
      parentId: "p1",
    });
    expect(rows.find((row) => row.id === "b1")).toMatchObject({ kind: "bash", status: "running-bash" });
    expect(rows.find((row) => row.id === "p1")).toMatchObject({ kind: "task", pending: 1 });
  });
});
