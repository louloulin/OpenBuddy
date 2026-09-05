/**
 * P2-13: Agents + presets + expert catalog + image asset sub-module.
 *
 * Owns `.md` agent file CRUD (per-scope under `<piHome>/agents` and
 * `<workspace>/.pi/agents`), agent preset discovery (agent.cordis.yml), the
 * expert-center manifest reader, and `readImageData` (base64-encoded images
 * with a 2 MiB cap).
 */
import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { AgentEntry } from "@openbuddy/shared-types";
import {
  agentRoot,
  assertResourcePath,
  filesIn,
  piRoot,
  readJson,
  safeName,
  within,
  workspaceRoot,
  writeJson,
  writeTextAtomic,
} from "./shared";

function agentDir(scope: "user" | "project", cwd?: string | null): string {
  return scope === "project" ? join(workspaceRoot(cwd), ".pi", "agents") : join(piRoot(), "agents");
}

function parseAgent(file: string, raw: string, scope: string): AgentEntry {
  const description = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const avatar = Number(raw.match(/^avatar:\s*(\d+)/m)?.[1]);
  return { name: basename(file, ".md"), description, scope, path: file, raw, ...(Number.isFinite(avatar) && avatar > 0 ? { avatar } : {}) };
}

export async function listAgents(cwd?: string | null): Promise<AgentEntry[]> {
  const result: AgentEntry[] = [];
  for (const [scope, root] of [["user", agentDir("user", cwd)], ["project", agentDir("project", cwd)]] as const) {
    for (const file of await filesIn(root, ".md")) result.push(parseAgent(file, await readFile(file, "utf8"), scope));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function allowedAgentFile(file: string, cwd?: string | null): string {
  const roots = [agentDir("user", cwd), agentDir("project", cwd)];
  for (const root of roots) {
    try {
      const candidate = isAbsolute(file) ? within(root, file) : within(root, join(root, file));
      if (candidate !== root) return candidate;
    } catch { /* try the next allowed root */ }
  }
  throw new Error("agent path is outside allowed roots");
}

export async function getAgent(file: string, cwd?: string | null): Promise<string> {
  return readFile(allowedAgentFile(file, cwd), "utf8");
}

export async function saveAgent(name: string, raw: string, cwd?: string | null): Promise<AgentEntry> {
  const file = join(agentDir("user", cwd), `${safeName(name)}.md`);
  await writeTextAtomic(file, raw);
  return parseAgent(file, raw, "user");
}

export async function deleteAgent(file: string, cwd?: string | null): Promise<void> {
  await rm(allowedAgentFile(file, cwd), { force: true });
}

export interface PiAgentPreset {
  id: string;
  trust: "system" | "user";
  path: string;
  name?: string;
  description?: string;
  order?: number;
  broken?: string;
}

function presetRoots(cwd?: string | null): Array<{ path: string; trust: PiAgentPreset["trust"] }> {
  return [
    { path: join(piRoot(), "agent-presets"), trust: "user" },
    { path: join(workspaceRoot(cwd), ".agent-presets"), trust: "user" },
  ];
}

function presetId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) throw new Error("invalid agent preset id");
  return normalized;
}

function yamlScalar(value: string): string | number | undefined {
  const text = value.trim().replace(/^['"]|['"]$/gu, "");
  if (!text) return undefined;
  const numberValue = Number(text);
  return Number.isFinite(numberValue) && /^-?\d+(?:\.\d+)?$/u.test(text) ? numberValue : text;
}

function parsePresetMetadata(raw: string): Pick<PiAgentPreset, "name" | "description" | "order"> {
  const body = raw.replace(/^---[\s\S]*?---\s*/u, "");
  const result: Pick<PiAgentPreset, "name" | "description" | "order"> = {};
  for (const line of body.split(/\r?\n/u)) {
    const match = /^\s*(name|description|order):\s*(.+?)\s*$/u.exec(line);
    if (!match) continue;
    const value = yamlScalar(match[2]);
    if (match[1] === "order" && typeof value === "number") result.order = value;
    if (match[1] === "name" && typeof value === "string") result.name = value;
    if (match[1] === "description" && typeof value === "string") result.description = value;
  }
  return result;
}

export async function listAgentPresets(cwd?: string | null): Promise<PiAgentPreset[]> {
  const seen = new Set<string>();
  const result: PiAgentPreset[] = [];
  for (const root of presetRoots(cwd)) {
    let children: import("node:fs").Dirent[] = [];
    try { children = await readdir(root.path, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory() || !/^[a-z0-9][a-z0-9-]*$/u.test(child.name) || seen.has(child.name)) continue;
      seen.add(child.name);
      const directory = join(root.path, child.name);
      const composition = join(directory, "agent.cordis.yml");
      let broken: string | undefined;
      let metadata: Pick<PiAgentPreset, "name" | "description" | "order"> = {};
      try {
        const raw = await readFile(composition, "utf8");
        metadata = parsePresetMetadata(await readFile(join(directory, "preset.yml"), "utf8").catch(() => ""));
        if (!raw.trim()) broken = "composition is empty";
      } catch { broken = "composition file agent.cordis.yml is missing or unreadable"; }
      result.push({ id: child.name, trust: root.trust, path: composition, ...metadata, ...(broken ? { broken } : {}) });
    }
  }
  return result.sort((left, right) => (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id));
}

export async function readAgentPreset(id: string, cwd?: string | null): Promise<string> {
  const wanted = presetId(id);
  const preset = (await listAgentPresets(cwd)).find((item) => item.id === wanted);
  if (!preset) throw new Error(`agent preset not found: ${wanted}`);
  return readFile(preset.path, "utf8");
}

export async function readAgentPresetDefaults(): Promise<{ default?: string }> {
  return readJson<{ default?: string }>(join(agentRoot(), "agent-presets.json"), {});
}

export async function writeAgentPresetDefault(id: string | undefined): Promise<{ default?: string }> {
  const value = id === undefined ? {} : { default: presetId(id) };
  await writeJson(join(agentRoot(), "agent-presets.json"), value, 0o600);
  return value;
}

export function agentTemplate(name: string, description: string, prompt: string): string {
  return `---\nname: ${safeName(name)}\ndescription: ${description.replace(/[\r\n]/g, " ")}\n---\n\n${prompt.trim()}\n`;
}

function localized(value: unknown, language = "zh"): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  return (typeof object[language] === "string" ? object[language] : typeof object.en === "string" ? object.en : "").trim();
}

async function buildManifestExpert(root: string, value: unknown): Promise<Record<string, unknown>[]> {
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  if (!id) return [];
  const plugin = typeof item.plugin === "string" ? item.plugin : undefined;
  let pluginJson: Record<string, unknown> = {};
  if (plugin) {
    for (const folder of [".aily-plugin", ".codebuddy-plugin"]) {
      pluginJson = await readJson<Record<string, unknown>>(join(root, plugin, folder, "plugin.json"), {});
      if (Object.keys(pluginJson).length) break;
    }
  }
  const avatar = typeof item.avatar === "string" ? item.avatar : undefined;
  const avatarLocal = plugin && typeof pluginJson.avatar === "string" ? await filePathIfExists(join(root, plugin, pluginJson.avatar)) : undefined;
  const agentName = typeof pluginJson.agentName === "string" ? pluginJson.agentName : undefined;
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => localized(tag)).filter(Boolean).slice(0, 3) : [];
  const quickPrompts = Array.isArray(item.quickPrompts) ? item.quickPrompts.map((prompt) => localized(prompt)).filter(Boolean).slice(0, 5) : [];
  return [{ id, cat: typeof item.categoryId === "string" ? item.categoryId : "general", name: localized(item.displayName) || id, nameEn: localized(item.displayName, "en") || undefined, title: localized(item.profession) || id, titleEn: localized(item.profession, "en") || undefined, desc: localized(item.displayDescription) || localized(item.description) || id, tags, type: item.expertType === "team" ? "team" : "agent", author: localized(item.author) || undefined, ribbon: localized(item.operationalTag) || undefined, init: localized(item.defaultInitPrompt) || undefined, opc: item.isOPC === true, pos: typeof item.displayPosition === "number" ? item.displayPosition : undefined, updated: typeof item.updatedAt === "string" ? item.updatedAt : undefined, avatarLocal, avatarUrl: avatar ? (avatar.startsWith("http") ? avatar : `https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/${avatar.replace(/^\/+/, "")}`) : undefined, plugin, agentName, quickPrompts }];
}

async function filePathIfExists(file: string): Promise<string | undefined> {
  try { return (await stat(file)).isFile() ? file : undefined; } catch { return undefined; }
}

async function readFeaturedScenes(root: string): Promise<Array<Record<string, unknown>>> {
  const value = await readJson<Record<string, unknown>>(join(root, "_meta", "featuredScenes.json"), {});
  if (!Array.isArray(value.scenes)) return [];
  return value.scenes.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const scene = entry as Record<string, unknown>;
    if (typeof scene.id !== "string") return [];
    const image = typeof scene.image === "string" ? scene.image : "";
    const candidates = image ? [join(root, "_meta", image.replace(/^\/+/, "")), join(root, image.replace(/^\/+/, ""))] : [];
    const imageLocal = candidates.find((candidate) => candidate.startsWith(resolve(root)));
    return [{ id: scene.id, zh: localized(scene.displayName) || scene.id, expertIds: Array.isArray(scene.expertIds) ? scene.expertIds.filter((item): item is string => typeof item === "string") : [], imageLocal, imageUrl: image && /^https?:\/\//.test(image) ? image : undefined }];
  });
}

export async function listExpertCatalog(root: string): Promise<Record<string, unknown>> {
  const manifest = await readJson<Record<string, unknown>>(join(root, "_meta", "_expert_center.json"), {});
  const manifestExperts = Array.isArray(manifest.experts) ? manifest.experts : [];
  const categories = Array.isArray(manifest.categories) ? manifest.categories.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) return [];
    return [{ id, zh: localized(item.name), en: localized(item.name, "en") }];
  }) : [];
  const experts = (await Promise.all(manifestExperts.map((value) => buildManifestExpert(root, value)))).flat();
  if (!experts.length) {
    let plugins: import("node:fs").Dirent[] = [];
    try { plugins = await readdir(root, { withFileTypes: true }); } catch { return { root, categories, experts, featuredScenes: [] }; }
    for (const plugin of plugins) {
      if (!plugin.isDirectory()) continue;
      for (const file of await filesIn(join(root, plugin.name, "agents"), ".md")) {
        const raw = await readFile(file, "utf8").catch(() => "");
        const name = basename(file, ".md");
        const description = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? name;
        experts.push({ id: `${plugin.name}:${name}`, cat: "general", name, title: name, desc: description, tags: [], type: "agent", plugin: plugin.name, agentName: name });
      }
    }
  }
  return { root, categories: categories.length ? categories : [{ id: "general", zh: "通用", en: "General" }], experts, featuredScenes: await readFeaturedScenes(root) };
}

export async function expertDefaultRoot(cwd: string): Promise<string> {
  const candidates = [process.env.OPENBUDDY_AGENTS_DIR, join(resolve(cwd), ".pi", "experts"), join(agentRoot(), "agents"), join(agentRoot(), "workbuddy-experts"), join(process.env.PI_HOME ?? homedir(), "agents"), join(homedir(), "agents")].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (await filePathIfExists(join(candidate, "_meta", "_expert_center.json"))) return resolve(candidate);
  }
  return "";
}

export async function expertListRoots(root: string): Promise<string[]> {
  const base = resolve(root);
  const result: string[] = [];
  if (await filePathIfExists(join(base, "_meta", "_expert_center.json"))) result.push(base);
  try { for (const entry of await readdir(base, { withFileTypes: true })) if (entry.isDirectory() && await filePathIfExists(join(base, entry.name, "_meta", "_expert_center.json"))) result.push(join(base, entry.name)); } catch { /* missing root */ }
  return result;
}

export async function readExpertAgent(root: string, plugin: string, agentName: string): Promise<string> {
  const safeRoot = resolve(root);
  const safePlugin = safeName(plugin);
  const safeAgent = safeName(agentName).replace(/\.md$/, "");
  const file = await assertResourcePath(join(safeRoot, safePlugin, "agents", `${safeAgent}.md`), [safeRoot]);
  return readFile(file, "utf8");
}

export async function linkExpertAgents(root: string, plugin: string, agentNames?: string[]): Promise<number> {
  const sourceRoot = resolve(root);
  const pluginName = safeName(plugin);
  const sourceDir = await assertResourcePath(join(sourceRoot, pluginName, "agents"), [sourceRoot]);
  const names = agentNames?.length
    ? agentNames.map((name) => safeName(name).replace(/\.md$/, ""))
    : (await filesIn(sourceDir, ".md")).map((file) => basename(file, ".md"));
  const targetDir = join(piRoot(), "agents");
  await mkdir(targetDir, { recursive: true });
  for (const name of names) await copyFile(await assertResourcePath(join(sourceDir, `${name}.md`), [sourceDir]), join(targetDir, `${name}.md`));
  return names.length;
}

export async function readImageData(filePath: string, allowedRoots?: string[]): Promise<string> {
  const file = allowedRoots?.length ? await assertResourcePath(filePath, allowedRoots) : resolve(filePath);
  const extension = extname(file).toLowerCase();
  if (![".svg", ".png", ".webp", ".jpg", ".jpeg", ".gif"].includes(extension)) throw new Error("asset is not an image");
  const data = await readFile(file);
  if (data.byteLength > 2 * 1024 * 1024) throw new Error("image exceeds 2 MiB");
  const mime = extension === ".svg" ? "image/svg+xml" : extension === ".webp" ? "image/webp" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".gif" ? "image/gif" : "image/png";
  return `data:${mime};base64,${data.toString("base64")}`;
}
