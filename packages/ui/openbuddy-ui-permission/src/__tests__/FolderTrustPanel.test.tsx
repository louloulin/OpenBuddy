// @vitest-environment jsdom
/**
 * FolderTrustPanel 核心契约测试 (P1.2 三件套之 3)
 *
 * 覆盖:
 *   - 渲染契约(stats、表格、状态徽标)
 *   - 授权/撤销(grant/revoke)
 *   - 添加文件夹 + 绝对路径校验(空、相对路径)
 *   - loading 状态、只读模式(无 callback)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { FolderTrustPanel } from "../FolderTrustPanel.js";
import type { FolderTrustPanelProps } from "../types.js";

const baseProps: FolderTrustPanelProps = {
  entries: [
    { cwd: "/Users/me/projects", trusted: true, decidedAt: "2026-09-20" },
    { cwd: "/Users/me/downloads", trusted: false },
  ],
  onGrant: vi.fn(async () => undefined),
  onRevoke: vi.fn(async () => undefined),
  onAdd: vi.fn(async () => undefined),
};

describe("FolderTrustPanel — 渲染契约", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("渲染 stats、表格、状态徽标", () => {
    render(<FolderTrustPanel {...baseProps} />);
    expect(screen.getByTestId("folder-trust-panel")).toBeInTheDocument();
    expect(screen.getByTestId("folder-trust-stats")).toHaveTextContent(
      "共 2 个 · 已信任 1 · 未信任 1",
    );
    expect(screen.getByTestId("folder-trust-table")).toBeInTheDocument();
    expect(screen.getByTestId("folder-trust-status-0")).toHaveTextContent("✓ 已信任");
    expect(screen.getByTestId("folder-trust-status-1")).toHaveTextContent("✗ 未信任");
  });

  it("空 entries 时显示「暂无记录」占位", () => {
    render(<FolderTrustPanel {...baseProps} entries={[]} />);
    expect(screen.getByText("暂无记录")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-trust-table")).not.toBeInTheDocument();
  });

  it("loading=true 时显示加载文案,隐藏表格", () => {
    render(<FolderTrustPanel {...baseProps} loading={true} />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-trust-table")).not.toBeInTheDocument();
  });

  it("stats 数字全为 0 时仍正确渲染", () => {
    render(<FolderTrustPanel {...baseProps} entries={[]} />);
    expect(screen.getByTestId("folder-trust-stats")).toHaveTextContent(
      "共 0 个 · 已信任 0 · 未信任 0",
    );
  });
});

describe("FolderTrustPanel — 授权 / 撤销", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("trusted=false 的行显示「授权」按钮,点击触发 onGrant(cwd)", async () => {
    const onGrant = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onGrant={onGrant} />);
    fireEvent.click(screen.getByTestId("folder-trust-grant-1"));
    await waitFor(() => expect(onGrant).toHaveBeenCalledTimes(1));
    expect(onGrant).toHaveBeenCalledWith("/Users/me/downloads");
  });

  it("trusted=true 的行显示「撤销」按钮,点击触发 onRevoke(cwd)", async () => {
    const onRevoke = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onRevoke={onRevoke} />);
    fireEvent.click(screen.getByTestId("folder-trust-revoke-0"));
    await waitFor(() => expect(onRevoke).toHaveBeenCalledTimes(1));
    expect(onRevoke).toHaveBeenCalledWith("/Users/me/projects");
  });

  it("同一行只显示「授权」或「撤销」之一,不同时显示", () => {
    render(<FolderTrustPanel {...baseProps} />);
    // row 0 (trusted=true) 只有 revoke,无 grant
    expect(screen.getByTestId("folder-trust-revoke-0")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-trust-grant-0")).not.toBeInTheDocument();
    // row 1 (trusted=false) 只有 grant,无 revoke
    expect(screen.getByTestId("folder-trust-grant-1")).toBeInTheDocument();
    expect(screen.queryByTestId("folder-trust-revoke-1")).not.toBeInTheDocument();
  });
});

describe("FolderTrustPanel — 添加文件夹 + 校验", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("输入合法绝对路径(/开头) + 点添加 → onAdd 触发,表单清空", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "/Users/me/new-project" },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith("/Users/me/new-project");
    // 表单清空
    expect((screen.getByTestId("folder-trust-add-input") as HTMLInputElement).value).toBe("");
  });

  it("Windows 盘符路径(C:\\) 也接受为绝对路径", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "C:\\Users\\me\\project" },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith("C:\\Users\\me\\project");
  });

  it("空输入时按钮 disabled,点击不会触发错误或回调", () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    // 按钮在空输入时 disabled → 校验路径在 UI 上不可达(仅做防御性编程)
    const btn = screen.getByTestId("folder-trust-add-submit");
    expect(btn).toBeDisabled();
    // 即使强制 fireEvent.click,jsdom 不会自动跳过 disabled,直接调用 onClick 也不会执行
    fireEvent.click(btn);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByTestId("folder-trust-error")).not.toBeInTheDocument();
  });

  it("输入相对路径 → 显示「必须是绝对路径」错误,不调用 onAdd", () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "projects/foo" },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    expect(screen.getByTestId("folder-trust-error")).toHaveTextContent(
      "必须是绝对路径(以 / 或盘符开头)",
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("输入含前后空白的路径 → 自动 trim 后调用 onAdd", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "  /Users/me/trim  " },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith("/Users/me/trim");
  });

  it("重新输入合法路径后,先前的错误消失", async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<FolderTrustPanel {...baseProps} onAdd={onAdd} />);
    // 第一次:相对路径 → 错误
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "relative/path" },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    expect(screen.getByTestId("folder-trust-error")).toBeInTheDocument();
    // 第二次:修正为绝对路径
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "/abs/path" },
    });
    fireEvent.click(screen.getByTestId("folder-trust-add-submit"));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    // 错误被清空
    expect(screen.queryByTestId("folder-trust-error")).not.toBeInTheDocument();
  });

  it("添加按钮在 input 为空时 disabled", () => {
    render(<FolderTrustPanel {...baseProps} />);
    expect(screen.getByTestId("folder-trust-add-submit")).toBeDisabled();
    fireEvent.change(screen.getByTestId("folder-trust-add-input"), {
      target: { value: "/x" },
    });
    expect(screen.getByTestId("folder-trust-add-submit")).not.toBeDisabled();
  });
});

describe("FolderTrustPanel — 只读模式(无 callback)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("无 onAdd 时不渲染添加表单", () => {
    render(
      <FolderTrustPanel
        entries={baseProps.entries}
        onGrant={vi.fn(async () => undefined)}
        onRevoke={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.queryByTestId("folder-trust-add-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("folder-trust-add-submit")).not.toBeInTheDocument();
  });

  it("无 onGrant 时未信任行不显示授权按钮", () => {
    render(
      <FolderTrustPanel
        entries={[{ cwd: "/x", trusted: false }]}
        onRevoke={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.queryByTestId("folder-trust-grant-0")).not.toBeInTheDocument();
  });

  it("无 onRevoke 时已信任行不显示撤销按钮", () => {
    render(
      <FolderTrustPanel
        entries={[{ cwd: "/x", trusted: true }]}
        onGrant={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.queryByTestId("folder-trust-revoke-0")).not.toBeInTheDocument();
  });
});
