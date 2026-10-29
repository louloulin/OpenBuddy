/**
 * IPC surface — Git 面板(parity 阶段 2.2 / chat UI 计划批 5 遗留)。
 *
 * 给「变更」视图提供真实 git 数据(此前只有会话消息聚合的近似 diff):
 *   - `git:status`  工作区状态(porcelain 解析:已暂存/未暂存/未跟踪 + 分支);
 *   - `git:diff`    单文件 unified diff(staged / unstaged / 未跟踪伪 diff);
 *   - `git:log`     最近提交(默认 20 条);
 *   - `git:stage`   暂存/取消暂存(git add / git reset);
 *   - `git:commit`  提交(可选先暂存指定文件)。
 *
 * 安全:
 *   - cwd 信任门与终端面板同一判定(folder-trust 优先,agentHost 根兜底);
 *   - git 以 execFile 数组参数运行,无 shell,参数不可注入;
 *   - pathspec 一律置于 `--` 之后,且拒绝绝对路径逃逸与 `:` 魔法前缀。
 */
import { execFile } from "node:child_process";
import { statIfExists } from "@openbuddy/storage";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { wrapIpcHandler } from "./_wrap";
import { recordValue, requiredString, optionalFiniteInteger } from "./validation";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_LOG_LIMIT = 20;
const MAX_LOG_LIMIT = 100;
const MAX_COMMIT_MESSAGE = 2_000;
const MAX_PATHS = 200;

export interface GitStatusEntry {
  /** porcelain XY 两字符状态(暂存列 + 工作列)。 */
  x: string;
  y: string;
  path: string;
  /** 重命名时的原路径。 */
  origPath?: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  entries: GitStatusEntry[];
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

/** 传给 git 的依赖(测试可注入)。 */
export interface GitExecDeps {
  run: (cwd: string, args: string[]) => Promise<{ stdout: string }>;
}

function defaultDeps(): GitExecDeps {
  return {
    run: async (cwd, args) => {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      });
      return { stdout };
    },
  };
}

// ---------- porcelain / log 解析(纯函数,可单测) ----------

/** 解析 `git status --porcelain=v1 -b` 输出。 */
export function parseStatusPorcelain(stdout: string): GitStatusResult {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  let branch = "";
  const entries: GitStatusEntry[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      // `## main...origin/main [ahead 1]` / `## No commits yet on main`
      branch = line.slice(3).split("...")[0].replace(/^No commits yet on /, "").trim();
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") {
      entries.push({ x, y, path: line.slice(3) });
      continue;
    }
    const pathPart = line.slice(3);
    const arrow = pathPart.indexOf(" -> ");
    if (arrow >= 0) {
      entries.push({ x, y, path: pathPart.slice(0, arrow), origPath: pathPart.slice(arrow + 4) });
    } else {
      entries.push({ x, y, path: pathPart });
    }
  }
  return { isRepo: true, branch, entries };
}

/** 解析 `%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e` 分隔的 log 输出。 */
export function parseLog(stdout: string): GitLogEntry[] {
  const entries: GitLogEntry[] = [];
  for (const record of stdout.split("\x1e")) {
    const trimmed = record.replace(/^\n/, "");
    if (!trimmed.trim()) continue;
    const [hash, shortHash, subject, author, date] = trimmed.split("\x1f");
    if (!hash || !shortHash) continue;
    entries.push({
      hash,
      shortHash,
      subject: subject ?? "",
      author: author ?? "",
      date: date ?? "",
    });
  }
  return entries;
}

// ---------- 路径安全 ----------

/**
 * 仓库根锚定的 pathspec。
 *
 * `git status --porcelain` 给的路径**相对仓库根**,而 `git diff -- <path>`
 * 的 pathspec 默认相对**当前目录** —— cwd 是仓库子目录时两者对不上
 * ("pathspec did not match any files")。`:/` 前缀把 pathspec 锚到仓库根,
 * 与 status 输出对齐。
 *
 * 只接受仓库根相对的路径:绝对路径与 `..` 段一律拒绝(`:/` 锚点本身也
 * 把匹配范围限制在仓库内)。
 */
export function rootPathspec(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("git: empty pathspec");
  }
  if (raw.startsWith(":")) {
    throw new Error(`git: magic pathspec is not allowed: ${raw}`);
  }
  if (isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(`git: path must be relative to the repository root: ${raw}`);
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error(`git: path escapes the repository: ${raw}`);
  }
  return `:/${normalized}`;
}

function assertCwd(cwd: string): void {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) {
    throw new Error("git: cwd must be an absolute path");
  }
}

function isNotFoundRepoError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a git repository/i.test(message);
}

// ---------- 服务(信任门 + 各通道实现) ----------

export function createGitService(options: {
  deps?: GitExecDeps;
  isTrustedCwd: (cwd: string) => Promise<boolean>;
  getTrustedRoot: () => string | null;
}) {
  const deps = options.deps ?? defaultDeps();

  async function run(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await deps.run(cwd, args);
    return stdout;
  }

  /** 与终端面板同一信任判定:folder-trust 明确授权,或落在 agentHost 工作区内。 */
  async function assertTrusted(cwd: string): Promise<void> {
    assertCwd(cwd);
    const root = options.getTrustedRoot();
    const contained = root
      ? (() => {
          const rel = relative(root, cwd);
          return !rel.startsWith("..") && !isAbsolute(rel);
        })()
      : false;
    if (!contained && !(await options.isTrustedCwd(cwd))) {
      throw new Error(`git: cwd is not a trusted workspace (grant folder trust first): ${cwd}`);
    }
  }

  /** 读工作区状态(内部用,不做信任判定)。 */
  async function readStatus(cwd: string): Promise<GitStatusResult> {
    try {
      const stdout = await run(cwd, ["status", "--porcelain=v1", "-b"]);
      return parseStatusPorcelain(stdout);
    } catch (error) {
      if (isNotFoundRepoError(error)) return { isRepo: false, branch: "", entries: [] };
      throw error;
    }
  }

  async function status(cwd: string): Promise<GitStatusResult> {
    await assertTrusted(cwd);
    return readStatus(cwd);
  }

  /** 仓库根(cwd 可能是仓库子目录;status 的路径相对仓库根)。 */
  async function repoRoot(cwd: string): Promise<string> {
    const stdout = await run(cwd, ["rev-parse", "--show-toplevel"]);
    const root = stdout.trim();
    return root || cwd;
  }

  /** 未跟踪文件没有 diff,读内容构造全 + 行的伪 diff(与产物中心同法)。 */
  async function untrackedDiff(cwd: string, rawPath: string): Promise<string> {
    const root = await repoRoot(cwd);
    const absolute = resolve(root, rawPath);
    let content = "";
    try {
      const info = await statIfExists(absolute);
      if (!info?.isFile()) return "";
      content = await readFile(absolute, "utf8");
    } catch {
      return "";
    }
    const lines = content.split("\n");
    const header = [
      `--- /dev/null`,
      `+++ b/${rawPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ];
    return `${header.concat(lines.map((line) => `+${line}`)).join("\n")}\n`;
  }

  async function diff(cwd: string, rawPath: string, staged: boolean): Promise<string> {
    await assertTrusted(cwd);
    const pathspec = rootPathspec(rawPath);
    // 未跟踪:staged 恒为 false(untracked 不可能已暂存)。
    const st = await readStatus(cwd);
    const match = st.entries.find((e) => e.path === rawPath);
    if (match && match.x === "?" && match.y === "?") {
      return untrackedDiff(cwd, rawPath);
    }
    const args = staged
      ? ["diff", "--no-color", "--cached", "--", pathspec]
      : ["diff", "--no-color", "--", pathspec];
    return run(cwd, args);
  }

  async function log(cwd: string, limit: number): Promise<GitLogEntry[]> {
    await assertTrusted(cwd);
    const capped = Math.max(1, Math.min(limit, MAX_LOG_LIMIT));
    const stdout = await run(cwd, [
      "log",
      `-n`,
      String(capped),
      "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e",
    ]);
    return parseLog(stdout);
  }

  async function stage(cwd: string, rawPaths: string[], unstage: boolean): Promise<void> {
    await assertTrusted(cwd);
    const paths = rawPaths.map((p) => rootPathspec(p));
    if (paths.length === 0) return;
    if (unstage) {
      try {
        await run(cwd, ["reset", "-q", "HEAD", "--", ...paths]);
      } catch (error) {
        // 还没有任何提交时 HEAD 不存在,`git reset HEAD` 会报
        // "ambiguous argument 'HEAD'" —— 那时改用 `git rm --cached`
        // (移出索引但保留工作区文件)。
        if (!/ambiguous argument 'HEAD'|unknown revision or path not in the working tree/i.test(
          error instanceof Error ? error.message : String(error),
        )) {
          throw error;
        }
        await run(cwd, ["rm", "--cached", "-q", "--", ...paths]);
      }
    } else {
      // 注意 git add 没有 -q 开关(quiet 是 reset/rm 的)。
      await run(cwd, ["add", "--", ...paths]);
    }
  }

  async function commit(cwd: string, message: string, rawPaths?: string[]): Promise<{ hash: string }> {
    await assertTrusted(cwd);
    const trimmed = message.trim();
    if (!trimmed) throw new Error("git: commit message is required");
    if (trimmed.length > MAX_COMMIT_MESSAGE) {
      throw new Error(`git: commit message too long (max ${MAX_COMMIT_MESSAGE})`);
    }
    if (rawPaths && rawPaths.length > 0) {
      if (rawPaths.length > MAX_PATHS) {
        throw new Error(`git: too many paths (max ${MAX_PATHS})`);
      }
      const paths = rawPaths.map((p) => rootPathspec(p));
      await run(cwd, ["add", "--", ...paths]);
    }
    await run(cwd, ["commit", "-m", trimmed]);
    const head = await run(cwd, ["rev-parse", "--short", "HEAD"]);
    return { hash: head.trim() };
  }

  return { assertTrusted, status, diff, log, stage, commit };
}

export type GitService = ReturnType<typeof createGitService>;

export function registerGitPanelIpc(options: {
  getTrustedRoot: () => string | null;
  isTrustedCwd: (cwd: string) => Promise<boolean>;
}): void {
  const git = createGitService(options);

  wrapIpcHandler("git:status", async (_e, args: unknown) => {
    const input = recordValue(args ?? {}, "git:status payload");
    const cwd = requiredString(input.cwd, "cwd");
    return git.status(cwd);
  });

  wrapIpcHandler("git:diff", async (_e, args: unknown) => {
    const input = recordValue(args ?? {}, "git:diff payload");
    const cwd = requiredString(input.cwd, "cwd");
    const path = requiredString(input.path, "path");
    const staged = input.staged === true;
    return { path, patch: await git.diff(cwd, path, staged) };
  });

  wrapIpcHandler("git:log", async (_e, args: unknown) => {
    const input = recordValue(args ?? {}, "git:log payload");
    const cwd = requiredString(input.cwd, "cwd");
    const limit = optionalFiniteInteger(input.limit, "limit", DEFAULT_LOG_LIMIT, 1, MAX_LOG_LIMIT);
    return { commits: await git.log(cwd, limit) };
  });

  wrapIpcHandler("git:stage", async (_e, args: unknown) => {
    const input = recordValue(args ?? {}, "git:stage payload");
    const cwd = requiredString(input.cwd, "cwd");
    const rawPaths = input.paths;
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
      throw new Error("git: paths is required");
    }
    if (rawPaths.length > MAX_PATHS) {
      throw new Error(`git: too many paths (max ${MAX_PATHS})`);
    }
    const paths = rawPaths.map((p) => requiredString(p, "paths[]"));
    const unstage = input.unstage === true;
    await git.stage(cwd, paths, unstage);
    return { ok: true };
  });

  wrapIpcHandler("git:commit", async (_e, args: unknown) => {
    const input = recordValue(args ?? {}, "git:commit payload");
    const cwd = requiredString(input.cwd, "cwd");
    const message = requiredString(input.message, "message");
    const rawPaths = Array.isArray(input.paths)
      ? input.paths.map((p) => requiredString(p, "paths[]"))
      : undefined;
    return git.commit(cwd, message, rawPaths);
  });
}
