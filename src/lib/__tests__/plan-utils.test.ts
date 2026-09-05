import { describe, it, expect } from "vitest";
import type { Plan } from "@openbuddy/shared-types";
import {
  reorderPlan,
  addPlanEntry,
  removePlanEntry,
  setEntryStatus,
  setEntryPriority,
  setEntryContent,
  cycleEntryStatus,
  planStats,
} from "../ui/plan-utils";

const plan: Plan = {
  entries: [
    { content: "a", priority: "high", status: "completed" },
    { content: "b", priority: "medium", status: "in_progress" },
    { content: "c", priority: "low", status: "pending" },
  ],
};

describe("reorderPlan", () => {
  it("移动首条到末尾", () => {
    const r = reorderPlan(plan, 0, 2);
    expect(r.entries.map((e) => e.content)).toEqual(["b", "c", "a"]);
  });
  it("to 越界 clamp", () => {
    const r = reorderPlan(plan, 0, 99);
    expect(r.entries.map((e) => e.content)).toEqual(["b", "c", "a"]);
  });
  it("相同位置返回原 plan(引用相等)", () => {
    expect(reorderPlan(plan, 1, 1)).toBe(plan);
  });
  it("非法 from 返回原 plan", () => {
    expect(reorderPlan(plan, 9, 0)).toBe(plan);
  });
  it("不修改原 plan(不可变)", () => {
    const before = plan.entries.map((e) => e.content);
    reorderPlan(plan, 0, 2);
    expect(plan.entries.map((e) => e.content)).toEqual(before);
  });
});

describe("addPlanEntry", () => {
  it("追加到末尾(默认 medium/pending)", () => {
    const r = addPlanEntry(plan, "d");
    expect(r.entries).toHaveLength(4);
    expect(r.entries[3]).toEqual({ content: "d", priority: "medium", status: "pending" });
  });
  it("指定优先级", () => {
    const r = addPlanEntry(plan, "d", "high");
    expect(r.entries[3].priority).toBe("high");
  });
  it("空内容不追加(返回原 plan)", () => {
    expect(addPlanEntry(plan, "   ")).toBe(plan);
  });
  it("不修改原 plan", () => {
    addPlanEntry(plan, "d");
    expect(plan.entries).toHaveLength(3);
  });
});

describe("removePlanEntry", () => {
  it("删除指定 index", () => {
    const r = removePlanEntry(plan, 1);
    expect(r.entries.map((e) => e.content)).toEqual(["a", "c"]);
  });
  it("非法 index 返回原 plan", () => {
    expect(removePlanEntry(plan, 9)).toBe(plan);
  });
});

describe("setEntryStatus / setEntryPriority / setEntryContent", () => {
  it("setEntryStatus", () => {
    expect(setEntryStatus(plan, 2, "completed").entries[2].status).toBe("completed");
  });
  it("setEntryPriority", () => {
    expect(setEntryPriority(plan, 0, "low").entries[0].priority).toBe("low");
  });
  it("setEntryContent", () => {
    expect(setEntryContent(plan, 0, "新内容").entries[0].content).toBe("新内容");
  });
  it("setEntryContent 空内容不修改(返回原 plan)", () => {
    expect(setEntryContent(plan, 0, "  ")).toBe(plan);
  });
  it("非法 index 返回原 plan", () => {
    expect(setEntryStatus(plan, 9, "completed")).toBe(plan);
    expect(setEntryPriority(plan, 9, "low")).toBe(plan);
    expect(setEntryContent(plan, 9, "x")).toBe(plan);
  });
  it("不修改原 plan", () => {
    setEntryStatus(plan, 0, "pending");
    expect(plan.entries[0].status).toBe("completed");
  });
});

describe("cycleEntryStatus", () => {
  it("pending → in_progress → completed → pending", () => {
    let p = plan;
    p = cycleEntryStatus(p, 2); // pending → in_progress
    expect(p.entries[2].status).toBe("in_progress");
    p = cycleEntryStatus(p, 2); // → completed
    expect(p.entries[2].status).toBe("completed");
    p = cycleEntryStatus(p, 2); // → pending
    expect(p.entries[2].status).toBe("pending");
  });
  it("非法 index 返回原 plan", () => {
    expect(cycleEntryStatus(plan, 9)).toBe(plan);
  });
});

describe("planStats", () => {
  it("统计正确", () => {
    const s = planStats(plan);
    expect(s.total).toBe(3);
    expect(s.completed).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.progressPct).toBe(33);
  });
  it("空 plan 进度 0", () => {
    const s = planStats({ entries: [] });
    expect(s.total).toBe(0);
    expect(s.progressPct).toBe(0);
  });
  it("全完成 100%", () => {
    const s = planStats({
      entries: [
        { content: "a", priority: "low", status: "completed" },
        { content: "b", priority: "low", status: "completed" },
      ],
    });
    expect(s.progressPct).toBe(100);
  });
});
