import { describe, expect, it } from "vitest";
import type { PlanItem, TodoDetails } from "@openbuddy/protocol/plan";
import { planProgress } from "@openbuddy/protocol/plan";
import { itemsToPlan, planItemsToText, planToText, todoCallSummary } from "../plan-utils";
import { toolLabel, toolSubject } from "../tool-summary";
import { turnSummaries } from "../turns";
import type { ChatMessage } from "../transcript";

const items: PlanItem[] = [
  { id: 1, text: "收集数据", status: "done", note: "24 行" },
  { id: 2, text: "清洗数据", status: "in_progress" },
  { id: 3, text: "写报告", status: "pending" },
];
const details = (action: TodoDetails["action"], changed: number[], extra: Partial<TodoDetails> = {}): TodoDetails => ({ action, items, nextId: 4, changed, ...extra });

describe("ob_todo plan items (pii W3)", () => {
  it("summarizes progress", () => {
    expect(planProgress(items)).toEqual({ done: 1, total: 3, current: items[1] });
    expect(planProgress([])).toEqual({ done: 0, total: 0, current: undefined });
  });

  it("turns the plan into composer text and into an editable draft", () => {
    expect(planItemsToText(items)).toBe("1. ✓ 收集数据（24 行）\n2. ▶ 清洗数据\n3. 写报告");
    const draft = itemsToPlan(items);
    expect(draft.entries.map((e) => e.status)).toEqual(["completed", "in_progress", "pending"]);
    expect(planToText({ entries: [{ ...draft.entries[0], priority: "high" }, draft.entries[2]] })).toBe("1. ✓ 收集数据（优先）\n2. 写报告");
  });

  it("describes each ob_todo call by the step it changed, with the progress after it", () => {
    expect(todoCallSummary({ action: "add", items: ["收集数据", "清洗数据", "写报告"] }, details("add", [1, 2, 3]))).toEqual({ subject: "新增 3 个步骤：收集数据、清洗数据、写报告", progress: "1/3" });
    expect(todoCallSummary({ action: "complete", id: 1 }, details("complete", [1])).subject).toBe("完成 #1 收集数据");
    expect(todoCallSummary({ action: "update", id: 2, status: "in_progress" }, details("update", [2])).subject).toBe("开始 #2 清洗数据");
    expect(todoCallSummary({ action: "remove", id: 4 }, details("remove", [], { removed: [{ id: 4, text: "复核", status: "pending" }] })).subject).toBe("删除 #4 复核");
    expect(todoCallSummary({ action: "list" }, details("list", [])).subject).toBe("查看计划");
    // Still running (no details yet): from the arguments, without progress.
    expect(todoCallSummary({ action: "add", text: "复核" })).toEqual({ subject: "新增 1 个步骤：复核" });
    expect(todoCallSummary({ action: "complete", id: 2 }).subject).toBe("完成 #2");
    expect(toolLabel("ob_todo")).toBe("更新计划");
    expect(toolSubject("ob_todo", { action: "add", items: ["a", "b"] })).toBe("新增 2 个步骤：a、b");
  });

  it("lists every turn with its status and duration (任务概览)", () => {
    const msg = (id: string, role: ChatMessage["role"], text: string, meta: ChatMessage["meta"] = {}): ChatMessage => ({ id, role, complete: true, parts: text ? [{ kind: "text", text }] : [], meta });
    const messages = [
      msg("u1", "user", "整理  报告", { timestamp: 1000 }),
      msg("a1", "assistant", "好", { timestamp: 1500, endedAt: 4000 }),
      msg("u2", "user", "", { timestamp: 5000, attachments: ["/w/data.csv"] }),
      msg("a2", "assistant", "", { timestamp: 5100, stopReason: "aborted" }),
      msg("u3", "user", "再来", { timestamp: 9000 }),
      msg("a3", "assistant", "…", { timestamp: 9100 }),
    ];
    expect(turnSummaries(messages, true)).toEqual([
      { id: "u1", index: 1, prompt: "整理 报告", status: "done", durationMs: 3000 },
      { id: "u2", index: 2, prompt: "附件：data.csv", status: "stopped", durationMs: 100 },
      { id: "u3", index: 3, prompt: "再来", status: "running" },
    ]);
    expect(turnSummaries(messages.slice(0, 2).concat(msg("x", "assistant", "", { stopReason: "error" })), false)[0].status).toBe("failed");
  });
});
