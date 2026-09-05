import { describe, it, expect } from "vitest";
import {
  parseSubagentName,
  deriveSubagents,
  isSubagentTool,
  tasksToActivities,
  taskStatusToToolStatus,
  mergeActivities,
  activityStats,
} from "../agent/subagents";
import type { ChatMessage } from "@/stores/session-store";
import type { RunningTask } from "@openbuddy/shared-types";

function tcMsg(
  toolCallId: string,
  title: string,
  kind: string,
  status: "in_progress" | "completed" | "failed",
  rawInput?: unknown,
): ChatMessage {
  return {
    id: toolCallId,
    role: "assistant",
    complete: true,
    parts: [
      {
        kind: "tool_call",
        toolCall: { toolCallId, title, kind, status, content: [], rawInput },
      },
    ],
  };
}

describe("parseSubagentName", () => {
  it("Spawn subagent: <name> 格式", () => {
    expect(parseSubagentName("Spawn subagent: reviewer")).toBe("reviewer");
  });
  it("使用 <name> 执行 格式", () => {
    expect(parseSubagentName("使用 审查员 执行代码审查")).toBe("审查员");
  });
  it("其它标题截断 40 字", () => {
    const long = "x".repeat(50);
    const r = parseSubagentName(long);
    expect(r.length).toBe(41); // 40 + …
    expect(r.endsWith("…")).toBe(true);
  });
  it("空标题回退", () => {
    expect(parseSubagentName("")).toBe("(subagent)");
  });
  it("task 工具标题 + raw_input.subagent_type 提取类型", () => {
    // pi 的 task 工具把派生目标放在 raw_input.subagent_type
    expect(
      parseSubagentName("Task: review the code", {
        subagent_type: "general-purpose",
        prompt: "...",
      }),
    ).toBe("general-purpose");
  });
  it("task 工具标题无 raw_input 时回退到 Task: 后的描述", () => {
    expect(parseSubagentName("Task: review the code")).toBe("review the code");
  });
  it("从 raw_input.subagentType (camelCase) 提取", () => {
    expect(parseSubagentName("running", { subagentType: "explore" })).toBe("explore");
  });
});

describe("isSubagentTool", () => {
  it("spawn_subagent / subagent / spawn 命中", () => {
    expect(isSubagentTool({ kind: "spawn_subagent", status: "completed", title: "", toolCallId: "", content: [] })).toBe(true);
    expect(isSubagentTool({ kind: "Subagent", status: "completed", title: "", toolCallId: "", content: [] })).toBe(true);
    expect(isSubagentTool({ kind: "spawn", status: "completed", title: "", toolCallId: "", content: [] })).toBe(true);
  });
  it("pi 原生 task 工具 (kind=task) 命中", () => {
    expect(isSubagentTool({ kind: "task", status: "completed", title: "Task: do x", toolCallId: "toolu_1", content: [] })).toBe(true);
  });
  it("kind 缺省但 title 以 Task: 开头也命中（kind 序列化为 other）", () => {
    expect(isSubagentTool({ kind: "other", status: "completed", title: "Task: explore repo", toolCallId: "x", content: [] })).toBe(true);
  });
  it("raw_input 带 subagent_type 字段命中", () => {
    expect(isSubagentTool({ kind: "other", status: "completed", title: "running", toolCallId: "x", content: [], rawInput: { subagent_type: "plan" } })).toBe(true);
  });
  it("其它 kind / 普通 title 不命中", () => {
    expect(isSubagentTool({ kind: "edit", status: "completed", title: "Edit x", toolCallId: "", content: [] })).toBe(false);
    expect(isSubagentTool({ kind: "read_file", status: "completed", title: "Read y", toolCallId: "", content: [] })).toBe(false);
  });
});

describe("deriveSubagents", () => {
  it("从 spawn_subagent tool_call 派生", () => {
    const list = deriveSubagents([
      tcMsg("t1", "Spawn subagent: coder", "spawn_subagent", "completed"),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("coder");
    expect(list[0].isSpawn).toBe(true);
    expect(list[0].status).toBe("completed");
  });
  it("从 pi task 工具调用派生（kind=task + subagent_type）", () => {
    const list = deriveSubagents([
      tcMsg("t1", "Task: review code", "task", "in_progress", {
        subagent_type: "general-purpose",
      }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("general-purpose");
    expect(list[0].isSpawn).toBe(true);
  });
  it("忽略非 subagent 的 tool_call", () => {
    expect(deriveSubagents([tcMsg("t1", "Edit x", "edit", "completed")])).toEqual([]);
  });
  it("同 toolCallId 去重", () => {
    const list = deriveSubagents([
      tcMsg("t1", "Spawn subagent: a", "spawn_subagent", "completed"),
      tcMsg("t1", "Spawn subagent: a", "spawn_subagent", "completed"),
    ]);
    expect(list).toHaveLength(1);
  });
  it("保持首次出现顺序", () => {
    const list = deriveSubagents([
      tcMsg("t1", "Spawn subagent: a", "spawn_subagent", "completed"),
      tcMsg("t2", "Spawn subagent: b", "spawn_subagent", "in_progress"),
    ]);
    expect(list.map((x) => x.name)).toEqual(["a", "b"]);
  });
  it("空消息返回空", () => {
    expect(deriveSubagents([])).toEqual([]);
  });
});

describe("tasksToActivities / taskStatusToToolStatus", () => {
  it("RunningTask → SubagentActivity", () => {
    const tasks: RunningTask[] = [
      { id: "tk1", description: "后台搜索", status: "running" },
      { id: "tk2", description: "已完成", status: "done" },
      { id: "tk3", description: "失败", status: "failed" },
    ];
    const acts = tasksToActivities(tasks);
    expect(acts[0].status).toBe("in_progress");
    expect(acts[1].status).toBe("completed");
    expect(acts[2].status).toBe("failed");
    expect(acts.every((a) => a.isSpawn === false)).toBe(true);
  });
  it("taskStatusToToolStatus 各分支", () => {
    expect(taskStatusToToolStatus("failed")).toBe("failed");
    expect(taskStatusToToolStatus("error")).toBe("failed");
    expect(taskStatusToToolStatus("done")).toBe("completed");
    expect(taskStatusToToolStatus("completed")).toBe("completed");
    expect(taskStatusToToolStatus("success")).toBe("completed");
    expect(taskStatusToToolStatus("running")).toBe("in_progress");
    expect(taskStatusToToolStatus(undefined)).toBe("in_progress");
  });
});

describe("mergeActivities", () => {
  it("按 id 去重(subagent 优先)", () => {
    const subs = [{ id: "x", name: "a", status: "completed" as const, isSpawn: true }];
    const tasks = [
      { id: "x", name: "dup", status: "in_progress" as const, isSpawn: false },
      { id: "y", name: "b", status: "completed" as const, isSpawn: false },
    ];
    const merged = mergeActivities(subs, tasks);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("x");
    expect(merged[0].name).toBe("a"); // subagent 优先
  });
});

describe("activityStats", () => {
  it("统计正确", () => {
    const s = activityStats([
      { id: "1", name: "a", status: "completed", isSpawn: true },
      { id: "2", name: "b", status: "in_progress", isSpawn: true },
      { id: "3", name: "c", status: "failed", isSpawn: false },
    ]);
    expect(s).toEqual({ total: 3, running: 1, completed: 1, failed: 1 });
  });
  it("空列表", () => {
    expect(activityStats([])).toEqual({ total: 0, running: 0, completed: 0, failed: 0 });
  });
});
