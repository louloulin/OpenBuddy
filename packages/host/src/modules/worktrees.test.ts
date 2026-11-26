import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseWorktreePorcelain, worktreeCommands } from "./worktrees.js";

const run = promisify(execFile);
const call = async (command: string, payload: Record<string, unknown>) => {
  const module = worktreeCommands({} as never);
  return module.commands[command](payload) as Promise<unknown>;
};

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "ob-worktree-"));
  await run("git", ["init", "-q", repo]);
  await run("git", ["-C", repo, "config", "user.email", "t@example.com"]);
  await run("git", ["-C", repo, "config", "user.name", "t"]);
  await writeFile(join(repo, "a.txt"), "one\n");
  await run("git", ["-C", repo, "add", "a.txt"]);
  await run("git", ["-C", repo, "commit", "-qm", "init"]);
});
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("git worktree (G4-5)", () => {
  it("parses porcelain rows, marking the first as the main worktree", () => {
    const rows = parseWorktreePorcelain(
      [
        "worktree /repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repo/.openbuddy/worktrees/feat",
        "HEAD def456",
        "branch refs/heads/feat",
        "",
      ].join("\n"),
    );
    expect(rows).toEqual([
      { path: "/repo", head: "abc123", branch: "main", bare: false, main: true },
      { path: "/repo/.openbuddy/worktrees/feat", head: "def456", branch: "feat", bare: false, main: false },
    ]);
  });

  it("creates, lists and removes a real worktree; rejects bad names and non-repos", async () => {
    const created = (await call("worktree_create", { cwd: repo, name: "feat-login" })) as { path: string };
    expect(existsSync(created.path)).toBe(true);
    expect(created.path.endsWith(join(".openbuddy", "worktrees", "feat-login"))).toBe(true);

    const listed = (await call("worktree_list", { cwd: repo })) as {
      gitRepo: boolean;
      worktrees: Array<{ path: string; main: boolean }>;
    };
    expect(listed.gitRepo).toBe(true);
    expect(listed.worktrees.map((row) => row.main)).toEqual([true, false]);
    expect(listed.worktrees[1].path).toBe(created.path);

    await expect(call("worktree_create", { cwd: repo, name: "--bad" })).rejects.toThrow();
    await expect(call("worktree_create", { cwd: repo, name: "feat-login" })).rejects.toThrow();

    await call("worktree_remove", { cwd: repo, path: created.path });
    expect(existsSync(created.path)).toBe(false);
    await expect(call("worktree_remove", { cwd: repo, path: repo })).rejects.toThrow("主工作区");

    const outside = await mkdtemp(join(tmpdir(), "ob-plain-"));
    try {
      expect(await call("worktree_list", { cwd: outside })).toEqual({ gitRepo: false, worktrees: [] });
      await expect(call("worktree_create", { cwd: outside, name: "x" })).rejects.toThrow("不在 git 仓库");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
