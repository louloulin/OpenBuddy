/**
 * git 面板 IPC 单测 —— 纯解析 + 信任门 + 路径安全。
 *
 * 覆盖三类高风险点:
 *   1. porcelain 解析(暂存/未暂存/未跟踪/重命名/分支);
 *   2. 信任门:未授权的 cwd 一律拒绝(folder-trust 未授权且不在 agentHost 根内);
 *   3. 路径安全:`../` 逃逸与 git 魔法 pathspec(`:(glob)`)必须被拒。
 */
import { describe, expect, it, vi } from "vitest";

import {
  createGitService,
  parseLog,
  parseStatusPorcelain,
  rootPathspec,
} from "../git-panel";

const CWD = "/tmp/openbuddy-git-panel";

function serviceWith(
  stdout: string,
  overrides: {
    isTrustedCwd?: (cwd: string) => Promise<boolean>;
    getTrustedRoot?: () => string | null;
  } = {},
) {
  const run = vi.fn(async (_cwd: string, _args: string[]) => ({ stdout }));
  const git = createGitService({
    deps: { run },
    isTrustedCwd: overrides.isTrustedCwd ?? (async () => true),
    getTrustedRoot: overrides.getTrustedRoot ?? (() => null),
  });
  return { git, run };
}

describe("parseStatusPorcelain", () => {
  it("解析分支 + 三种状态", () => {
    const result = parseStatusPorcelain(
      [
        "## main...origin/main [ahead 1]",
        "M  src/a.ts",
        " M src/b.ts",
        "?? src/c.ts",
      ].join("\n"),
    );
    expect(result.isRepo).toBe(true);
    expect(result.branch).toBe("main");
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toMatchObject({ x: "M", y: " ", path: "src/a.ts" });
    expect(result.entries[1]).toMatchObject({ x: " ", y: "M", path: "src/b.ts" });
    expect(result.entries[2]).toMatchObject({ x: "?", y: "?", path: "src/c.ts" });
  });

  it("重命名拆出原路径", () => {
    const result = parseStatusPorcelain("R  new.ts -> old.ts");
    expect(result.entries[0]).toMatchObject({ x: "R", path: "new.ts", origPath: "old.ts" });
  });

  it("空输出 = 干净工作区", () => {
    const result = parseStatusPorcelain("## main\n");
    expect(result.branch).toBe("main");
    expect(result.entries).toEqual([]);
  });
});

describe("parseLog", () => {
  it("解析记录并忽略空记录", () => {
    const stdout =
      "abc123\x1fabc12\x1ffeat: 提交面板\x1fAda\x1f2026-10-19T10:00:00+08:00\x1e" +
      "def456\x1fdef45\x1ffix: 修 bug\x1fAda\x1f2026-10-18T10:00:00+08:00\x1e";
    const entries = parseLog(stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ hash: "abc123", shortHash: "abc12", subject: "feat: 提交面板" });
    expect(entries[1].subject).toBe("fix: 修 bug");
  });
});

describe("rootPathspec", () => {
  it("锚定到仓库根(status 输出的路径是相对仓库根的)", () => {
    expect(rootPathspec("src/a.ts")).toBe(":/src/a.ts");
  });

  it("反斜杠归一", () => {
    expect(rootPathspec("src\\a.ts")).toBe(":/src/a.ts");
  });

  it("拒绝含 .. 段的路径", () => {
    expect(() => rootPathspec("src/../../etc/passwd")).toThrow(/escapes the repository/);
  });

  it("拒绝绝对路径", () => {
    expect(() => rootPathspec("/etc/passwd")).toThrow(/relative to the repository root/);
  });

  it("拒绝魔法前缀", () => {
    expect(() => rootPathspec(":(glob)*.ts")).toThrow(/magic pathspec/);
  });

  it("拒绝空路径", () => {
    expect(() => rootPathspec("")).toThrow(/empty pathspec/);
  });
});

describe("git 服务的信任门", () => {
  it("未授权的 cwd 抛错", async () => {
    const { git } = serviceWith("## main\n", {
      isTrustedCwd: async () => false,
      getTrustedRoot: () => null,
    });
    await expect(git.status(CWD)).rejects.toThrow(/not a trusted workspace/);
  });

  it("落在 agentHost 根内即视为可信(兜底)", async () => {
    const { git, run } = serviceWith("## main\n", {
      isTrustedCwd: async () => false,
      getTrustedRoot: () => "/tmp/openbuddy-git-panel",
    });
    const result = await git.status(CWD);
    expect(result.branch).toBe("main");
    expect(run).toHaveBeenCalled();
  });

  it("folder-trust 授权通过", async () => {
    const { git } = serviceWith("## main\n", { isTrustedCwd: async () => true });
    await expect(git.status(CWD)).resolves.toMatchObject({ isRepo: true });
  });
});

describe("git 服务的命令拼装", () => {
  it("status 走 porcelain 模式", async () => {
    const { git, run } = serviceWith("## main\n");
    await git.status(CWD);
    expect(run).toHaveBeenCalledWith(CWD, ["status", "--porcelain=v1", "-b"]);
  });

  it("非仓库目录返回 isRepo=false 而不是抛错", async () => {
    const run = vi.fn(async () => {
      throw new Error("fatal: not a git repository (or any of the parent directories): .git");
    });
    const git = createGitService({
      deps: { run },
      isTrustedCwd: async () => true,
      getTrustedRoot: () => null,
    });
    await expect(git.status(CWD)).resolves.toEqual({ isRepo: false, branch: "", entries: [] });
  });

  it("未跟踪文件用伪 diff(全 + 行,内容从仓库根读)", async () => {
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      if (args[0] === "status") return { stdout: "?? new.txt\n" };
      if (args[0] === "rev-parse") return { stdout: `${CWD}\n` };
      return { stdout: "" };
    });
    const git = createGitService({
      deps: { run },
      isTrustedCwd: async () => true,
      getTrustedRoot: () => null,
    });
    // 仓库里没有这个文件 → 内容读不到 → 空 diff(不抛错)。
    const patch = await git.diff(CWD, "new.txt", false);
    expect(patch).toBe("");
    expect(run).toHaveBeenCalledWith(CWD, ["rev-parse", "--show-toplevel"]);
  });

  it("已跟踪文件走 git diff(pathspec 锚在仓库根)", async () => {
    const { git, run } = serviceWith(" M src/a.ts\n");
    await git.diff(CWD, "src/a.ts", false);
    expect(run).toHaveBeenCalledWith(CWD, ["diff", "--no-color", "--", ":/src/a.ts"]);
  });

  it("staged diff 走 --cached", async () => {
    const { git, run } = serviceWith("M  src/a.ts\n");
    await git.diff(CWD, "src/a.ts", true);
    expect(run).toHaveBeenCalledWith(CWD, ["diff", "--no-color", "--cached", "--", ":/src/a.ts"]);
  });

  it("stage / unstage 的命令", async () => {
    const { git, run } = serviceWith("");
    await git.stage(CWD, ["src/a.ts"], false);
    expect(run).toHaveBeenCalledWith(CWD, ["add", "--", ":/src/a.ts"]);
    await git.stage(CWD, ["src/a.ts"], true);
    expect(run).toHaveBeenCalledWith(CWD, ["reset", "-q", "HEAD", "--", ":/src/a.ts"]);
  });

  it("还没有提交时取消暂存退回 git rm --cached", async () => {
    const run = vi.fn(async (_cwd: string, args: string[]) => {
      if (args[0] === "reset") throw new Error("fatal: ambiguous argument 'HEAD'");
      return { stdout: "" };
    });
    const git = createGitService({
      deps: { run },
      isTrustedCwd: async () => true,
      getTrustedRoot: () => null,
    });
    await git.stage(CWD, ["src/a.ts"], true);
    expect(run).toHaveBeenCalledWith(CWD, ["rm", "--cached", "-q", "--", ":/src/a.ts"]);
  });

  it("commit 先暂存指定文件再提交", async () => {
    const { git, run } = serviceWith("abc1234\n");
    const result = await git.commit(CWD, "feat: 提交面板", ["src/a.ts"]);
    expect(run).toHaveBeenCalledWith(CWD, ["add", "--", ":/src/a.ts"]);
    expect(run).toHaveBeenCalledWith(CWD, ["commit", "-m", "feat: 提交面板"]);
    expect(result.hash).toBe("abc1234");
  });

  it("空提交信息被拒", async () => {
    const { git } = serviceWith("");
    await expect(git.commit(CWD, "   ")).rejects.toThrow(/commit message is required/);
  });

  it("提交信息超长被拒", async () => {
    const { git } = serviceWith("");
    await expect(git.commit(CWD, "x".repeat(2001))).rejects.toThrow(/too long/);
  });

  it("提交时越界路径被拒(先于任何 git 调用)", async () => {
    const { git, run } = serviceWith("");
    await expect(git.commit(CWD, "msg", ["../escape.ts"])).rejects.toThrow(/escapes the repository/);
    expect(run).not.toHaveBeenCalled();
  });
});
