import { loadSkills, parseFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { SkillExportResult, SkillInstallResult, SkillInfo } from "@openbuddy/protocol/dto";
import type { Settings } from "../settings/settings.js";
import { writeZip, type ZipEntry } from "./zip.js";

const MAX_FILES = 500;
const MAX_BYTES = 20 * 1024 * 1024;
const META = ".openbuddy.json";

/** A skill directory's SKILL.md frontmatter (name/version/displayName), read without a full parse. */
function readSkillMeta(dir: string): { name?: string; version?: string; displayName?: string } {
  try {
    const raw = readFileSync(join(dir, "SKILL.md"), "utf8").slice(0, 16 * 1024);
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(raw);
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : undefined);
    const display = frontmatter.displayName;
    return {
      ...(text(frontmatter.name) ? { name: text(frontmatter.name) } : {}),
      ...(text(frontmatter.version) ? { version: text(frontmatter.version) } : {}),
      ...(typeof display === "string" && display.trim() ? { displayName: display.trim().slice(0, 128) } : {}),
    };
  } catch {
    return {};
  }
}

interface TreeFile {
  /** POSIX-style path relative to the skill directory. */
  name: string;
  bytes: Uint8Array;
}

/** Walk a skill directory: regular files only, bounded count/size, never follows symlinks. */
async function walkSkill(dir: string): Promise<TreeFile[]> {
  const files: TreeFile[] = [];
  let total = 0;
  const visit = async (current: string) => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error("技能目录包含符号链接");
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(full);
      total += info.size;
      if (files.length >= MAX_FILES || total > MAX_BYTES) throw new Error("技能目录超过导入/导出限制");
      const name = relative(dir, full).split(sep).join("/");
      if (!name || name.startsWith("..") || name.includes("\0") || isAbsolute(name)) throw new Error("技能目录包含越界路径");
      files.push({ name, bytes: await readFile(full) });
    }
  };
  await visit(dir);
  return files;
}

export class SkillsService {
  constructor(private settings: Settings) {}

  discover(cwd: string): Skill[] {
    const c = this.settings.config.read();
    return loadSkills({
      cwd,
      agentDir: this.settings.dir,
      skillPaths: c.skillPaths,
      includeDefaults: true,
    }).skills;
  }
  active(cwd: string) {
    const disabled = this.settings.config.read().disabledSkills;
    return this.discover(cwd).filter((s) => !disabled.includes(s.name));
  }
  list(cwd: string): SkillInfo[] {
    const disabled = this.settings.config.read().disabledSkills;
    const owned = join(this.settings.dir, "skills");
    return this.discover(cwd).map((s) => {
      const meta = readSkillMeta(s.baseDir);
      const rel = relative(owned, s.baseDir);
      return {
        name: s.name,
        ...(meta.displayName ? { displayName: meta.displayName } : {}),
        description: s.description,
        path: s.baseDir,
        scope: s.filePath.startsWith(this.settings.dir) ? "user" : "repo",
        enabled: !disabled.includes(s.name),
        userInvocable: true,
        ...(meta.version ? { version: meta.version } : {}),
        ...(rel && !rel.startsWith("..") && !isAbsolute(rel) ? { market: true } : {}),
      };
    });
  }
  async add(path: string) {
    const actual = await realpath(path);
    await stat(actual);
    const c = this.settings.config.read();
    if (!c.skillPaths.includes(actual)) c.skillPaths.push(actual);
    this.settings.config.write(c);
  }
  async remove(path: string) {
    const actual = await realpath(path);
    const c = this.settings.config.read();
    if (!c.skillPaths.includes(actual))
      throw Error("只能移除通过添加路径安装的技能");
    c.skillPaths = c.skillPaths.filter((p) => p !== actual);
    this.settings.config.write(c);
    // Skills copied into `<pi>/skills` by 技能市场 belong to OpenBuddy: remove the files too.
    const owned = await realpath(join(this.settings.dir, "skills")).catch(() => join(this.settings.dir, "skills"));
    const rel = relative(owned, actual);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) await rm(actual, { recursive: true, force: true });
  }
  toggle(name: string, enabled: boolean) {
    const c = this.settings.config.read();
    c.disabledSkills = c.disabledSkills.filter((n) => n !== name);
    if (!enabled) c.disabledSkills.push(name);
    this.settings.config.write(c);
  }

  /**
   * 技能市场安装 (B1c): copy the marketplace directory into `<pi>/skills/<name>` so the skill
   * survives the source root being removed, record its origin/version, and add that copy to
   * Pi's skill paths. Already-installed names are idempotent (no second copy).
   */
  async installFromCatalog(dirs: string[], cwd: string): Promise<SkillInstallResult> {
    const installed: SkillInstallResult["installed"] = [];
    const failed: SkillInstallResult["failed"] = [];
    const current = this.list(cwd);
    for (const raw of [...new Set(dirs)]) {
      try {
        const actual = await realpath(raw);
        const info = await stat(actual);
        if (!info.isDirectory()) throw Error("不是技能目录");
        const meta = readSkillMeta(actual);
        const name = meta.name ?? basename(actual);
        const existing = current.find((skill) => skill.name === name);
        if (existing) {
          installed.push({ name, path: existing.path ?? actual, already: true, ...(existing.version ? { version: existing.version } : {}) });
          continue;
        }
        const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "skill";
        const target = join(this.settings.dir, "skills", slug);
        const files = await walkSkill(actual);
        await rm(target, { recursive: true, force: true });
        for (const file of files) {
          const dest = join(target, file.name);
          await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
          await writeFile(dest, file.bytes, { mode: 0o600 });
        }
        await writeFile(join(target, META), JSON.stringify({
          sourceDir: actual,
          installedAt: Date.now(),
          ...(meta.version ? { version: meta.version } : {}),
        }, null, 2), { mode: 0o600 });
        const saved = await realpath(target);
        const config = this.settings.config.read();
        if (!config.skillPaths.includes(saved)) config.skillPaths.push(saved);
        this.settings.config.write(config);
        installed.push({ name, path: saved, already: false, ...(meta.version ? { version: meta.version } : {}) });
      } catch (error) {
        failed.push({ dir: raw, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { installed, failed };
  }

  /**
   * 导出 ZIP (B1c): only a directory Pi currently discovers is exportable, so a renderer cannot
   * ask for arbitrary files. The archive re-imports through the same skill path rules.
   */
  async exportZip(path: string, target: string, cwd: string): Promise<SkillExportResult> {
    const actual = await realpath(path);
    const discovered = await Promise.all(this.discover(cwd).map((skill) => realpath(skill.baseDir).catch(() => skill.baseDir)));
    if (!discovered.includes(actual)) throw Error("只能导出已安装的技能");
    if (!isAbsolute(target) || !target.toLowerCase().endsWith(".zip") || target.includes("\0")) throw Error("导出目标必须是绝对路径的 .zip 文件");
    const entries: ZipEntry[] = (await walkSkill(actual)).filter((file) => file.name !== META);
    if (!entries.some((file) => file.name === "SKILL.md")) throw Error("技能目录缺少 SKILL.md");
    const bytes = writeZip(entries);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o600 });
    return { path: target, bytes: bytes.length, files: entries.map((file) => file.name) };
  }
}
