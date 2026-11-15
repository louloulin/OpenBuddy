import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { EXPERT_LIMITS, isExpertId, type ExpertDraft } from "@openbuddy/protocol/experts";
import { ProtocolError } from "@openbuddy/protocol/errors";
import type { ThinkingLevel } from "@openbuddy/protocol/types";

/**
 * One expert file: `agents/<id>.md` with YAML front matter and the persona prompt as the body
 * (20261116-pii W2.1). Port of the historical `agents_store.rs` parse / template logic, with a real
 * YAML parser (Pi's `parseFrontmatter`) instead of the line splitter, and strict validation.
 */
const THINKING: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const TOOL_NAME = /^[A-Za-z0-9_.*-]+$/;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

const invalid = (reason: string): never => {
  throw new ProtocolError("expert_invalid", reason);
};

/** Lowercase file-name id from a display name (legacy `sanitize_name`); "" when nothing is left (e.g. Chinese). */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function str(value: unknown, max: number, key: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" || typeof value === "boolean") value = String(value);
  if (typeof value !== "string") return invalid(`${key} 必须是文本`);
  const text = value.trim();
  if (text.length > max) invalid(`${key} 超过 ${max} 个字符`);
  if (text.includes("\0")) invalid(`${key} 含有非法字符`);
  return text || undefined;
}

function list(value: unknown, maxItems: number, maxItem: number, key: string, pattern?: RegExp): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  // `tools: read, grep` (comma form, like the legacy `model_tags`) is accepted too.
  const items = typeof value === "string" ? value.split(",") : value;
  if (!Array.isArray(items)) return invalid(`${key} 必须是列表`);
  const out: string[] = [];
  for (const item of items) {
    const text = str(item, maxItem, key);
    if (!text) continue;
    if (pattern && !pattern.test(text)) invalid(`${key} 含有无效的名称：${text}`);
    if (!out.includes(text)) out.push(text);
  }
  if (out.length > maxItems) invalid(`${key} 最多 ${maxItems} 项`);
  return out;
}

/** Validate and normalize what the editor (or a file) provides. Throws `expert_invalid`. */
export function normalizeDraft(raw: object): ExpertDraft {
  const input = raw as Record<string, unknown>;
  const L = EXPERT_LIMITS;
  const name = str(input.name, L.name, "名称");
  if (!name) invalid("名称不能为空");
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length > L.prompt) invalid(`人设超过 ${L.prompt} 个字符`);
  const category = str(input.category, L.category, "类别");
  if (category && !/^[a-z0-9-]+$/.test(category)) invalid("类别只能包含小写字母、数字和 -");
  const thinking = str(input.thinking, 16, "思考档位");
  if (thinking && !THINKING.includes(thinking as ThinkingLevel)) invalid(`未知的思考档位：${thinking}`);
  const id = input.id === undefined || input.id === null || input.id === "" ? undefined : String(input.id);
  if (id !== undefined && !isExpertId(id)) invalid("id 只能包含小写字母、数字、- 和 _");
  const draft: ExpertDraft = {
    id,
    name: name!,
    avatar: str(input.avatar, L.avatar, "头像"),
    description: str(input.description, L.description, "简介"),
    category,
    model: str(input.model, L.model, "模型"),
    thinking: thinking as ThinkingLevel | undefined,
    tools: list(input.tools, L.list, L.item, "工具", TOOL_NAME),
    skills: list(input.skills, L.list, L.item, "技能"),
    connectors: list(input.connectors, L.list, L.item, "连接器"),
    examples: list(input.examples, L.examples, L.example, "示例任务"),
    tags: list(input.tags, L.tags, L.tag, "标签"),
    prompt,
  };
  for (const key of Object.keys(draft) as Array<keyof ExpertDraft>) if (draft[key] === undefined) delete draft[key];
  return draft;
}

export interface ParsedExpertFile {
  draft: ExpertDraft;
  /** Legacy numeric avatar (1-20 preset) from older OpenBuddy files. */
  legacyAvatar?: number;
  /** Legacy `model_tags`. */
  modelTags?: string[];
}

/** Parse a Markdown expert. Bad YAML or invalid fields throw `expert_invalid` (the scan reports them). */
export function parseExpertMarkdown(raw: string, fallbackName: string): ParsedExpertFile {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(raw);
  } catch (error) {
    return invalid(`YAML 头无法解析：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
  const fm = parsed.frontmatter && typeof parsed.frontmatter === "object" && !Array.isArray(parsed.frontmatter) ? parsed.frontmatter : {};
  const legacyAvatar = typeof fm.avatar === "number" && Number.isInteger(fm.avatar) ? fm.avatar : undefined;
  const draft = normalizeDraft({
    ...fm,
    id: undefined,
    name: fm.name ?? fallbackName,
    avatar: legacyAvatar === undefined ? fm.avatar : undefined,
    prompt: parsed.body,
  });
  const modelTags = list(fm.model_tags, 8, 24, "model_tags");
  return { draft, legacyAvatar, modelTags };
}

const quote = (value: string) => JSON.stringify(value);

/** Render a draft as Markdown (the `agents_template` command and every save). JSON strings are valid YAML. */
export function serializeExpert(draft: ExpertDraft, extra: { legacyAvatar?: number; modelTags?: string[] } = {}): string {
  const lines = ["---", `name: ${quote(draft.name)}`];
  if (draft.avatar) lines.push(`avatar: ${quote(draft.avatar)}`);
  else if (extra.legacyAvatar !== undefined) lines.push(`avatar: ${extra.legacyAvatar}`);
  if (draft.description) lines.push(`description: ${quote(draft.description)}`);
  if (draft.category) lines.push(`category: ${draft.category}`);
  if (draft.model) lines.push(`model: ${quote(draft.model)}`);
  if (draft.thinking) lines.push(`thinking: ${draft.thinking}`);
  for (const key of ["tools", "skills", "connectors", "tags"] as const) {
    const items = draft[key];
    if (items) lines.push(`${key}: [${items.map(quote).join(", ")}]`);
  }
  if (extra.modelTags?.length) lines.push(`model_tags: [${extra.modelTags.map(quote).join(", ")}]`);
  if (draft.examples?.length) {
    lines.push("examples:");
    for (const example of draft.examples) lines.push(`  - ${quote(example)}`);
  }
  lines.push("---", "", draft.prompt.trim(), "");
  return lines.join("\n");
}

/** An avatar value is an image when it is a relative path to a picture inside the expert's folder. */
export function avatarImage(avatar: string | undefined): string | undefined {
  if (!avatar || !IMAGE_EXT.test(avatar)) return undefined;
  const parts = avatar.split(/[\\/]+/);
  if (avatar.startsWith("/") || /^[A-Za-z]:/.test(avatar) || parts.includes("..")) return undefined;
  return parts.join("/");
}
