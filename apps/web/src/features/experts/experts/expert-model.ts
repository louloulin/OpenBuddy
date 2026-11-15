import type { ExpertCategoryInfo, ExpertDraft, ExpertEntry } from "@openbuddy/protocol/experts";
import type { PendingExpert } from "../state/pending-expert-store";

/** Labels for an expert's source (卡片角标 / 详情). */
export const SCOPE_LABEL: Record<string, string> = { builtin: "内置", user: "我的", project: "项目", library: "专家库" };

/** Pi's built-in tools, in the order the editor lists them. */
export const TOOL_OPTIONS: Array<{ name: string; label: string; hint: string }> = [
  { name: "read", label: "读取文件", hint: "read" },
  { name: "ls", label: "列出目录", hint: "ls" },
  { name: "find", label: "查找文件", hint: "find" },
  { name: "grep", label: "搜索内容", hint: "grep" },
  { name: "write", label: "写入文件", hint: "write" },
  { name: "edit", label: "编辑文件", hint: "edit" },
  { name: "bash", label: "运行命令", hint: "bash" },
  { name: "mcp__*", label: "连接器工具", hint: "mcp__*" },
];

export const THINKING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "跟随任务设置" },
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/** Emoji presets for the avatar picker (the editor also accepts any typed emoji). */
export const AVATAR_PRESETS = ["🧑‍💼", "🗂️", "📝", "✍️", "📣", "📊", "💻", "🔍", "🔭", "🌐", "🧭", "🎓", "🎤", "🧪", "💡", "🛠️", "📚", "🎨", "⚖️", "🩺", "🚀", "🤝", "🌱", "🦉"];

export const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, "").replace(/^[a-z_]+:\s*/, "");

export function categoryLabel(categories: ExpertCategoryInfo[], id?: string) {
  const hit = categories.find((c) => c.id === id);
  return hit ? hit.label : id ? id : "";
}

/** One line for the card's subtitle: category · source. */
export function subtitle(expert: ExpertEntry, categories: ExpertCategoryInfo[]) {
  return [categoryLabel(categories, expert.category), SCOPE_LABEL[expert.scope]].filter(Boolean).join(" · ");
}

/** Short summary of what the expert changes in a task (model, thinking, tools). */
export function capabilityChips(expert: ExpertEntry): string[] {
  const chips: string[] = [];
  if (expert.model) chips.push(`模型 ${expert.model.replace(/^model:/, "")}`);
  if (expert.thinking) chips.push(`思考 ${THINKING_OPTIONS.find((o) => o.value === expert.thinking)?.label ?? expert.thinking}`);
  if (expert.tools) {
    const readOnly = expert.tools.every((t) => ["read", "ls", "find", "grep"].includes(t));
    chips.push(expert.tools.length === 0 ? "仅对话" : readOnly ? "只读工具" : `${expert.tools.length} 项工具`);
  } else chips.push("全部工具");
  if (expert.skills?.length) chips.push(`${expert.skills.length} 个技能`);
  if (expert.connectors?.length) chips.push(`${expert.connectors.length} 个连接器`);
  return chips;
}

/** Avatar value for the pending / bound badges: an image path or the emoji. */
export const avatarOf = (expert: Pick<ExpertEntry, "image" | "emoji">) => expert.image ?? expert.emoji;

/** "召唤": what the home composer needs (the persona itself is applied by the engine on binding). */
export function toPending(expert: ExpertEntry, example?: string): PendingExpert {
  return {
    name: expert.name,
    prompt: "",
    description: expert.description ?? expert.name,
    quickPrompt: example ?? expert.examples[0],
    expertId: expert.id,
    source: expert.scope,
    avatarLocal: avatarOf(expert),
  };
}

export function emptyDraft(): ExpertDraft {
  return { name: "", avatar: "🧑‍💼", description: "", category: "custom", examples: [], prompt: "" };
}

/** The editable fields of an expert; `copy` drops the id and marks the name (复制 / 从模板创建). */
export function draftOf(expert: ExpertEntry, copy = false): ExpertDraft {
  return {
    id: copy ? undefined : expert.id,
    name: copy ? `${expert.name}（副本）` : expert.name,
    avatar: expert.emoji ?? "🧑‍💼",
    description: expert.description ?? "",
    category: expert.category ?? "custom",
    model: expert.model,
    thinking: expert.thinking,
    tools: expert.tools ? [...expert.tools] : undefined,
    skills: expert.skills ? [...expert.skills] : undefined,
    connectors: expert.connectors ? [...expert.connectors] : undefined,
    examples: [...expert.examples],
    tags: [...expert.tags],
    prompt: expert.prompt,
  };
}

export function matches(expert: ExpertEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [expert.name, expert.description ?? "", expert.id, ...expert.tags, ...expert.examples].some((s) => s.toLowerCase().includes(q));
}
