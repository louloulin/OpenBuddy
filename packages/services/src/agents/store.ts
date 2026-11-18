import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, renameSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { isExpertId, type ExpertCenterCatalog, type ExpertDraft, type ExpertEntry, type ExpertRootInfo, type ExpertScope } from "@openbuddy/protocol/experts";
import { ProtocolError } from "@openbuddy/protocol/errors";
import { JsonStore } from "../settings/settings.js";
import { avatarImage, IMAGE_EXT, normalizeDraft, parseExpertMarkdown, serializeExpert, slugify } from "./expert-file.js";
import { readWorkBuddyPackageFrom } from "./workbuddy.js";
import { EXPERT_CATEGORIES, EXPERT_SCENES, SEED_EXPERTS } from "./seeds.js";

/**
 * Expert store (20261116-pii W2.1): `agents/<id>.md` files in the app's Pi data dir, plus
 * read-only sources merged into the catalog:
 *
 *   user     `<pi>/agents/*.md`                writable ("我的专家")
 *   project  `<cwd>/.pi/agents/*.md`           only when the folder is trusted
 *   library  user-added directories            `experts-roots.json`, read-only
 *   builtin  the seeds in `seeds*.ts`           read-only
 *
 * The same id in several sources resolves in that order. Ids are file names and never paths;
 * legacy `path` payloads are accepted only inside the user directory. Images are read only from
 * the user, library and trusted project directories.
 */
export interface ExpertStoreOptions {
  /** The app's Pi data dir (`<userData>/pi`). */
  dir: string;
  /** Folder trust (the engine's decision); project experts are read only for trusted folders. */
  trusted: (cwd: string) => boolean;
  /** Override the built-in experts (tests). */
  seeds?: ExpertDraft[];
}

const MAX_FILE = 256 * 1024;
const MAX_FILES = 300;
const MAX_ROOTS = 20;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const notFound = (id: string): never => {
  throw new ProtocolError("expert_not_found", `找不到专家：${id}`);
};
const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel);
};
const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
};

export class ExpertStore {
  readonly userDir: string;
  private readonly roots: JsonStore<{ roots: string[] }>;
  private readonly seeds: ExpertDraft[];
  /** Trusted project expert dirs seen so far (allowed for image reads). */
  private readonly projectDirs = new Set<string>();

  constructor(private readonly options: ExpertStoreOptions) {
    this.userDir = join(options.dir, "agents");
    this.roots = new JsonStore(join(options.dir, "experts-roots.json"), () => ({ roots: [] }));
    this.seeds = options.seeds ?? SEED_EXPERTS;
  }

  /** The user experts directory, created on demand (`experts_default_root`). */
  ensureUserDir() {
    mkdirSync(this.userDir, { recursive: true, mode: 0o700 });
    return this.userDir;
  }

  /** `<cwd>/.pi/agents` when `cwd` is trusted; undefined otherwise (the trust gate). */
  projectDir(cwd?: string): string | undefined {
    if (!cwd || !isAbsolute(cwd) || !this.options.trusted(cwd)) return undefined;
    const dir = join(cwd, ".pi", "agents");
    if (existsSync(dir)) this.projectDirs.add(real(dir) ?? dir);
    return dir;
  }

  private builtin(): ExpertEntry[] {
    return this.seeds.map((draft) => this.entry(draft, draft.id!, "builtin", { path: `builtin:${draft.id}`, raw: serializeExpert(draft) }));
  }

  private entry(draft: ExpertDraft, id: string, scope: ExpertScope, extra: { path: string; raw: string; dir?: string; legacyAvatar?: number; modelTags?: string[]; origin?: string; mtime?: Date }): ExpertEntry {
    const imageRel = avatarImage(draft.avatar);
    let image: string | undefined;
    if (imageRel && extra.dir) {
      const candidate = resolve(extra.dir, imageRel);
      if (inside(candidate, extra.dir) && existsSync(candidate)) image = candidate;
    }
    return {
      id,
      name: draft.name,
      description: draft.description,
      scope,
      path: extra.path,
      raw: extra.raw,
      avatar: extra.legacyAvatar,
      modelTags: extra.modelTags,
      emoji: imageRel ? undefined : draft.avatar,
      image,
      category: draft.category,
      model: draft.model,
      thinking: draft.thinking,
      tools: draft.tools,
      skills: draft.skills,
      connectors: draft.connectors,
      examples: draft.examples ?? [],
      tags: draft.tags ?? [],
      prompt: draft.prompt,
      readonly: scope !== "user",
      origin: extra.origin,
      updatedAt: extra.mtime?.toISOString(),
    };
  }

  /** Read every `*.md` in `dir` (best-effort: one bad file never hides the others). */
  private scan(dir: string | undefined, scope: ExpertScope, problems: Array<{ path: string; error: string }>, origin?: string): ExpertEntry[] {
    if (!dir || !existsSync(dir)) return [];
    const out: ExpertEntry[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort().slice(0, MAX_FILES);
    } catch (error) {
      problems.push({ path: dir, error: String((error as Error).message ?? error) });
      return [];
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;
        if (stat.size > MAX_FILE) throw new ProtocolError("expert_invalid", "文件超过 256 KB");
        const stem = basename(name, extname(name));
        // User and project files must already use a valid id; library files are named freely.
        const id = scope === "library" ? (isExpertId(stem) ? stem : slugify(stem)) : stem;
        if (!isExpertId(id)) throw new ProtocolError("expert_invalid", "文件名只能包含小写字母、数字、- 和 _");
        const raw = readFileSync(path, "utf8");
        const parsed = parseExpertMarkdown(raw, stem);
        out.push(this.entry(parsed.draft, id, scope, { path, raw, dir, legacyAvatar: parsed.legacyAvatar, modelTags: parsed.modelTags, origin, mtime: stat.mtime }));
      } catch (error) {
        problems.push({ path, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return out;
  }

  private libraryDirs(root: string): string[] {
    return [root, join(root, "agents")];
  }

  private all(cwd: string | undefined, problems: Array<{ path: string; error: string }> = []) {
    const user = this.scan(this.userDir, "user", problems);
    const project = this.scan(this.projectDir(cwd), "project", problems);
    const library = this.rootPaths().flatMap((root) => this.libraryDirs(root).flatMap((dir) => this.scan(dir, "library", problems, root)));
    const seen = new Set<string>();
    const merged: ExpertEntry[] = [];
    for (const expert of [...user, ...project, ...library, ...this.builtin()]) {
      if (seen.has(expert.id)) continue;
      seen.add(expert.id);
      merged.push(expert);
    }
    return { merged, user, project };
  }

  /** `agents_list`: 我的专家 — the user's own experts, then trusted project ones (legacy semantics). */
  list(cwd?: string): ExpertEntry[] {
    const { user, project } = this.all(cwd);
    const ids = new Set(user.map((e) => e.id));
    return [...user, ...project.filter((e) => !ids.has(e.id))];
  }

  /** `experts_load`: the merged catalog for `cwd`. */
  catalog(cwd?: string): ExpertCenterCatalog {
    this.ensureUserDir();
    const problems: Array<{ path: string; error: string }> = [];
    const { merged } = this.all(cwd, problems);
    const projectDir = cwd && isAbsolute(cwd) ? join(cwd, ".pi", "agents") : undefined;
    return {
      userDir: this.userDir,
      projectDir,
      projectTrusted: !!this.projectDir(cwd),
      categories: EXPERT_CATEGORIES,
      experts: merged,
      scenes: EXPERT_SCENES.filter((scene) => scene.expertIds.some((id) => merged.some((e) => e.id === id))),
      roots: this.listRoots(),
      problems,
    };
  }

  /** Resolve one expert by id with source precedence (user → project → library → builtin). */
  get(id: string, cwd?: string): ExpertEntry {
    if (!isExpertId(id)) throw new ProtocolError("invalid_payload", "id");
    return this.all(cwd).merged.find((e) => e.id === id) ?? notFound(id);
  }

  /** Legacy `path` payloads: only `.md` files directly inside the user directory. */
  private userFile(path: string): string {
    const resolved = real(path);
    const dir = real(this.userDir);
    if (!resolved || !dir || dirname(resolved) !== dir || !resolved.endsWith(".md"))
      throw new ProtocolError("path_not_authorized", "只能访问“我的专家”目录中的专家文件");
    return resolved;
  }

  getByPath(path: string): ExpertEntry {
    const file = this.userFile(path);
    return this.get(basename(file, ".md"));
  }

  private uniqueId(base: string): string {
    const taken = new Set([...this.scan(this.userDir, "user", []).map((e) => e.id), ...this.seeds.map((s) => s.id!)]);
    let id = base;
    for (let n = 2; taken.has(id) || existsSync(join(this.userDir, `${id}.md`)); n++) id = `${base.slice(0, 60)}-${n}`;
    return id;
  }

  private write(id: string, raw: string) {
    const dir = this.ensureUserDir();
    const path = join(dir, `${id}.md`);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, raw, { mode: 0o600 });
    renameSync(temp, path);
    return path;
  }

  /**
   * `agents_save`. `create` derives a fresh id from `draft.id` or the name (never overwriting);
   * `update` rewrites an existing user expert. Built-in, project and library experts are read-only:
   * copy them first (create with a new name).
   */
  save(input: ExpertDraft, mode: "create" | "update" = input.id ? "update" : "create"): ExpertEntry {
    const draft = normalizeDraft(input);
    if (!draft.prompt) throw new ProtocolError("expert_invalid", "人设不能为空");
    let id: string;
    if (mode === "update") {
      if (!draft.id) throw new ProtocolError("expert_invalid", "缺少 id");
      id = draft.id;
      if (!existsSync(join(this.userDir, `${id}.md`))) {
        if (this.seeds.some((s) => s.id === id) || this.all(undefined).merged.some((e) => e.id === id))
          throw new ProtocolError("expert_readonly", "内置或外部目录中的专家不能直接修改，请先复制到“我的专家”");
        notFound(id);
      }
    } else {
      const base = draft.id ?? (slugify(draft.name) || `expert-${createHash("sha1").update(`${draft.name}\0${Date.now()}`).digest("hex").slice(0, 6)}`);
      id = this.uniqueId(base);
    }
    delete draft.id;
    this.write(id, serializeExpert(draft));
    return this.get(id);
  }

  /** Legacy `agents_save { name, raw }` (the historical AssistantsPanel). */
  saveRaw(name: string, raw: string): ExpertEntry {
    const parsed = parseExpertMarkdown(raw, name);
    const id = slugify(name) || slugify(parsed.draft.name) || `expert-${createHash("sha1").update(name).digest("hex").slice(0, 6)}`;
    this.write(id, serializeExpert(parsed.draft, { legacyAvatar: parsed.legacyAvatar, modelTags: parsed.modelTags }));
    return this.get(id);
  }

  /** `agents_delete`: user experts only. */
  delete(ref: { id?: string; path?: string }) {
    const path = ref.path ? this.userFile(ref.path) : join(this.userDir, `${ref.id}.md`);
    if (!ref.path && !isExpertId(ref.id)) throw new ProtocolError("invalid_payload", "id");
    if (!existsSync(path)) {
      if (ref.id && this.seeds.some((s) => s.id === ref.id)) throw new ProtocolError("expert_readonly", "内置专家不能删除");
      notFound(ref.id ?? basename(path));
    }
    rmSync(path);
  }

  /** `agents_template`: the Markdown a draft saves as (preview / raw editing). */
  template(input: ExpertDraft): string {
    return serializeExpert(normalizeDraft({ ...input, prompt: input.prompt ?? "" }));
  }

  // ---------- library directories ----------

  private rootPaths(): string[] {
    const roots = this.roots.read().roots;
    return Array.isArray(roots) ? roots.filter((r) => typeof r === "string" && isAbsolute(r)) : [];
  }

  listRoots(): ExpertRootInfo[] {
    return this.rootPaths().map((path) => {
      if (!existsSync(path)) return { path, exists: false, count: 0 };
      const problems: Array<{ path: string; error: string }> = [];
      const count = this.libraryDirs(path).reduce((n, dir) => n + this.scan(dir, "library", problems, path).length, 0);
      return { path, exists: true, count, ...(problems.length ? { error: `${problems.length} 个文件无法解析` } : {}) };
    });
  }

  /** `experts_set_roots`: replace the library list (absolute, existing directories; max 20). */
  setRoots(paths: string[]): ExpertRootInfo[] {
    const next: string[] = [];
    const own = [real(this.options.dir), real(this.userDir)].filter(Boolean);
    for (const path of paths) {
      if (!isAbsolute(path)) throw new ProtocolError("invalid_payload", `必须是绝对路径：${path}`);
      const resolved = real(path);
      if (!resolved || !statSync(resolved).isDirectory()) throw new ProtocolError("invalid_payload", `目录不存在：${path}`);
      if (own.includes(resolved)) throw new ProtocolError("invalid_payload", "无需添加“我的专家”目录");
      if (!next.includes(resolved)) next.push(resolved);
    }
    if (next.length > MAX_ROOTS) throw new ProtocolError("invalid_payload", `最多添加 ${MAX_ROOTS} 个目录`);
    this.roots.write({ roots: next });
    return this.listRoots();
  }

  /** `experts_link_agents`: copy experts from a configured library into 我的专家 (new or newer only). */
  importFrom(root: string, ids?: string[]): number {
    const resolved = real(root);
    if (!resolved || !this.rootPaths().includes(resolved)) throw new ProtocolError("path_not_authorized", "只能从已添加的专家目录导入");
    const wanted = ids ? new Set(ids) : undefined;
    let copied = 0;
    for (const expert of this.libraryDirs(resolved).flatMap((dir) => this.scan(dir, "library", [], resolved))) {
      if (wanted && !wanted.has(expert.id)) continue;
      const target = join(this.userDir, `${expert.id}.md`);
      const sourceTime = expert.updatedAt ? Date.parse(expert.updatedAt) : 0;
      if (existsSync(target) && statSync(target).mtimeMs >= sourceTime) continue;
      const draft = this.toDraft(expert);
      delete draft.id;
      this.write(expert.id, serializeExpert(draft));
      copied++;
    }
    return copied;
  }

  /**
   * `experts_import_workbuddy`: import a WorkBuddy expert package (ZIP or an extracted folder) into
   * 我的专家 (S18). Each agent becomes a normal Markdown expert; avatars are copied next to it.
   */
  importWorkBuddy(path: string): {
    package: string;
    imported: ExpertEntry[];
    skipped: Array<{ id: string; error: string }>;
    team?: { name: string; leadAgent?: string; members: string[] };
  } {
    const resolved = real(path);
    if (!resolved) throw new ProtocolError("path_not_authorized", "只能导入存在的 WorkBuddy 专家包");
    const isFile = statSync(resolved).isFile();
    const pkg = readWorkBuddyPackageFrom(resolved, isFile ? readFileSync(resolved) : undefined);
    const imported: ExpertEntry[] = [];
    const skipped: Array<{ id: string; error: string }> = [];
    /** Package agent id → the unique id actually written (S21 team wiring). */
    const idMap = new Map<string, string>();
    for (const item of pkg.drafts) {
      try {
        const created = this.save({ ...item.draft, id: item.draft.id }, "create");
        if (item.avatar) {
          const avatar = this.writeAvatar(created.id, item.avatar.name, item.avatar.bytes);
          if (avatar) {
            const draft = { ...item.draft, avatar, id: undefined };
            this.write(created.id, serializeExpert(draft));
          }
        }
        if (item.draft.id) idMap.set(item.draft.id, created.id);
        imported.push(this.get(created.id));
      } catch (error) {
        skipped.push({ id: item.draft.id ?? item.draft.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const team = pkg.team
      ? {
          name: pkg.team.name,
          ...(pkg.team.leadAgent ? { leadAgent: idMap.get(pkg.team.leadAgent) ?? pkg.team.leadAgent } : {}),
          members: pkg.team.memberAgents.map((id) => idMap.get(id) ?? id).filter((id) => imported.some((entry) => entry.id === id)),
        }
      : undefined;
    return { package: pkg.name, imported, skipped, ...(team && team.members.length ? { team } : {}) };
  }

  /** Copy a WorkBuddy avatar into `<user>/agents/avatars/<id>.<ext>` (bounded, image only). */
  private writeAvatar(id: string, name: string, bytes: Uint8Array): string | undefined {
    if (!IMAGE_EXT.test(name) || bytes.length === 0 || bytes.length > 2 * 1024 * 1024) return undefined;
    const ext = extname(name).toLowerCase();
    const dir = join(this.ensureUserDir(), "avatars");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${id}${ext}`), bytes, { mode: 0o600 });
    return `avatars/${id}${ext}`;
  }

  toDraft(expert: ExpertEntry): ExpertDraft {
    return normalizeDraft({
      id: expert.id, name: expert.name, avatar: expert.emoji, description: expert.description, category: expert.category,
      model: expert.model, thinking: expert.thinking, tools: expert.tools, skills: expert.skills, connectors: expert.connectors,
      examples: expert.examples, tags: expert.tags, prompt: expert.prompt,
    });
  }

  // ---------- images ----------

  private imageRoots(): string[] {
    return [this.userDir, ...this.rootPaths(), ...this.projectDirs].map((d) => real(d)).filter((d): d is string => !!d);
  }

  /** Bytes of an avatar / banner image inside an allowed root (`experts_thumbnail`, `experts_image_bytes`). */
  image(path: string, maxBytes: number): { mime: string; base64: string } {
    if (!isAbsolute(path) || !IMAGE_EXT.test(path)) throw new ProtocolError("path_not_authorized", "只能读取专家目录中的图片");
    const resolved = real(path);
    if (!resolved || !IMAGE_EXT.test(resolved) || !this.imageRoots().some((root) => inside(resolved, root)))
      throw new ProtocolError("path_not_authorized", "只能读取专家目录中的图片");
    const size = statSync(resolved).size;
    if (size > maxBytes) throw new ProtocolError("invalid_payload", "图片过大");
    return { mime: MIME[extname(resolved).toLowerCase()] ?? "application/octet-stream", base64: readFileSync(resolved).toString("base64") };
  }
}
