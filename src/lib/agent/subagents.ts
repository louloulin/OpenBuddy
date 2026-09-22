/**
 * Subagent / Team runtime 派生纯函数 —— 对齐 WorkBuddy
 * `session:getSubagentList` / `getTeamRuntime` / `team-runtime`。
 *
 * OpenBuddy 的 pi 内核通过 `spawn_subagent` 工具调用派生子 agent。这里从会话消息的
 * tool_call 中派生出「子 agent 活动列表」,并支持把 RunningTask(后台任务)合并展示。
 * 纯函数、无副作用,便于单测。
 */
import type { ChatMessage, ToolCallView } from "@/stores/session-store";
import type { RunningTask } from "@openbuddy/shared-types";

/** 子 agent 活动条目。 */
export interface SubagentActivity {
  /** toolCallId(去重 key)。 */
  id: string;
  /** 子 agent 名称/描述(从 title 解析)。 */
  name: string;
  /** 状态(继承 tool_call status)。 */
  status: "in_progress" | "completed" | "failed";
  /** 是否为 spawn_subagent 工具(否则是其它后台任务)。 */
  isSpawn: boolean;
}

/** 从 tool_call 的 title 解析子 agent 名称。
 *  pi 的 `task` 工具标题格式多样，常见有：
 *  - 「Task: <description>」/「task」
 *  - 「Spawn subagent: <name>」（较旧版本）
 *  - 「使用 <name> 执行…」（中文）
 *  - 任意描述文本（pi 会把 subagent_type 放在 raw_input 里而非 title）。
 *  若 title 不含明确的子代理名，回退到 raw_input 的 subagent_type，再回退到截断的 title。*/
export function parseSubagentName(title: string, rawInput?: unknown): string {
  const t = (title || "").trim();
  // 「Spawn subagent: <name>」
  let m = t.match(/spawn\s+subagent\s*[:：]\s*(.+)/i);
  if (m?.[1]) return m[1].trim();
  // 「Task: <desc>」—— 优先用 raw_input 里的 subagent_type（更准确）
  m = t.match(/^task\s*[:：]\s*(.+)/i);
  if (m?.[1]) return parseSubagentType(rawInput) ?? m[1].trim();
  // 中文「使用 <name> 执行…」
  m = t.match(/^(?:使用|用)\s*(.+?)\s*(?:执行|完成|处理)/);
  if (m?.[1]) return m[1].trim();
  // 尝试从 raw_input 提取 subagent_type
  const fromInput = parseSubagentType(rawInput);
  if (fromInput) return fromInput;
  return t.length > 40 ? t.slice(0, 40) + "…" : t || "(subagent)";
}

/** 从 task 工具的 raw_input 提取 subagent_type 字段（pi 把派生目标放在这里）。 */
function parseSubagentType(rawInput?: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const obj = rawInput as Record<string, unknown>;
  const t = obj.subagent_type ?? obj.subagentType ?? obj.type;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

/** 从会话消息派生子 agent 活动列表(去重,保持首次出现顺序)。 */
export function deriveSubagents(messages: ChatMessage[]): SubagentActivity[] {
  const seen = new Set<string>();
  const out: SubagentActivity[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.kind !== "tool_call") continue;
      const tc = p.toolCall;
      const isSpawn = isSubagentTool(tc);
      if (!isSpawn) continue;
      if (seen.has(tc.toolCallId)) continue;
      seen.add(tc.toolCallId);
      out.push({
        id: tc.toolCallId,
        name: parseSubagentName(tc.title, tc.rawInput),
        status: tc.status,
        isSpawn,
      });
    }
  }
  return out;
}

/** 判断一个 tool_call 是否为子代理派发。
 *
 *  pi 原生子代理派发工具是 `task`（见 vendor/pi-build/.../task/mod.rs:58,141），
 *  其 `kind = "task"`、`id = "task"`。较旧版本用过 `spawn_subagent` 这个 kind。
 *  这里综合 kind / toolCallId / title 三处线索判断，避免遗漏任一字段缺失的情况。 */
export function isSubagentTool(tc: ToolCallView): boolean {
  const k = (tc.kind || "").toLowerCase();
  if (k === "task" || k === "spawn_subagent") return true;
  if (k.includes("subagent") || k.includes("spawn")) return true;
  // 兜底：kind 缺省（"other"）时，按 title 识别 task 工具调用。
  const title = (tc.title || "").toLowerCase();
  // pi 的 task 工具 toolCallId 形如 "toolu_xxx"（不含 "task"），所以主要靠
  // title 前缀「task:」或「spawn subagent」识别。
  if (title.startsWith("task:") || title.startsWith("task：")) return true;
  if (title.includes("spawn subagent")) return true;
  // raw_input 里带 subagent_type 字段的也算（pi 把派生目标放在 raw_input）。
  if (tc.rawInput && typeof tc.rawInput === "object") {
    const obj = tc.rawInput as Record<string, unknown>;
    if ("subagent_type" in obj || "subagentType" in obj) return true;
  }
  return false;
}

/** 把 RunningTask 列表归一化为 SubagentActivity(统一展示)。 */
export function tasksToActivities(tasks: RunningTask[]): SubagentActivity[] {
  return tasks.map((t) => ({
    id: t.id,
    name: t.description || t.kind || t.id,
    status: taskStatusToToolStatus(t.status),
    isSpawn: false,
  }));
}

/** RunningTask.status(字符串)→ tool_call status。 */
export function taskStatusToToolStatus(
  status?: string,
): "in_progress" | "completed" | "failed" {
  const s = (status || "").toLowerCase();
  if (s.includes("fail") || s.includes("error")) return "failed";
  if (s.includes("done") || s.includes("complete") || s.includes("success")) return "completed";
  return "in_progress";
}

/** 合并去重:subagent 活动 + RunningTask(按 id 去重,subagent 优先)。 */
export function mergeActivities(
  subagents: SubagentActivity[],
  tasks: SubagentActivity[],
): SubagentActivity[] {
  const seen = new Set<string>();
  const out: SubagentActivity[] = [];
  for (const a of [...subagents, ...tasks]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** MVP-3 — subagent status → UI 字符标记(纯函数)。
 *  Reused by SubagentIndicator and tests. Keeps glyph choice in one place
 *  so themes/locales can swap without touching components. */
export function subagentStatusGlyph(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "running") return "▶";
  if (s === "completed" || s === "done" || s === "success") return "✓";
  if (s === "failed" || s === "error") return "✗";
  if (s === "cancelled" || s === "canceled") return "○";
  return "•";
}

/** MVP-3 — subagent status → CSS class suffix (e.g. "running" / "completed"). */
export function subagentStatusClass(status: string | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s === "running") return "running";
  if (s === "completed" || s === "done" || s === "success") return "completed";
  if (s === "failed" || s === "error") return "failed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  return "unknown";
}

/** MVP-3 — duration in ms → compact display string ("1m23s" / "12s" / "—"). */
export function formatSubagentDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

/** MVP-3 — short id suffix for subagent rows (last 6 chars). */
export function shortSubagentId(id: string): string {
  return id.length > 6 ? id.slice(-6) : id;
}

/** 统计:返回 { total, running, completed, failed }。 */
export function activityStats(list: SubagentActivity[]): {
  total: number;
  running: number;
  completed: number;
  failed: number;
} {
  return {
    total: list.length,
    running: list.filter((a) => a.status === "in_progress").length,
    completed: list.filter((a) => a.status === "completed").length,
    failed: list.filter((a) => a.status === "failed").length,
  };
}
