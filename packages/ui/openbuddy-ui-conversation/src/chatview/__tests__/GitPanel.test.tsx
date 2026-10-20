/**
 * GitPanel —— git 面板(状态分区 / 暂存 / 提交 / diff)的交互契约。
 *
 * 锁四件事:① 非 git 仓库给明确降级而不是异常;② 三段列表按 porcelain
 * 状态分桶;③ 提交必须先有已暂存改动与提交信息;④ diff 视图未暂存为空时
 * 回退到已暂存 diff。
 *
 * git 状态由面板层(useGitStatus)拉取后经 props 下发 —— 这里直接构造 props,
 * 不再 mock 状态拉取本身。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitDiffView, GitSection } from "../GitPanel";
import type { GitStatusState } from "../use-git-status";

const invokeMock = vi.fn();
vi.mock("@/lib/platform/electron-api", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      `${key}${params ? JSON.stringify(params) : ""}`,
  }),
}));

const CWD = "/repo";

const status: GitStatusState = {
  isRepo: true,
  branch: "main",
  entries: [
    { x: "M", y: " ", path: "src/staged.ts" },
    { x: " ", y: "M", path: "src/unstaged.ts" },
    { x: "?", y: "?", path: "src/untracked.ts" },
  ],
};

function gitProps(overrides: {
  status?: GitStatusState | null;
  loading?: boolean;
  error?: string | null;
} = {}) {
  return {
    status: "status" in overrides ? overrides.status! : status,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    onReload: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (channel: string) => {
    if (channel === "git:log") return { commits: [] };
    if (channel === "git:diff") return { patch: "" };
    if (channel === "git:stage" || channel === "git:commit") return { ok: true, hash: "abc1234" };
    return {};
  });
});

describe("GitSection", () => {
  it("没有 cwd 时不渲染", () => {
    const { container } = render(<GitSection onSelect={() => {}} {...gitProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it("非 git 仓库 → 明确降级文案", () => {
    render(
      <GitSection
        cwd={CWD}
        onSelect={() => {}}
        {...gitProps({ status: { isRepo: false, branch: "", entries: [] } })}
      />,
    );
    expect(screen.getByText("git.notRepo")).toBeTruthy();
  });

  it("读取状态失败 → 显示错误而不是崩溃", () => {
    render(
      <GitSection
        cwd={CWD}
        onSelect={() => {}}
        {...gitProps({ error: "git: cwd is not a trusted workspace" })}
      />,
    );
    expect(screen.getByText(/git\.loadFailed/)).toBeTruthy();
  });

  it("加载中显示 loading 文案", () => {
    render(<GitSection cwd={CWD} onSelect={() => {}} {...gitProps({ status: null, loading: true })} />);
    expect(screen.getByText("git.loading")).toBeTruthy();
  });

  it("三段列表按状态分桶", () => {
    render(<GitSection cwd={CWD} onSelect={() => {}} {...gitProps()} />);
    expect(screen.getByText("src/staged.ts")).toBeTruthy();
    expect(screen.getByText("src/unstaged.ts")).toBeTruthy();
    expect(screen.getByText("src/untracked.ts")).toBeTruthy();
    expect(screen.getByText("git.staged")).toBeTruthy();
    expect(screen.getByText("git.unstaged")).toBeTruthy();
    expect(screen.getByText("git.untracked")).toBeTruthy();
  });

  it("点击文件回传路径", () => {
    const onSelect = vi.fn();
    render(<GitSection cwd={CWD} onSelect={onSelect} {...gitProps()} />);
    fireEvent.click(screen.getByText("src/staged.ts"));
    expect(onSelect).toHaveBeenCalledWith("src/staged.ts");
  });

  it("暂存按钮走 git:stage,完成后刷新状态", async () => {
    const onReload = vi.fn(async () => {});
    render(
      <GitSection
        cwd={CWD}
        onSelect={() => {}}
        status={status}
        loading={false}
        error={null}
        onReload={onReload}
      />,
    );
    const stageButtons = screen.getAllByTitle("git.stage");
    fireEvent.click(stageButtons[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("git:stage", {
        cwd: CWD,
        paths: ["src/unstaged.ts"],
        unstage: false,
      }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalled());
  });

  it("已暂存文件的取消暂存走 unstage: true", async () => {
    render(<GitSection cwd={CWD} onSelect={() => {}} {...gitProps()} />);
    fireEvent.click(screen.getAllByTitle("git.unstage")[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("git:stage", {
        cwd: CWD,
        paths: ["src/staged.ts"],
        unstage: true,
      }),
    );
  });

  it("没有已暂存改动时提交按钮禁用", () => {
    render(
      <GitSection
        cwd={CWD}
        onSelect={() => {}}
        {...gitProps({ status: { isRepo: true, branch: "main", entries: [] } })}
      />,
    );
    expect(screen.getByText("git.noStaged")).toBeTruthy();
    const commit = screen.getByRole("button", { name: "git.commit" }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
  });

  it("填写提交信息后提交走 git:commit,成功后清空输入并刷新", async () => {
    const onReload = vi.fn(async () => {});
    const onToast = vi.fn();
    render(
      <GitSection
        cwd={CWD}
        onSelect={() => {}}
        status={status}
        loading={false}
        error={null}
        onReload={onReload}
        onToast={onToast}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("git.commitPlaceholder"), {
      target: { value: "feat: git 面板" },
    });
    fireEvent.click(screen.getByRole("button", { name: "git.commit" }));
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("git:commit", {
        cwd: CWD,
        message: "feat: git 面板",
      }),
    );
    await waitFor(() => {
      expect(onReload).toHaveBeenCalled();
      expect(onToast).toHaveBeenCalledWith(expect.stringContaining("git.commitOk"));
    });
  });
});

describe("GitDiffView", () => {
  it("优先展示未暂存 diff", async () => {
    invokeMock.mockImplementation(async (channel: string, args: { staged: boolean }) => {
      if (channel === "git:diff") {
        return { patch: args.staged ? "staged-patch" : "unstaged-patch" };
      }
      return {};
    });
    render(<GitDiffView path="src/a.ts" cwd={CWD} />);
    await waitFor(() => expect(screen.getByText("unstaged-patch")).toBeTruthy());
    expect(screen.queryByText("staged-patch")).toBeNull();
  });

  it("未暂存为空时回退到已暂存 diff", async () => {
    invokeMock.mockImplementation(async (channel: string, args: { staged: boolean }) => {
      if (channel === "git:diff") return { patch: args.staged ? "staged-patch" : "" };
      return {};
    });
    render(<GitDiffView path="src/a.ts" cwd={CWD} />);
    await waitFor(() => expect(screen.getByText("staged-patch")).toBeTruthy());
  });

  it("两者都空 → 提示无差异", async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === "git:diff") return { patch: "" };
      return {};
    });
    render(<GitDiffView path="src/a.ts" cwd={CWD} />);
    await waitFor(() => expect(screen.getByText("git.noDiff")).toBeTruthy());
  });
});
