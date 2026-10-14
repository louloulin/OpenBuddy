/**
 * openbuddy-memory Pi extension —— 让**模型**也能读写本地记忆(阶段 1.5)。
 *
 * 两个工具:
 *   - memory_save  记住一条(默认 user 层;scope=workspace 时绑当前 cwd)
 *   - memory_recall 按关键词召回(用户层 + 当前工作区层一起召回)
 *
 * 走的是 `electron/main/memory/memory-store` —— 与「记忆」侧栏面板
 * 读写的是同一份 `<agentHome>/memory.json`,不是另一套。
 */
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { addMemory, recallMemories, type MemoryScope } from "../../memory/memory-store";

export interface OpenBuddyMemoryConfig {
  /** workspace 层记忆归属的工作区。 */
  cwd?: string;
}

function normalizeScope(value: unknown): MemoryScope {
  return value === "workspace" ? "workspace" : "user";
}

export default function openBuddyMemory(config: OpenBuddyMemoryConfig = {}): ExtensionFactory {
  const cwd = config.cwd ?? process.cwd();
  return (pi: ExtensionAPI) => {
    const api = pi as unknown as {
      registerTool?: (def: unknown) => void;
    };
    if (typeof api.registerTool !== "function") return;

    api.registerTool({
      name: "memory_save",
      label: "Save memory",
      description:
        "Persist one durable fact/preference/preference about this project or the user. " +
        "Use only when the user says to remember something, or when a preference is stated explicitly. " +
        "Scope: 'user' (across projects) or 'workspace' (this project only).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title, e.g. '回答偏好用中文'" },
          body: { type: "string", description: "The detail to remember" },
          scope: { type: "string", description: "'user' (default) or 'workspace'" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
        },
        required: ["title"],
      },
      execute: async (_toolCallId: string, params: unknown) => {
        const input = (params ?? {}) as { title?: unknown; body?: unknown; scope?: unknown; tags?: unknown };
        const title = String(input.title ?? "").trim();
        if (!title) return { content: [{ type: "text" as const, text: "memory_save 需要 title" }], details: { saved: false } };
        const scope = normalizeScope(input.scope);
        const tags = Array.isArray(input.tags) ? input.tags.map((tag) => String(tag)) : [];
        const entry = await addMemory({
          title,
          body: String(input.body ?? title),
          scope,
          ...(scope === "workspace" ? { cwd } : {}),
          tags,
        });
        return {
          content: [{ type: "text" as const, text: `已记住(${scope === "workspace" ? "工作区" : "全局"}):${entry.title}` }],
          details: { saved: true, id: entry.id, scope: entry.scope },
        };
      },
    });

    api.registerTool({
      name: "memory_recall",
      label: "Recall memories",
      description:
        "Search stored memories (user-level plus this workspace) by keyword. " +
        "Call it before asking the user something they have already told you.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keyword(s) to search in title/body/tags" },
          limit: { type: "number", description: "Max hits (default 10)" },
        },
        required: ["query"],
      },
      execute: async (_toolCallId: string, params: unknown) => {
        const input = (params ?? {}) as { query?: unknown; limit?: unknown };
        const query = String(input.query ?? "").trim();
        if (!query) return { content: [{ type: "text" as const, text: "memory_recall 需要 query" }], details: { hits: 0 } };
        const hits = await recallMemories({ query, cwd, limit: Number(input.limit ?? 10) });
        const text = hits.length === 0
          ? "没有匹配的记忆。"
          : hits.map((hit) => `- [${hit.scope === "workspace" ? "工作区" : "全局"}] ${hit.title}:${hit.body}`).join("\n");
        return { content: [{ type: "text" as const, text }], details: { hits: hits.length } };
      },
    });
  };
}
