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
import type { AgentEntry } from "@openbuddy/shared-types";
import { userAgentsHome } from "@openbuddy/storage";
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
import { starterExpertsRoot, tryEnsureStarterExperts } from "./expert-starter/seed";

/**
 * Where user-scope agent markdown is read from and written to.
 *
 * Two roots are honoured at the same time:
 *   - Canonical (new): userAgentsHome() — ~/.openbuddy/agents/ by default.
 *     This is the directory the product tells users to author into,
 *     and where linkExpertAgents and saveAgent write.
 *   - Legacy (back-compat): <piHome>/agents = ~/.openbuddy/agent/agents/.
 *     This is what pi-subagents scans natively via
 *     path.join(getAgentDir(), 'agents'). We still list it so users who
 *     hand-edited there keep their agents visible; but new writes never go
 *     there.
 *
 * The two roots are deduplicated by file stem with the canonical root
 * winning, so a file that exists in both only surfaces once (and from the
 * canonical path) — that mirrors the precedence pi-subagents uses.
 */
function userAgentsRoots(): string[] {
  const canonical = resolve(userAgentsHome());
  const legacy = resolve(join(piRoot(), 'agents'));
  return canonical === legacy ? [canonical] : [canonical, legacy];
}

function agentDir(scope: 'user' | 'project', cwd?: string | null): string[] {
  return scope === 'project' ? [join(workspaceRoot(cwd), '.pi', 'agents')] : userAgentsRoots();
}

function parseAgent(file: string, raw: string, scope: string): AgentEntry {
  const description = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const avatar = Number(raw.match(/^avatar:\s*(\d+)/m)?.[1]);
  return { name: basename(file, ".md"), description, scope, path: file, raw, ...(Number.isFinite(avatar) && avatar > 0 ? { avatar } : {}) };
}

export async function listAgents(cwd?: string | null): Promise<AgentEntry[]> {
  const result: AgentEntry[] = [];
  const seen = new Set<string>();
  // User-scope first so user-defined agents show up under scope = 'user';
  // within user-scope the canonical root shadows the legacy nested one.
  for (const root of agentDir('user', cwd)) {
    for (const file of await filesIn(root, '.md')) {
      const name = basename(file, '.md');
      if (seen.has(name)) continue;
      seen.add(name);
      result.push(parseAgent(file, await readFile(file, 'utf8'), 'user'));
    }
  }
  for (const file of await filesIn(agentDir('project', cwd)[0]!, '.md')) {
    const name = basename(file, '.md');
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(parseAgent(file, await readFile(file, 'utf8'), 'project'));
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function allowedAgentFile(file: string, cwd?: string | null): string {
  // User-scope is checked first to match the original semantic and because
  // most projects don't ship a .pi/agents dir at all — checking project
  // first would call realpathSync on a non-existent root and bubble an
  // ENOENT before we ever get to the user's flat layout.
  //
  // Within user-scope, the canonical flat root (~/.openbuddy/agents/)
  // shadows the legacy nested one (~/.openbuddy/agent/agents/), so a
  // file present in both only resolves to the canonical copy. Project
  // scope acts as an override later in the loop.
  const roots = [...agentDir('user', cwd), ...agentDir('project', cwd)];
  for (const root of roots) {
    try {
      const candidate = isAbsolute(file) ? within(root, file) : within(root, join(root, file));
      if (candidate !== root) return candidate;
    } catch { /* try the next allowed root */ }
  }
  throw new Error('agent path is outside allowed roots');
}

export async function getAgent(file: string, cwd?: string | null): Promise<string> {
  return readFile(allowedAgentFile(file, cwd), "utf8");
}

export async function saveAgent(name: string, raw: string, cwd?: string | null): Promise<AgentEntry> {
  // Writes always land in the canonical user root, never in the legacy one.
  const file = join(userAgentsHome(), `${safeName(name)}.md`);
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
    for (const folder of [".openbuddy-plugin", ".aily-plugin", ".codebuddy-plugin"]) {
      pluginJson = await readJson<Record<string, unknown>>(join(root, plugin, folder, "plugin.json"), {});
      if (Object.keys(pluginJson).length) break;
    }
  }
  const avatar = typeof item.avatar === "string" ? item.avatar : undefined;
  const avatarLocal = plugin && typeof pluginJson.avatar === "string" ? await filePathIfExists(join(root, plugin, pluginJson.avatar)) : undefined;
  // `agentName` may live on the manifest entry (built-in catalog, WorkBuddy
  // import) or on the plugin manifest — accept either, so a plugin folder with
  // a single `agents/lead.md` still resolves without a plugin.json.
  const agentName = typeof pluginJson.agentName === "string"
    ? pluginJson.agentName
    : typeof item.agentName === "string" ? item.agentName : undefined;
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => localized(tag)).filter(Boolean).slice(0, 3) : [];
  const quickPrompts = Array.isArray(item.quickPrompts) ? item.quickPrompts.map((prompt) => localized(prompt)).filter(Boolean).slice(0, 5) : [];
  // R97 — pi.dev marketplace link. Manifest entries may carry the slug as a
  // plain string or a localized { zh, en } object; the renderer only needs the
  // slug (npm-style scoped package name), so prefer zh then en then raw.
  const piDevRaw = item.piDevSlug;
  const piDevSlug = typeof piDevRaw === "string"
    ? piDevRaw.trim() || undefined
    : piDevRaw && typeof piDevRaw === "object"
      ? (typeof (piDevRaw as Record<string, unknown>).zh === "string" ? (piDevRaw as Record<string, unknown>).zh as string : undefined) ||
        (typeof (piDevRaw as Record<string, unknown>).en === "string" ? (piDevRaw as Record<string, unknown>).en as string : undefined)
      : undefined;
  return [{ id, cat: typeof item.categoryId === "string" ? item.categoryId : "general", name: localized(item.displayName) || id, nameEn: localized(item.displayName, "en") || undefined, title: localized(item.profession) || id, titleEn: localized(item.profession, "en") || undefined, desc: localized(item.displayDescription) || localized(item.description) || id, tags, type: item.expertType === "team" ? "team" : "agent", author: localized(item.author) || undefined, ribbon: localized(item.operationalTag) || undefined, init: localized(item.defaultInitPrompt) || undefined, opc: item.isOPC === true, pos: typeof item.displayPosition === "number" ? item.displayPosition : undefined, updated: typeof item.updatedAt === "string" ? item.updatedAt : undefined, avatarLocal, avatarUrl: avatar ? (avatar.startsWith("http") ? avatar : `https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace/${avatar.replace(/^\/+/, "")}`) : undefined, plugin, agentName, quickPrompts, piDevSlug }];
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

/**
 * Resolve the expert catalog root, seeding the built-in starter pack first so a
 * fresh open-source install never lands on an empty expert page.
 *
 * Precedence (highest first):
 *   1. `OPENBUDDY_AGENTS_DIR` — explicit override (tests / power users).
 *   2. `<cwd>/.pi/experts`    — project-scoped catalog.
 *   3. `<agentHome>/workbuddy-experts` — user-imported WorkBuddy catalogs; an
 *      explicit import always outranks the bundled pack.
 *   4. `<agentHome>/experts`  — built-in starter pack (seeded here).
 *   5. `<agentHome>/agents`   — legacy pi agent directory.
 *
 * The starter pack is materialized before the candidate walk so step 3 always
 * exists; `tryEnsureStarterExperts` never throws, so a read-only agent home
 * degrades to the previous behaviour instead of failing the page.
 */
export async function expertDefaultRoot(cwd: string): Promise<string> {
  await tryEnsureStarterExperts();
  const candidates = [
    process.env.OPENBUDDY_AGENTS_DIR,
    join(resolve(cwd), ".pi", "experts"),
    join(agentRoot(), "workbuddy-experts"),
    starterExpertsRoot(),
    join(agentRoot(), "agents"),
    userAgentsHome(),
  ].filter((value): value is string => Boolean(value));
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

/**
 * The runtime identity of an agent definition: the frontmatter `name:` field.
 *
 * Why this exists (real defect, R96)
 * ----------------------------------
 * `linkExpertAgents()` used to name the linked file after the **source file
 * stem**. Every built-in starter expert keeps its lead prompt in `agents/lead.md`
 * (the manifest's `agent` field is literally `"lead"`), so linking six experts
 * wrote six times to `<agentHome>/agents/lead.md` — last write won and five
 * experts silently disappeared from the assistant rail. Measured before/after on
 * a temp agent home: `["lead","starter-clarifier",…]` for 6 experts.
 *
 * pi-subagents keys agents by frontmatter `name` (see its
 * `loadAgentsFromDefinitionFiles`: `if (!frontmatter.name) continue`), and
 * OpenBuddy's own `listAgents()` displays the file stem. Naming the link target
 * after the frontmatter `name` makes those two agree, so one file serves both
 * the rail label and subagent dispatch.
 *
 * Falls back to the file stem when frontmatter is missing/unsafe, preserving the
 * old behaviour for hand-written agent files that never declared a name.
 */
function agentRuntimeName(raw: string, fallback: string): string {
  const declared = raw.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  if (!declared) return fallback;
  try {
    return safeName(declared);
  } catch {
    // A frontmatter name is still attacker-controlled input from an imported
    // catalog; never let it escape the target directory.
    return fallback;
  }
}

export async function linkExpertAgents(root: string, plugin: string, agentNames?: string[]): Promise<number> {
  const sourceRoot = resolve(root);
  const pluginName = safeName(plugin);
  const sourceDir = await assertResourcePath(join(sourceRoot, pluginName, "agents"), [sourceRoot]);
  const names = agentNames?.length
    ? agentNames.map((name) => safeName(name).replace(/\.md$/, ""))
    : (await filesIn(sourceDir, ".md")).map((file) => basename(file, ".md"));
  // Expert prompts link into the canonical flat user root
  // (~/.openbuddy/agents/), not the legacy nested one. That is the path
  // the user is told to author into and the path our listAgents() reports.
  const targetDir = userAgentsHome();
  await mkdir(targetDir, { recursive: true });
  let linked = 0;
  for (const name of names) {
    const source = await assertResourcePath(join(sourceDir, `${name}.md`), [sourceDir]);
    const raw = await readFile(source, "utf8");
    const targetName = agentRuntimeName(raw, name);
    await copyFile(source, join(targetDir, `${targetName}.md`));
    // Migration for the collapsed-`lead.md` era: when the runtime name differs
    // from the source stem, a target file under the *old* name may be a
    // leftover copy of this exact source (that is how six experts overwrote
    // each other). Delete it only when the bytes are identical, so a
    // hand-written `lead.md` a user authored is never touched.
    if (targetName !== name) {
      const stale = join(targetDir, `${name}.md`);
      const staleRaw = await readFile(stale, "utf8").catch(() => null);
      if (staleRaw !== null && staleRaw === raw) await rm(stale, { force: true });
    }
    linked += 1;
  }
  return linked;
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
