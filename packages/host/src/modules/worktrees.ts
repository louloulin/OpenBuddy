import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { protocolError } from "@openbuddy/protocol/errors";
import { text } from "@openbuddy/services/settings/settings";
import type { Handler, HostContext, HostModule } from "../module.js";

const run = promisify(execFile);

/**
 * Git worktree (G4-5)：给代码任务一个隔离的工作树，不污染主工作区。
 *
 * 三个命令都只做 git 自己的事：列表读 `worktree list --porcelain`，创建是
 * `git worktree add -b <name>`，移除是 `git worktree remove`。不是 git 仓库时
 * 明确回答 `{ gitRepo: false }`，界面据此隐藏入口而不是给一个假按钮。
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

async function repoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 10_000 });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

interface WorktreeRow {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  main: boolean;
}

export function parseWorktreePorcelain(output: string): WorktreeRow[] {
  const rows: WorktreeRow[] = [];
  let current: WorktreeRow | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) rows.push(current);
      current = { path: line.slice("worktree ".length), bare: false, main: rows.length === 0 };
      continue;
    }
    if (!current) continue;
    if (line === "bare") current.bare = true;
    else if (line.startsWith("HEAD ")) current.head = line.slice(5);
    else if (line.startsWith("branch ")) current.branch = line.slice(7).replace(/^refs\/heads\//, "");
  }
  if (current) rows.push(current);
  return rows;
}

export function worktreeCommands(_ctx: HostContext): HostModule {
  const commands: Record<string, Handler> = {
    worktree_list: async (p) => {
      const cwd = text(p.cwd, "cwd");
      const root = await repoRoot(cwd);
      if (!root) return { gitRepo: false, worktrees: [] };
      const { stdout } = await run("git", ["-C", root, "worktree", "list", "--porcelain"], { timeout: 10_000 });
      return { gitRepo: true, root, worktrees: parseWorktreePorcelain(stdout) };
    },

    worktree_create: async (p) => {
      const cwd = text(p.cwd, "cwd");
      const name = text(p.name, "name").trim();
      if (!NAME.test(name)) throw protocolError("invalid_payload", "工作树名字只能用字母、数字、点、下划线和短横线（40 字以内）");
      const root = await repoRoot(cwd);
      if (!root) throw protocolError("not_a_git_repo", "这个任务不在 git 仓库里，无法创建工作树");
      const target = join(root, ".openbuddy", "worktrees", name);
      try {
        await access(target);
        throw protocolError("already_exists", `工作树目录已存在：${target}`);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
      try {
        await run("git", ["-C", root, "worktree", "add", "-b", name, target], { timeout: 60_000 });
      } catch (error) {
        const message = String((error as { stderr?: string }).stderr ?? error);
        if (/already exists/i.test(message)) throw protocolError("branch_exists", `分支 ${name} 已存在，换个名字`);
        throw protocolError("invalid_payload", message.trim().slice(0, 400));
      }
      // 返回真实路径（macOS 上 /var → /private/var），与 `git worktree list` 的输出一致。
      const canonical = await realpath(target).catch(() => target);
      return { gitRepo: true, root, path: canonical, branch: name };
    },

    worktree_remove: async (p) => {
      const cwd = text(p.cwd, "cwd");
      const path = text(p.path, "path");
      const root = await repoRoot(cwd);
      if (!root) throw protocolError("not_a_git_repo", "这个任务不在 git 仓库里");
      const { stdout } = await run("git", ["-C", root, "worktree", "list", "--porcelain"], { timeout: 10_000 });
      // 两侧都取真实路径再比：git 报的是规范化后的路径，界面可能拿到 /var 形式。
      const wanted = await realpath(path).catch(() => path);
      const row = parseWorktreePorcelain(stdout).find((item) => item.path === path || item.path === wanted);
      if (!row) throw protocolError("not_found", "这不是这个仓库的工作树");
      if (row.main) throw protocolError("worktree_main", "主工作区不能这样移除");
      await run("git", ["-C", root, "worktree", "remove", "--force", row.path], { timeout: 60_000 });
      return { removed: row.path };
    },
  };
  return { id: "worktrees", commands };
}
