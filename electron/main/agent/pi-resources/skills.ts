/**
 * P2-13: Skills + workspace instructions sub-module.
 *
 * Moved out of `electron/main/agent/pi-resources.ts`. Owns the skill discovery
 * (`SKILL.md` files under `<agentRoot>/skills` and `<workspace>/.pi/skills`),
 * the workspace instruction aggregation (AGENTS.md / CLAUDE.md walking), and
 * the slash command list.
 */
import { access, copyFile, cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { SkillInfo } from "@openbuddy/shared-types";
import {
  agentRoot,
  assertResourcePath,
  readJson,
  safeName,
  within,
  workspaceRoot,
  writeJson,
} from "./shared";

export async function listSkills(cwd?: string | null): Promise<SkillInfo[]> {
  const roots = [join(agentRoot(), "skills"), join(workspaceRoot(cwd), ".pi", "skills")];
  const settings = await readJson<Record<string, unknown>>(join(agentRoot(), "settings.json"), {});
  const disabled = new Set(Array.isArray(settings.disabledSkills)
    ? settings.disabledSkills.filter((value): value is string => typeof value === "string")
    : []);
  const result: SkillInfo[] = [];
  for (const root of roots) {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await readdir(root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(root, entry.name, "SKILL.md");
      try {
        const raw = await readFile(skillFile, "utf8");
        const description = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
        result.push({ name: entry.name, displayName: entry.name, description, scope: root.includes(`${String.fromCharCode(47)}.pi${String.fromCharCode(47)}`) ? "project" : "user", enabled: !disabled.has(entry.name), userInvocable: true, path: join(root, entry.name) });
      } catch { /* ignore malformed skill */ }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(name: string, cwd?: string | null): Promise<{ name: string; description?: string; path: string; content: string }> {
  const skill = (await listSkills(cwd)).find((entry) => entry.name === name);
  if (!skill) throw new Error(`skill not found: ${name}`);
  if (!skill.path) throw new Error(`skill has no readable path: ${name}`);
  const content = await readFile(join(skill.path, "SKILL.md"), "utf8");
  return { name: skill.name, ...(skill.description ? { description: skill.description } : {}), path: skill.path, content };
}

export interface WorkspaceInstructionOptions {
  dshHome?: string;
  projectRootMarkers?: string[];
  maxSourceBytes?: number;
  instructionFileCandidates?: string[];
  localInstructionFileCandidates?: string[];
}

type WorkspaceInstructionFile = { directory: string; display: string; content: string };

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = Math.max(0, Math.floor(maxBytes));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

async function projectInstructionRoot(workspace: string, markers: readonly string[]): Promise<string | undefined> {
  let cursor = workspace;
  while (true) {
    for (const marker of markers) {
      try { await access(join(cursor, marker)); return cursor; } catch { /* keep walking */ }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

export async function readWorkspaceInstructions(cwd?: string | null, maxBytes = 128 * 1024, options: WorkspaceInstructionOptions = {}): Promise<string> {
  const workspace = resolve(cwd || process.cwd());
  const budget = Math.floor(maxBytes);
  const maxSourceBytes = Math.floor(options.maxSourceBytes ?? 1024 * 1024);
  if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(maxSourceBytes) || maxSourceBytes <= 0) return "";
  const dshHome = resolve(options.dshHome ?? agentRoot());
  const markerRoot = await projectInstructionRoot(workspace, options.projectRootMarkers ?? [".git"]);
  const root = markerRoot ?? workspace;
  const displayRoot = markerRoot ?? workspace;
  const candidates = options.instructionFileCandidates ?? ["AGENTS.md", "CLAUDE.md"];
  const localCandidates = options.localInstructionFileCandidates ?? ["AGENTS.local.md", "CLAUDE.local.md"];
  const directories: string[] = [];
  let cursor = workspace;
  while (true) {
    directories.unshift(cursor);
    if (cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const files: WorkspaceInstructionFile[] = [];
  const seenPaths = new Set<string>();
  const contentByDirectory = new Map<string, Set<string>>();
  const add = async (file: string, directory: string, display: string): Promise<void> => {
    if (seenPaths.has(file)) return;
    seenPaths.add(file);
    try {
      const raw = await readFile(file, "utf8");
      if (!raw.trim() || Buffer.byteLength(raw, "utf8") > maxSourceBytes) return;
      const values = contentByDirectory.get(directory) ?? new Set<string>();
      if (values.has(raw.trim())) return;
      values.add(raw.trim());
      contentByDirectory.set(directory, values);
      files.push({ directory, display, content: raw });
    } catch { /* missing or unreadable instruction files are ignored */ }
  };
  await add(join(dshHome, "AGENTS.md"), "user-global", "$DSH_HOME/AGENTS.md");
  for (const directory of directories) {
    for (const candidate of [...candidates, ...localCandidates]) {
      if (!candidate || candidate === "." || candidate === ".." || /[\\/]/u.test(candidate)) continue;
      await add(join(directory, candidate), directory, relative(displayRoot, join(directory, candidate)) || candidate);
    }
  }
  if (!files.length) return "";
  const intro = "The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.";
  const render = (selected: WorkspaceInstructionFile[], notice = ""): string => [
    "<system-reminder>", intro, notice,
    ...selected.map((file) => `Instructions from: ${file.display}\n\n${file.content}`),
    "</system-reminder>",
  ].filter(Boolean).join("\n\n");
  let selected = [...files];
  let rendered = render(selected);
  while (Buffer.byteLength(rendered, "utf8") > budget && selected.length > 1) {
    selected.shift();
    rendered = render(selected, "Workspace instructions were omitted or truncated to fit the configured byte budget.");
  }
  if (Buffer.byteLength(rendered, "utf8") > budget && selected.length === 1) {
    const file = selected[0];
    const fixed = render([{ ...file, content: "" }], "Workspace instructions were omitted or truncated to fit the configured byte budget.");
    const available = Math.max(0, budget - Buffer.byteLength(fixed, "utf8"));
    rendered = render([{ ...file, content: truncateUtf8(file.content, available) }], "Workspace instructions were omitted or truncated to fit the configured byte budget.");
  }
  return truncateUtf8(rendered, budget);
}

export async function addSkill(pathValue: string, cwd?: string | null): Promise<void> {
  const source = resolve(pathValue);
  const targetRoot = pathValue.startsWith(".") ? join(workspaceRoot(cwd), ".pi", "skills") : join(agentRoot(), "skills");
  const sourceStat = await stat(source);
  const target = join(targetRoot, sourceStat.isDirectory() ? safeName(source.split("/").pop() ?? "skill") : safeName(source.replace(/\.md$/, "").split("/").pop() ?? "skill"));
  await mkdir(targetRoot, { recursive: true });
  if (sourceStat.isDirectory()) await cp(source, target, { recursive: true, force: true });
  else { await mkdir(target, { recursive: true }); await copyFile(source, join(target, "SKILL.md")); }
}

export async function removeSkill(pathValue: string, cwd?: string | null): Promise<void> {
  const roots = [join(agentRoot(), "skills"), join(workspaceRoot(cwd), ".pi", "skills")];
  const target = resolve(pathValue);
  for (const root of roots) {
    try {
      const candidate = within(root, target);
      if (candidate !== root) { await rm(candidate, { recursive: true, force: true }); return; }
    } catch {
      continue;
    }
  }
  throw new Error("skill path is outside allowed roots");
}

export async function toggleSkill(name: string, enabled: boolean): Promise<void> {
  const file = join(agentRoot(), "settings.json");
  const settings = await readJson<Record<string, unknown>>(file, {});
  const disabled = new Set(Array.isArray(settings.disabledSkills) ? settings.disabledSkills.filter((v): v is string => typeof v === "string") : []);
  if (enabled) disabled.delete(safeName(name)); else disabled.add(safeName(name));
  settings.disabledSkills = [...disabled];
  await writeJson(file, settings);
}

export async function listSkillCatalog(root: string, builtinRoot = ""): Promise<Record<string, unknown>> {
  const skills: Array<Record<string, unknown>> = [];
  const roots = [root, builtinRoot].filter(Boolean);
  for (const sourceRoot of roots) {
    let entries: import("node:fs").Dirent[] = [];
    try { entries = await readdir(sourceRoot, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = join(sourceRoot, entry.name);
      const file = join(dir, "SKILL.md");
      try {
        const raw = await readFile(file, "utf8");
        const description = raw.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? raw.split("\n").find((line) => line.trim() && !line.startsWith("---"))?.trim() ?? entry.name;
        skills.push({ id: entry.name, name: entry.name, desc: description, sourceDir: dir, origin: sourceRoot === builtinRoot ? "builtin" : "connector", cat: "general", featured: sourceRoot === builtinRoot });
      } catch { /* ignore malformed entries */ }
    }
  }
  return { root, builtinRoot, categories: [{ id: "general", zh: "通用" }], skills };
}

export async function readSkillCatalogSkill(dir: string, roots: string[]): Promise<string> {
  const safeDir = await assertResourcePath(dir, roots);
  return readFile(await assertResourcePath(join(safeDir, "SKILL.md"), roots), "utf8");
}

export async function listSlashCommands(): Promise<Array<{ name: string; description?: string; source: string }>> {
  const commands: Array<{ name: string; description?: string; source: string }> = [
    { name: "help", description: "Show available commands", source: "builtin" },
    { name: "clear", description: "Clear the current conversation", source: "builtin" },
    { name: "compact", description: "Compact the current session", source: "builtin" },
  ];
  for (const skill of await listSkills()) {
    commands.push({ name: skill.name, description: skill.description, source: `skill:${skill.scope ?? "user"}` });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
