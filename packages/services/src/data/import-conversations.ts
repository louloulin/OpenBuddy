import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * 外部会话导入 (G4-3)：把 WorkBuddy / ChatGPT / Claude 导出的会话转成 Markdown 写进工作区。
 *
 * 这是**迁移资料**，不是伪造的对话历史：每个外部会话变成一个 `.md` 文件（标题、时间、
 * 逐条消息），放进用户选定的目录，之后可以用 `files_search` 搜索、可以让 Buddy 基于它继续。
 * 全程只读源文件；目标同名文件存在时**不覆盖**，而是追加序号（幂等且不破坏已有内容）。
 */

export type ImportFormat = "chatgpt" | "claude" | "workbuddy" | "unknown";

export interface ImportedConversation {
  id: string;
  title: string;
  messageCount: number;
  updatedAt?: string;
}

export interface ImportScan {
  format: ImportFormat;
  conversations: ImportedConversation[];
}

const MAX_BYTES = 64 * 1024 * 1024;

interface RawMessage {
  role: string;
  text: string;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const record = content as Record<string, unknown>;
    if (Array.isArray(record.parts)) return textOf(record.parts);
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") return p.text;
          if (typeof p.content === "string") return p.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** ChatGPT: `[{ title, create_time, mapping: { id: { message: { author: {role}, content } } } }]` */
function parseChatGpt(text: string): { format: ImportFormat; list: Array<ImportedConversation & { messages: RawMessage[] }> } | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== "object" || !("mapping" in first)) return null;
  const list = (data as Array<Record<string, unknown>>).map((conversation, index) => {
    const mapping = (conversation.mapping ?? {}) as Record<string, { message?: Record<string, unknown> | null }>;
    const messages: RawMessage[] = [];
    for (const node of Object.values(mapping)) {
      const message = node?.message;
      if (!message) continue;
      const author = (message.author ?? {}) as Record<string, unknown>;
      const role = typeof author.role === "string" ? author.role : "user";
      const body = textOf(message.content);
      if (body.trim()) messages.push({ role: role === "assistant" ? "assistant" : role === "system" ? "system" : "user", text: body });
    }
    return {
      id: typeof conversation.id === "string" ? conversation.id : `chatgpt-${index}`,
      title: typeof conversation.title === "string" && conversation.title.trim() ? conversation.title : `ChatGPT 会话 ${index + 1}`,
      messageCount: messages.length,
      updatedAt: typeof conversation.update_time === "number" ? new Date(conversation.update_time * 1000).toISOString() : undefined,
      messages,
    };
  });
  return { format: "chatgpt", list: list.filter((item) => item.messageCount > 0) };
}

/** Claude: `[{ uuid, name, updated_at, chat_messages: [{ sender: "human"|"assistant", text }] }]` */
function parseClaude(text: string): { format: ImportFormat; list: Array<ImportedConversation & { messages: RawMessage[] }> } | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0] as Record<string, unknown>;
  if (!first || typeof first !== "object" || !("chat_messages" in first)) return null;
  const list = (data as Array<Record<string, unknown>>).map((conversation, index) => {
    const messages: RawMessage[] = ((conversation.chat_messages ?? []) as Array<Record<string, unknown>>).map((message) => ({
      role: message.sender === "assistant" ? "assistant" : "user",
      text: textOf(message.text ?? message.content),
    })).filter((message) => message.text.trim());
    return {
      id: typeof conversation.uuid === "string" ? conversation.uuid : `claude-${index}`,
      title: typeof conversation.name === "string" && conversation.name.trim() ? conversation.name : `Claude 会话 ${index + 1}`,
      messageCount: messages.length,
      updatedAt: typeof conversation.updated_at === "string" ? conversation.updated_at : undefined,
      messages,
    };
  });
  return { format: "claude", list: list.filter((item) => item.messageCount > 0) };
}

/** WorkBuddy / 通用：`[{ id, title, messages: [{ role, content }] }]` 或 `{ conversations: [...] }` */
function parseGeneric(text: string): { format: ImportFormat; list: Array<ImportedConversation & { messages: RawMessage[] }> } | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  const root = Array.isArray(data) ? data : (data as Record<string, unknown>)?.conversations;
  if (!Array.isArray(root) || root.length === 0) return null;
  const list = (root as Array<Record<string, unknown>>).map((conversation, index) => {
    const rawMessages = (conversation.messages ?? conversation.turns ?? []) as Array<Record<string, unknown>>;
    if (!Array.isArray(rawMessages)) return null;
    const messages: RawMessage[] = rawMessages.map((message) => ({
      role: message.role === "assistant" || message.role === "ai" ? "assistant" : "user",
      text: textOf(message.content ?? message.text),
    })).filter((message) => message.text.trim());
    return {
      id: typeof conversation.id === "string" ? conversation.id : `conv-${index}`,
      title: (typeof conversation.title === "string" && conversation.title.trim()) || `会话 ${index + 1}`,
      messageCount: messages.length,
      updatedAt: typeof conversation.updatedAt === "string" ? conversation.updatedAt : undefined,
      messages,
    };
  }).filter((item): item is NonNullable<typeof item> => !!item && item.messageCount > 0);
  return list.length ? { format: "workbuddy", list } : null;
}

export async function scanConversations(path: string): Promise<ImportScan> {
  const info = await stat(path);
  if (!info.isFile()) throw Error("import_not_a_file: 请选择会话导出文件");
  if (info.size > MAX_BYTES) throw Error("import_too_large: 会话文件超过 64MB");
  const text = await readFile(path, "utf8");
  const parsed = parseChatGpt(text) ?? parseClaude(text) ?? parseGeneric(text);
  if (!parsed) throw Error("import_unknown_format: 无法识别这个文件（支持 ChatGPT / Claude / WorkBuddy 的会话导出 JSON）");
  return {
    format: parsed.format,
    conversations: parsed.list.map(({ id, title, messageCount, updatedAt }) => ({ id, title, messageCount, updatedAt })),
  };
}

const safeName = (title: string) =>
  title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "conversation";

function toMarkdown(conversation: ImportedConversation & { messages: RawMessage[] }, format: ImportFormat): string {
  const source = format === "chatgpt" ? "ChatGPT" : format === "claude" ? "Claude" : "WorkBuddy";
  const lines = [
    `# ${conversation.title}`,
    "",
    `> 从 ${source} 导入${conversation.updatedAt ? ` · 原始时间 ${conversation.updatedAt}` : ""} · 共 ${conversation.messageCount} 条消息`,
    "",
  ];
  for (const message of conversation.messages) {
    lines.push(`## ${message.role === "assistant" ? "助手" : message.role === "system" ? "系统" : "用户"}`, "", message.text.trim(), "");
  }
  return lines.join("\n");
}

export interface ImportApplyResult {
  written: string[];
  skipped: string[];
}

/** 写入目标目录；同名文件存在时按内容哈希判断是否已导入过。 */
export async function applyConversations(path: string, ids: string[], outputDir: string): Promise<ImportApplyResult> {
  const info = await stat(path);
  if (!info.isFile()) throw Error("import_not_a_file: 请选择会话导出文件");
  if (info.size > MAX_BYTES) throw Error("import_too_large: 会话文件超过 64MB");
  const text = await readFile(path, "utf8");
  const parsed = parseChatGpt(text) ?? parseClaude(text) ?? parseGeneric(text);
  if (!parsed) throw Error("import_unknown_format: 无法识别这个文件");
  const wanted = ids.length ? parsed.list.filter((item) => ids.includes(item.id)) : parsed.list;
  if (!wanted.length) throw Error("import_nothing_selected: 请选择要导入的会话");
  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];
  const skipped: string[] = [];
  for (const conversation of wanted) {
    const markdown = toMarkdown(conversation, parsed.format);
    const digest = createHash("sha256").update(markdown).digest("hex").slice(0, 8);
    const base = `${safeName(conversation.title)}-${digest}`;
    let target = join(outputDir, `${base}.md`);
    // 幂等：同样的内容已导入过就跳过（同名同哈希）；不同内容用序号避免覆盖。
    for (let attempt = 1; attempt < 50; attempt++) {
      try {
        const existing = await readFile(target, "utf8");
        if (existing === markdown) { skipped.push(target); target = ""; break; }
        target = join(outputDir, `${base}-${attempt}.md`);
      } catch {
        break;
      }
    }
    if (!target) continue;
    await writeFile(target, markdown, { flag: "wx" }).catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // 并发或竞态：换个带时间戳的名字，绝不覆盖。
        const fallback = join(outputDir, `${base}-${Date.now()}.md`);
        await writeFile(fallback, markdown);
        written.push(fallback);
        return;
      }
      throw error;
    });
    if (target) written.push(target);
  }
  return { written, skipped };
}
