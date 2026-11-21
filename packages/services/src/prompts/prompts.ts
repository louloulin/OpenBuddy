import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Settings } from "../settings/settings.js";

/**
 * 我的指令 (20261116-pii W2.7 / S8): Pi prompt templates. Each template is a Markdown file in
 * `<agentDir>/prompts/` (global) or `<cwd>/.pi/prompts/` (project, only while the folder is
 * trusted). Pi's own loader parses these with YAML frontmatter (`description`,
 * `argument-hint`) — the session exposes them through `promptsOverride` and the `/` menu
 * expands them, so what this service writes is exactly what runs.
 */
export interface PromptInfo {
  name: string;
  description: string;
  argumentHint?: string;
  content: string;
  /** "global" | "workspace". */
  scope: "global" | "workspace";
  path: string;
}

export interface PromptDraft {
  name: string;
  description?: string;
  argumentHint?: string;
  content: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class PromptsService {
  constructor(
    private settings: Settings,
    private trusted: (cwd: string) => boolean,
  ) {}

  private root(scope: "global" | "workspace", cwd?: string): string {
    if (scope === "global") return join(this.settings.dir, "prompts");
    if (!cwd) throw Error("prompts_no_workspace: 需要先打开任务");
    return join(cwd, ".pi", "prompts");
  }

  private canWrite(cwd?: string): cwd is string {
    return !!cwd && this.trusted(cwd);
  }

  /** Every template visible in this cwd, global first. Malformed files are reported and skipped. */
  async list(cwd?: string): Promise<PromptInfo[]> {
    const out: PromptInfo[] = [];
    await this.collect("global", cwd, out);
    if (this.canWrite(cwd)) await this.collect("workspace", cwd, out);
    return out;
  }

  private async collect(scope: "global" | "workspace", cwd: string | undefined, out: PromptInfo[]) {
    const root = this.root(scope, cwd);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      try {
        const raw = await readFile(join(root, entry.name), "utf8");
        out.push(parseTemplate(raw, join(root, entry.name), scope));
      } catch {
        /* unreadable: skip */
      }
    }
  }

  /** Create or overwrite `<name>.md`. `name` is the file stem and the `/name` invocation. */
  async save(scope: "global" | "workspace", draft: PromptDraft, cwd?: string): Promise<PromptInfo> {
    if (scope === "workspace" && !this.canWrite(cwd))
      throw Error("prompts_trust_required: 该工作区尚未受信任，不能写入项目指令");
    const name = draft.name.trim();
    if (!NAME.test(name)) throw Error("prompts_invalid_name: 指令名只能包含小写字母、数字、- 和 _，以字母或数字开头");
    if (typeof draft.content !== "string" || !draft.content.trim()) throw Error("prompts_empty: 指令内容不能为空");
    if ((draft.description ?? "").length > 200) throw Error("prompts_too_long: 描述超过 200 个字符");
    const file = join(this.root(scope, cwd), `${name}.md`);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, renderTemplate(draft));
    return { name, description: draft.description ?? "", ...(draft.argumentHint ? { argumentHint: draft.argumentHint } : {}), content: draft.content, scope, path: file };
  }

  async delete(scope: "global" | "workspace", name: string, cwd?: string): Promise<void> {
    if (scope === "workspace" && !this.canWrite(cwd))
      throw Error("prompts_trust_required: 该工作区尚未受信任，不能删除项目指令");
    if (!NAME.test(name)) throw Error("prompts_invalid_name: 指令名只能包含小写字母、数字、- 和 _");
    await rm(join(this.root(scope, cwd), `${name}.md`), { force: false });
  }

  /** The raw file text (frontmatter included) for the editor. */
  async get(scope: "global" | "workspace", name: string, cwd?: string): Promise<string> {
    if (!NAME.test(name)) throw Error("prompts_invalid_name: 指令名只能包含小写字母、数字、- 和 _");
    return readFile(join(this.root(scope, cwd), `${name}.md`), "utf8");
  }
}

/** Frontmatter (`description`, `argument-hint`) + body — Pi's `loadTemplateFromFile` format. */
function renderTemplate(draft: PromptDraft): string {
  const lines: string[] = ["---"];
  if (draft.description?.trim()) lines.push(`description: ${JSON.stringify(draft.description.trim())}`);
  if (draft.argumentHint?.trim()) lines.push(`argument-hint: ${JSON.stringify(draft.argumentHint.trim())}`);
  lines.push("---", "", `${draft.content.trim()}`, "");
  return lines.join("\n");
}

function parseTemplate(raw: string, filePath: string, scope: "global" | "workspace"): PromptInfo {
  const name = filePath.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  const trimmed = raw.trimStart();
  let description = "";
  let argumentHint: string | undefined;
  let content = raw;
  if (trimmed.startsWith("---")) {
    const rest = trimmed.slice(3);
    const close = rest.indexOf("\n---");
    if (close >= 0) {
      const fm = rest.slice(0, close);
      content = rest.slice(rest.indexOf("\n", close + 1) + 1);
      const desc = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
      description = unquote(desc);
      const hint = fm.match(/^argument-hint:\s*(.+)$/m)?.[1]?.trim();
      if (hint) argumentHint = unquote(hint);
    }
  }
  if (!description) {
    const first = content.split("\n").find((l) => l.trim());
    if (first) description = first.trim().slice(0, 60) + (first.trim().length > 60 ? "…" : "");
  }
  return { name, description, ...(argumentHint ? { argumentHint } : {}), content: content.trim(), scope, path: filePath };
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    return value.slice(1, -1);
  return value;
}

async function writeAtomic(file: string, content: string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, file);
}
