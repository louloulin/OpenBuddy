/**
 * 团队状态派生纯函数 —— 从会话 transcript 解析 create_team 工具调用，
 * 提取已创建的团队与成员信息。
 *
 * OpenBuddy 通过内嵌 MCP server（src-data-openbuddy/src/team_mcp.rs）提供
 * openbuddy__create_team / team_status / team_delete 工具（旧会话历史里是
 * 无前缀的原生名，两者都识别），由 LLM 调用。这里从 tool_call 的
 * rawInput + content（工具结果）派生出「当前已创建的团队列表」供
 * TeamStatusView 展示。纯函数、无副作用。
 */
import type { ChatMessage } from "@/stores/session-store";

/** 一个已创建的团队。 */
export interface TeamInfo {
  /** toolCallId（去重 key）。 */
  id: string;
  /** 团队 ID（来自 create_team 的 rawInput.team_id）。 */
  teamId: string;
  /** 成员名称列表。 */
  members: string[];
  /** 创建时间（若能从结果解析）。 */
  createdAt?: number;
  /** 工具调用状态。 */
  status: "in_progress" | "completed" | "failed";
}

/** 从会话消息派生已创建的团队列表（去重，按首次出现顺序）。 */
export function deriveTeams(messages: ChatMessage[]): TeamInfo[] {
  const seen = new Set<string>();
  const out: TeamInfo[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.kind !== "tool_call") continue;
      const tc = p.toolCall;
      if (!isCreateTeamTool(tc)) continue;
      if (seen.has(tc.toolCallId)) continue;
      seen.add(tc.toolCallId);
      const info = parseTeamFromToolCall(tc);
      if (info) out.push(info);
    }
  }
  return out;
}

/** 判断一个 tool_call 是否为 create_team。 */
export function isCreateTeamTool(tc: {
  kind: string;
  title: string;
  toolCallId: string;
  rawInput?: unknown;
}): boolean {
  const k = (tc.kind || "").toLowerCase();
  // 原生名（旧会话）或 MCP 限定名 openbuddy__create_team（现行路径）。
  if (k === "create_team" || k === "team_create" || k === "openbuddy__create_team") return true;
  const title = (tc.title || "").toLowerCase();
  if (title.includes("create_team") || title.includes("创建团队")) return true;
  if (tc.rawInput && typeof tc.rawInput === "object") {
    const obj = tc.rawInput as Record<string, unknown>;
    if ("team_id" in obj && "members" in obj) return true;
  }
  return false;
}

/** 从 create_team 工具调用解析团队信息。 */
function parseTeamFromToolCall(tc: {
  toolCallId: string;
  rawInput?: unknown;
  status: "in_progress" | "completed" | "failed";
}): TeamInfo | null {
  const raw = tc.rawInput as Record<string, unknown> | undefined;
  if (!raw) return null;
  const teamId = typeof raw.team_id === "string" ? raw.team_id : "";
  const membersRaw = raw.members;
  let members: string[] = [];
  if (Array.isArray(membersRaw)) {
    members = membersRaw
      .map((mm) => {
        if (typeof mm === "string") return mm;
        if (mm && typeof mm === "object") {
          const obj = mm as Record<string, unknown>;
          return typeof obj.name === "string" ? obj.name : "";
        }
        return "";
      })
      .filter((s) => s.length > 0);
  }
  return {
    id: tc.toolCallId,
    teamId,
    members,
    status: tc.status,
  };
}

/** 统计：返回团队总数与成员总数。 */
export function teamStats(teams: TeamInfo[]): {
  teamCount: number;
  memberCount: number;
} {
  return {
    teamCount: teams.length,
    memberCount: teams.reduce((sum, t) => sum + t.members.length, 0),
  };
}
