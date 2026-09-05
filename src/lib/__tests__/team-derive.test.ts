import { describe, it, expect } from "vitest";
import { deriveTeams, isCreateTeamTool, teamStats } from "../agent/team-derive";
import type { ChatMessage } from "@/stores/session-store";

function teamMsg(
  toolCallId: string,
  teamId: string,
  members: Array<{ name: string; role: string }>,
  status: "in_progress" | "completed" | "failed",
): ChatMessage {
  return {
    id: toolCallId,
    role: "assistant",
    complete: true,
    parts: [
      {
        kind: "tool_call",
        toolCall: {
          toolCallId,
          title: "create_team",
          kind: "create_team",
          status,
          content: [],
          rawInput: { team_id: teamId, members },
        },
      },
    ],
  };
}

describe("isCreateTeamTool", () => {
  it("kind=create_team 命中", () => {
    expect(
      isCreateTeamTool({ kind: "create_team", title: "", toolCallId: "x" }),
    ).toBe(true);
  });
  it("rawInput 带 team_id + members 命中", () => {
    expect(
      isCreateTeamTool({
        kind: "other",
        title: "",
        toolCallId: "x",
        rawInput: { team_id: "t", members: [] },
      }),
    ).toBe(true);
  });
  it("普通工具不命中", () => {
    expect(
      isCreateTeamTool({ kind: "edit", title: "Edit", toolCallId: "x" }),
    ).toBe(false);
  });
});

describe("deriveTeams", () => {
  it("从 create_team tool_call 派生团队与成员", () => {
    const list = deriveTeams([
      teamMsg("t1", "sw-team", [
        { name: "architect", role: "架构" },
        { name: "coder", role: "编码" },
      ], "completed"),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].teamId).toBe("sw-team");
    expect(list[0].members).toEqual(["architect", "coder"]);
    expect(list[0].status).toBe("completed");
  });
  it("忽略非 create_team 工具调用", () => {
    const other: ChatMessage = {
      id: "o1",
      role: "assistant",
      complete: true,
      parts: [
        {
          kind: "tool_call",
          toolCall: {
            toolCallId: "o1",
            title: "Edit x",
            kind: "edit",
            status: "completed",
            content: [],
          },
        },
      ],
    };
    expect(deriveTeams([other])).toEqual([]);
  });
  it("同 toolCallId 去重", () => {
    const msg = teamMsg("t1", "a", [{ name: "m1", role: "r" }], "completed");
    expect(deriveTeams([msg, msg])).toHaveLength(1);
  });
  it("多团队保持顺序", () => {
    expect(
      deriveTeams([
        teamMsg("t1", "team-a", [{ name: "x", role: "r" }], "completed"),
        teamMsg("t2", "team-b", [{ name: "y", role: "r" }], "in_progress"),
      ]).map((t) => t.teamId),
    ).toEqual(["team-a", "team-b"]);
  });
  it("空消息返回空", () => {
    expect(deriveTeams([])).toEqual([]);
  });
  it("成员名是字符串也能解析", () => {
    const msg: ChatMessage = {
      id: "t1",
      role: "assistant",
      complete: true,
      parts: [
        {
          kind: "tool_call",
          toolCall: {
            toolCallId: "t1",
            title: "create_team",
            kind: "create_team",
            status: "completed",
            content: [],
            rawInput: { team_id: "t", members: ["alice", "bob"] },
          },
        },
      ],
    };
    expect(deriveTeams([msg])[0].members).toEqual(["alice", "bob"]);
  });
});

describe("teamStats", () => {
  it("统计团队数与成员数", () => {
    const s = teamStats([
      { id: "1", teamId: "a", members: ["x", "y"], status: "completed" },
      { id: "2", teamId: "b", members: ["z"], status: "in_progress" },
    ]);
    expect(s).toEqual({ teamCount: 2, memberCount: 3 });
  });
  it("空列表", () => {
    expect(teamStats([])).toEqual({ teamCount: 0, memberCount: 0 });
  });
});
