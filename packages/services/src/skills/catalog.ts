import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SkillCatalog, SkillCategory, SkillItem } from "@openbuddy/protocol/dto";
import type { Settings } from "../settings/settings.js";

/**
 * 技能目录 (20261116-pii W2.7). Port of the historical `skills_catalog.rs`: scan a user-picked
 * connectors-marketplace root (`connectors/<source>/skills/SKILL.md`, icons in `icons/`) plus an
 * optional built-in root (`<name>/SKILL.md`), merge deduped by id (built-ins win and are 精选),
 * and derive a category from name + description.
 *
 * The command names and DTOs are the ones the renderer's SkillsTab already used, so only the
 * main-process side was missing. `read_skill` returns the raw SKILL.md so the import flow can
 * strip frontmatter before installing it into the user's skill paths (`skills_add`).
 */
export class SkillCatalogService {
  constructor(private settings: Settings) {}

  /** First existing marketplace root: the env override, then `~/.openbuddy/connectors-marketplace`. */
  async defaultRoot(): Promise<string> {
    const candidates = [process.env.OPENBUDDY_CONNECTORS_DIR, join(this.settings.dir, "..", "connectors-marketplace")];
    for (const c of candidates) {
      if (c && (await connectorRootValid(c))) return c;
    }
    return "";
  }

  /** The picked root itself, plus any direct child that looks like a marketplace. */
  async listRoots(root: string): Promise<string[]> {
    const hits: string[] = [];
    if (await connectorRootValid(root)) hits.push(root);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return hits;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(root, entry.name);
      if (await connectorRootValid(child)) hits.push(child);
    }
    return hits;
  }

  async load(root?: string, builtinRoot?: string): Promise<SkillCatalog> {
    const connRoot = root || (await this.defaultRoot());
    const builtin = builtinRoot || "";
    const connectorSkills = connRoot ? await scanConnectorSkills(connRoot) : [];
    const builtinSkills = builtin ? await scanBuiltinSkills(builtin) : [];
    const byId = new Map<string, RawSkill>();
    const featured = new Set<string>();
    for (const rs of connectorSkills) if (!byId.has(rs.id)) byId.set(rs.id, rs);
    for (const rs of builtinSkills) {
      featured.add(rs.id);
      byId.set(rs.id, rs);
    }
    const skills: SkillItem[] = [...byId.values()].map((rs) => ({
      id: rs.id,
      name: rs.name,
      desc: rs.desc,
      ...(rs.descEn ? { descEn: rs.descEn } : {}),
      ...(rs.version ? { version: rs.version } : {}),
      ...(rs.whenToUse ? { whenToUse: rs.whenToUse } : {}),
      sourceDir: rs.sourceDir,
      origin: rs.origin as SkillItem["origin"],
      ...(rs.plugin ? { plugin: rs.plugin } : {}),
      ...(rs.iconLocal ? { iconLocal: rs.iconLocal } : {}),
      cat: deriveCategory(rs.name, rs.desc),
      ...(featured.has(rs.id) ? { featured: true } : {}),
    }));
    skills.sort((a, b) => (a.featured !== b.featured ? (a.featured ? -1 : 1) : a.name.localeCompare(b.name)));
    return { root: connRoot, builtinRoot: builtin, categories: CATEGORIES, skills };
  }

  async readSkill(dir: string): Promise<string> {
    const file = join(dir, "SKILL.md");
    const info = await stat(file).catch(() => undefined);
    if (!info?.isFile()) throw Error(`未找到 SKILL.md：${dir}`);
    return readFile(file, "utf8");
  }
}

// ---------- shared parsing (frontmatter or salvage from the body) ----------

interface RawSkill {
  id: string;
  name: string;
  desc: string;
  descEn?: string;
  version?: string;
  whenToUse?: string;
  sourceDir: string;
  origin: "connector" | "builtin";
  plugin?: string;
  iconLocal?: string;
}

const CATEGORIES: SkillCategory[] = [
  { id: "dev", zh: "开发工具" },
  { id: "office", zh: "办公协同" },
  { id: "invest", zh: "投资理财" },
  { id: "data", zh: "数据分析" },
  { id: "content", zh: "内容创作" },
  { id: "eff", zh: "效率工具" },
  { id: "info", zh: "信息资讯" },
  { id: "design", zh: "设计创作" },
  { id: "other", zh: "其他" },
];

const CATEGORY_RULES: Array<[string, string]> = [
  ["股票|行情|财报|基金|估值|投资|金融|盘|资金流|选股|k线", "invest"],
  ["word|excel|ppt|powerpoint|文档|表格|幻灯片|office|wps|金山", "office"],
  ["代码|api|github|git|部署|全栈|backend|frontend|react|nextjs|sql|kubernetes|k8s|sentry|debug|refactor", "dev"],
  ["设计|design|figma|poster|slides|ui|canvas|海报|幻灯片|切图|设计稿", "design"],
  ["数据|csv|分析|报表|数据透视|可视化|dashboard", "data"],
  ["翻译|translate|简历|resume|seo|效率|邮件|mail|日程|自动化", "eff"],
  ["新闻|资讯|辟谣|舆情|热搜|热点", "info"],
  ["内容|创作|写作|文案|稿件|视频|字幕|youtube|bilibili|公众号|小红书", "content"],
];

export function deriveCategory(name: string, desc: string): string {
  const hay = `${name} ${desc}`.toLowerCase();
  for (const [pattern, cat] of CATEGORY_RULES)
    for (const keyword of pattern.split("|")) if (hay.includes(keyword)) return cat;
  return "other";
}

/** A marketplace root: `<root>/.codebuddy-connector/connectors.json` exists. */
async function connectorRootValid(root: string): Promise<boolean> {
  try {
    return (await stat(join(root, ".codebuddy-connector", "connectors.json"))).isFile();
  } catch {
    return false;
  }
}

/** A built-in root: at least one `<child>/SKILL.md`. */
async function builtinRootValid(root: string): Promise<boolean> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      if ((await stat(join(root, entry.name, "SKILL.md"))).isFile()) return true;
    } catch {
      /* not a skill */
    }
  }
  return false;
}

/** `connectors/<source>/skills/SKILL.md`, icon from `icons/<source>.svg|png`. */
async function scanConnectorSkills(root: string): Promise<RawSkill[]> {
  const out: RawSkill[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(join(root, "connectors"), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = entry.name;
    const skillMd = join(root, "connectors", source, "skills", "SKILL.md");
    try {
      if (!(await stat(skillMd)).isFile()) continue;
    } catch {
      continue;
    }
    const parsed = await parseSkillFile(skillMd, "connector", source);
    if (parsed) {
      parsed.iconLocal = await findConnectorIcon(root, source);
      out.push(parsed);
    }
  }
  return out;
}

async function findConnectorIcon(root: string, source: string): Promise<string | undefined> {
  for (const ext of ["svg", "png"]) {
    const file = join(root, "icons", `${source}.${ext}`);
    try {
      if ((await stat(file)).isFile()) return file;
    } catch {
      /* next extension */
    }
  }
  return undefined;
}

/** `<root>/<name>/SKILL.md`. */
async function scanBuiltinSkills(root: string): Promise<RawSkill[]> {
  const out: RawSkill[] = [];
  if (!(await builtinRootValid(root))) return out;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(root, entry.name, "SKILL.md");
    try {
      if (!(await stat(skillMd)).isFile()) continue;
    } catch {
      continue;
    }
    const parsed = await parseSkillFile(skillMd, "builtin");
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Frontmatter between `---` fences (first fence line may trail whitespace). */
export function extractFrontmatter(text: string): string | undefined {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) return undefined;
  const afterOpen = trimmed.slice(3);
  const nl = afterOpen.indexOf("\n");
  if (nl < 0) return undefined;
  const rest = afterOpen.slice(nl + 1);
  let pos = 0;
  while (pos < rest.length) {
    const next = rest.indexOf("\n", pos);
    if (next < 0) return undefined;
    if (rest.slice(pos, next).trimEnd() === "---") return rest.slice(0, pos);
    pos = next + 1;
  }
  return undefined;
}

/** A single top-level scalar: plain / quoted / block (`|`, `>`) / folded continuation lines. */
export function parseScalar(fm: string, key: string): string | undefined {
  const lines = fm.split("\n");
  const needle = `${key}:`;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedStart = line.trimStart();
    if (trimmedStart.length !== line.length || !trimmedStart.startsWith(needle)) continue;
    let value = trimmedStart.slice(needle.length).trim();
    if (value === "|" || value === "|-" || value === ">" || value === ">-") {
      const parts: string[] = [];
      for (const cont of lines.slice(i + 1)) {
        if (!cont.trim()) break;
        if (cont.trimStart().length === cont.length) break; // next top-level key
        parts.push(cont.trim());
      }
      return parts.join(value.startsWith(">") ? " " : "\n") || undefined;
    }
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2))
      return value.slice(1, -1);
    if (value) {
      const parts = [value];
      for (const cont of lines.slice(i + 1)) {
        if (!cont.trim()) break;
        if (cont.trimStart().length === cont.length) break;
        parts.push(cont.trim());
      }
      return parts.join(" ");
    }
    return undefined;
  }
  return undefined;
}

function firstHeading(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("# ")) {
      return t
        .slice(2)
        .trim()
        .replace(/^Skill\s*[:：]\s*/i, "") || undefined;
    }
  }
  return undefined;
}

function firstParagraph(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return t;
  }
  return undefined;
}

function looseField(text: string, key: string): string | undefined {
  const needle = `${key}:`;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (isLooseFieldLine(t, needle)) return t.slice(needle.length).trim();
  }
  return undefined;
}

function isLooseFieldLine(line: string, needle: string): boolean {
  if (!line.startsWith(needle)) return false;
  const next = line[needle.length];
  return next === " " || next === undefined;
}

/** Parse one SKILL.md; falls back to body salvage when there is no frontmatter. */
export async function parseSkillFile(path: string, origin: RawSkill["origin"], plugin?: string): Promise<RawSkill | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  const dirName = path.split(/[\\/]/).slice(-2, -1)[0] ?? "skill";
  const sourceDir = path.split(/[\\/]/).slice(0, -1).join("/");
  const fm = extractFrontmatter(text);
  if (fm) {
    const nameField = parseScalar(fm, "name");
    const desc = parseScalar(fm, "description_zh") ?? parseScalar(fm, "description") ?? "";
    return {
      id: nameField || dirName,
      name: nameField || dirName,
      desc,
      ...(parseScalar(fm, "description_en") ? { descEn: parseScalar(fm, "description_en") } : {}),
      ...(parseScalar(fm, "version") ? { version: parseScalar(fm, "version") } : {}),
      ...(parseScalar(fm, "when_to_use") ?? parseScalar(fm, "when-to-use")
        ? { whenToUse: parseScalar(fm, "when_to_use") ?? parseScalar(fm, "when-to-use") }
        : {}),
      sourceDir,
      origin,
      ...(plugin ? { plugin } : {}),
    };
  }
  return {
    id: dirName,
    name: firstHeading(text) || dirName,
    desc: looseField(text, "description") ?? firstParagraph(text) ?? "",
    ...(looseField(text, "version") ? { version: looseField(text, "version") } : {}),
    ...(looseField(text, "when_to_use") ? { whenToUse: looseField(text, "when_to_use") } : {}),
    sourceDir,
    origin,
    ...(plugin ? { plugin } : {}),
  };
}
