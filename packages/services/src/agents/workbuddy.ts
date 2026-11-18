import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { basename, extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { EXPERT_LIMITS, type ExpertDraft } from "@openbuddy/protocol/experts";
import { ProtocolError } from "@openbuddy/protocol/errors";
import { slugify } from "./expert-file.js";

/**
 * WorkBuddy 专家包兼容 (S18). WorkBuddy exports a ZIP shaped like:
 *
 *   <plugin>/.codebuddy-plugin/plugin.json     package metadata (display name, members, tags…)
 *   <plugin>/settings.json                     { "agent": "<lead agent id>" }
 *   <plugin>/agents/*.md                       one agent per file: YAML front matter + persona body
 *   <plugin>/avatars/*.png                     relative to the package root
 *
 * The agent Markdown is already close to OpenBuddy's format (`name`, `description`, body prompt),
 * so the import only maps display names, category, tags, examples and avatars. ZIP reading is
 * dependency-free (central directory + `zlib.inflateRawSync`); paths are never written from the
 * archive, so `..` entries are ignored.
 */

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_AGENTS = 64;
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const SKIP = /^(__MACOSX\/|\.DS_Store$)/;

export interface WorkBuddyDraft {
  draft: ExpertDraft;
  /** Avatar bytes copied next to the expert when it is written. */
  avatar?: { name: string; bytes: Uint8Array };
}

export interface WorkBuddyPackage {
  name: string;
  root: string;
  drafts: WorkBuddyDraft[];
}

interface Localized { en?: unknown; zh?: unknown }
interface WorkBuddyPlugin {
  name?: unknown;
  agents?: unknown;
  expertType?: unknown;
  agentName?: unknown;
  teamInfo?: { leadAgent?: unknown; memberAgents?: unknown };
  displayName?: Localized;
  displayDescription?: Localized;
  avatar?: unknown;
  categoryId?: unknown;
  tags?: unknown;
  quickPrompts?: unknown;
  members?: unknown;
}

const invalid = (reason: string): never => {
  throw new ProtocolError("expert_invalid", reason);
};

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const out = value.trim();
  return out ? out.slice(0, max) : undefined;
};

const localized = (value: unknown, max = 300): string | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Localized;
  return text(item.zh, max) ?? text(item.en, max);
};

const localizedList = (value: unknown, maxItems: number, maxItem: number): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const item = localized(entry, maxItem) ?? text(entry, maxItem);
    if (item && !out.includes(item)) out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
};

/** WorkBuddy category ids (`08-FinanceInvestment`) → OpenBuddy's built-in category ids. */
const CATEGORY_MAP: Record<string, string> = {
  ProductDesign: "product",
  Engineering: "dev",
  GameSpatial: "dev",
  DataAI: "data",
  MarketingGrowth: "writing",
  FinanceInvestment: "research",
  TencentZone: "dev",
  Education: "learning",
  Language: "language",
  Office: "office",
};
const categoryOf = (value: unknown): string => {
  const id = text(value, 64);
  if (!id) return "custom";
  return CATEGORY_MAP[id.replace(/^\d+-/, "")] ?? "custom";
};

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const safeEntry = (name: string): boolean =>
  !!name && name.length <= 1024 && !name.includes("\0") && !name.startsWith("/") &&
  !/^[A-Za-z]:/.test(name) && !name.split("/").some((part) => part === "..");

/** Normalise an archive entry name to forward slashes; rejects traversal. */
const entryName = (raw: string): string => raw.replace(/\\/g, "/").replace(/^\.\//, "");

/** Read a ZIP into name → bytes. Central-directory driven; STORE and DEFLATE only. */
export function readWorkBuddyZip(buffer: Buffer): Map<string, Uint8Array> {
  const eocd = findEocd(buffer);
  if (eocd < 0) invalid("不是有效的 zip 文件");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = entryName(buffer.toString("utf8", offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if ((flags & 0x1) !== 0 || !safeEntry(name) || SKIP.test(name) || name.endsWith("/")) continue;
    if (compressedSize === 0xffffffff) continue; // ZIP64: not needed for expert packages
    if (files.size >= MAX_FILES || compressedSize > MAX_FILE_BYTES) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > buffer.length) continue;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let bytes: Uint8Array;
    try {
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = inflateRawSync(raw);
      else continue;
    } catch {
      continue;
    }
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) break;
    files.set(name, bytes);
  }
  if (!files.size) invalid("zip 中没有可读取的文件");
  return files;
}

function findEocd(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= start; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

/** Load a WorkBuddy package from a directory (already extracted). */
export function readWorkBuddyDir(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  const walk = (dir: string, prefix: string, depth: number) => {
    if (depth > 8 || files.size >= MAX_FILES) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (SKIP.test(relative) || entry.name === ".DS_Store") continue;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), relative, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = join(dir, entry.name);
      try {
        const size = statSync(path).size;
        if (size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue;
        const bytes = readFileSync(path);
        total += bytes.length;
        files.set(relative, bytes);
      } catch {
        /* unreadable: skip */
      }
    }
  };
  walk(root, "", 0);
  if (!files.size) invalid("目录中没有文件");
  return files;
}

/** Find the package root inside a set of archive entries (the folder holding plugin.json). */
export function findWorkBuddyRoot(files: Map<string, Uint8Array>): string {
  const manifests = [...files.keys()].filter((name) =>
    name === ".codebuddy-plugin/plugin.json" || name.endsWith("/.codebuddy-plugin/plugin.json") ||
    name === "plugin.json" || name.endsWith("/plugin.json"),
  );
  if (manifests.length) {
    return manifests.sort((a, b) => a.length - b.length)[0]!.replace(/(?:\.codebuddy-plugin\/)?plugin\.json$/, "").replace(/\/$/, "");
  }
  const agent = [...files.keys()].find((name) => /(^|\/)agents\/[^/]+\.md$/i.test(name));
  if (agent) return agent.replace(/agents\/[^/]+\.md$/i, "").replace(/\/$/, "");
  return invalid("没有找到 WorkBuddy 的 plugin.json 或 agents/*.md");
}

const readJson = (files: Map<string, Uint8Array>, path: string): WorkBuddyPlugin => {
  const bytes = files.get(path);
  if (!bytes) return {};
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as WorkBuddyPlugin : {};
  } catch {
    return invalid("plugin.json 无法解析");
  }
};

/** Parse plugin.json + agents into OpenBuddy drafts (no filesystem writes). */
export function readWorkBuddyPackage(files: Map<string, Uint8Array>): WorkBuddyPackage {
  const root = findWorkBuddyRoot(files);
  const prefix = root ? `${root}/` : "";
  const plugin = readJson(files, `${prefix}.codebuddy-plugin/plugin.json`) ?? readJson(files, `${prefix}plugin.json`);
  const packageName = text(plugin.name, 80) ?? root.split("/").pop() ?? "workbuddy-package";

  const declared = Array.isArray(plugin.agents)
    ? plugin.agents.map((item) => text(item, 512)).filter((item): item is string => !!item)
    : [];
  const agentPaths = declared.length
    ? declared.map((item) => entryName(item.replace(/^\.\//, ""))).filter(safeEntry).map((item) => `${prefix}${item}`)
    : [...files.keys()].filter((name) => name.startsWith(`${prefix}agents/`) && /\.md$/i.test(name));
  const paths = [...new Set(agentPaths)].filter((path) => files.has(path)).slice(0, MAX_AGENTS);
  if (!paths.length) invalid("专家包中没有 agents/*.md");

  const members = Array.isArray(plugin.members)
    ? plugin.members.map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : {}))
    : [];
  const leadId = text(plugin.agentName, 80) ?? text(plugin.teamInfo?.leadAgent, 80) ?? text(members.find((member) => member.role === "lead")?.id, 80);
  const tags = localizedList(plugin.tags, EXPERT_LIMITS.tags, EXPERT_LIMITS.tag);
  const quickPrompts = localizedList(plugin.quickPrompts, EXPERT_LIMITS.examples, EXPERT_LIMITS.example);

  const drafts: WorkBuddyDraft[] = [];
  for (const path of paths) {
    const raw = new TextDecoder().decode(files.get(path));
    let frontmatter: Record<string, unknown> = {};
    let body = raw;
    try {
      const parsed = parseFrontmatter<Record<string, unknown>>(raw);
      frontmatter = parsed.frontmatter && typeof parsed.frontmatter === "object" ? parsed.frontmatter : {};
      body = parsed.body;
    } catch {
      /* keep the whole file as the persona */
    }
    const stem = basename(path, extname(path));
    const fallbackId = slugify(stem) || slugify(text(frontmatter.name, 80) ?? "") || `workbuddy-${drafts.length + 1}`;
    const id = slugify(text(frontmatter.name, 80) ?? "") || fallbackId;
    const member = members.find((item) => text(item.id, 80) === id || text(item.id, 80) === stem);
    const role = text(member?.role, 16);
    const isLead = role === "lead" || id === leadId || stem === leadId;
    const name =
      localized(frontmatter.displayName, EXPERT_LIMITS.name) ??
      localized(member?.displayName, EXPERT_LIMITS.name) ??
      (paths.length === 1 ? localized(plugin.displayName, EXPERT_LIMITS.name) : undefined) ??
      text(frontmatter.name, EXPERT_LIMITS.name) ?? stem;
    const avatarRel = text(member?.avatar, EXPERT_LIMITS.avatar) ??
      text(frontmatter.avatar, EXPERT_LIMITS.avatar) ??
      (isLead ? text(plugin.avatar, EXPERT_LIMITS.avatar) : undefined);
    const avatarPath = avatarRel && safeEntry(entryName(avatarRel)) ? `${prefix}${entryName(avatarRel).replace(/^\.\//, "")}` : undefined;
    const avatarBytes = avatarPath ? files.get(avatarPath) : undefined;
    const prompt = body.trim().slice(0, EXPERT_LIMITS.prompt);
    drafts.push({
      draft: {
        id,
        name,
        description: text(frontmatter.description, EXPERT_LIMITS.description) ?? localized(plugin.displayDescription, EXPERT_LIMITS.description) ?? "",
        category: categoryOf(plugin.categoryId),
        tags: [...new Set(["workbuddy", ...tags])].slice(0, EXPERT_LIMITS.tags),
        examples: isLead ? quickPrompts : [],
        prompt,
      },
      ...(avatarBytes && IMAGE.test(avatarPath!) && avatarBytes.length <= MAX_AVATAR_BYTES
        ? { avatar: { name: basename(avatarPath!), bytes: avatarBytes } }
        : {}),
    });
  }
  if (!drafts.length) invalid("专家包中没有可导入的专家");
  return { name: packageName, root, drafts };
}

/** Entry point used by the expert store: directory or `.zip`. */
export function readWorkBuddyPackageFrom(path: string, bytes?: Buffer): WorkBuddyPackage {
  let files: Map<string, Uint8Array>;
  if (bytes) files = readWorkBuddyZip(bytes);
  else {
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      return invalid("路径不存在");
    }
    files = isDir ? readWorkBuddyDir(path) : readWorkBuddyZip(readFileSync(path));
  }
  return readWorkBuddyPackage(files);
}
