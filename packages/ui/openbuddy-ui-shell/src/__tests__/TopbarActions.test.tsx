import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui-theme/client";

vi.mock("@/lib/platform/electron-api", () => ({ save: vi.fn(async () => null) }));
vi.mock("@/lib/agent/pi-client", () => ({
  exportTextFile: vi.fn(async () => undefined),
  piSetSessionPinned: vi.fn(async () => undefined),
  piSetSessionArchived: vi.fn(async () => undefined),
}));
vi.mock("@/lib/files/export-markdown", () => ({
  buildSessionMarkdown: vi.fn(() => "# export"),
  sanitizeFilename: vi.fn((s: string) => s),
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ messages: [] }) },
}));

import { TopbarActions } from "../TopbarActions";
import { TopbarStatusChip } from "../TopbarStatusChip";

function open() {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
}

describe("TopbarActions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("向后兼容:默认仍是三行动作 + 触发按钮", () => {
    render(<TopbarActions sessionId="s-1" title="项目复盘" />);
    open();
    expect(screen.getByText("导出为 Markdown")).toBeInTheDocument();
    expect(screen.getByText("置顶会话")).toBeInTheDocument();
    expect(screen.getByText("归档会话")).toBeInTheDocument();
    expect(screen.queryByTestId("topbar-actions-theme")).toBeNull();
    expect(screen.queryByTestId("topbar-actions-shortcuts")).toBeNull();
  });

  it("每行右侧渲染快捷键 glyph", () => {
    render(<TopbarActions sessionId="s-1" title="项目复盘" />);
    open();
    // jsdom 判定为非 mac,mod → Ctrl、shift → Shift。
    expect(screen.getByLabelText("快捷键 Ctrl Shift E")).toBeInTheDocument();
    expect(screen.getByLabelText("快捷键 Ctrl Shift P")).toBeInTheDocument();
    expect(screen.getByLabelText("快捷键 Ctrl Shift A")).toBeInTheDocument();
  });

  it("pinned 时行文案切换", () => {
    render(<TopbarActions sessionId="s-1" title="项目复盘" pinned />);
    open();
    expect(screen.getByText("取消置顶")).toBeInTheDocument();
  });

  it("pending 会话禁用置顶 / 归档并提示", () => {
    const onToast = vi.fn();
    render(<TopbarActions sessionId="__pending_x" title="新会话" onToast={onToast} />);
    open();
    expect(screen.getByText("置顶会话").closest("button")).toBeDisabled();
    expect(screen.getByText("归档会话").closest("button")).toBeDisabled();
  });

  it("statusChip 内联在菜单按钮旁", () => {
    render(
      <TopbarActions
        sessionId="s-1"
        title="项目复盘"
        statusChip={<TopbarStatusChip tone="working" label="生成中" />}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("生成中");
    expect(screen.getByRole("button", { name: "更多操作" })).toBeInTheDocument();
  });

  it("themeMenu 打开后新增主题行,点击循环到下一套主题", () => {
    render(
      <ThemeProvider>
        <TopbarActions sessionId="s-1" title="项目复盘" themeMenu />
      </ThemeProvider>,
    );
    open();
    const row = screen.getByTestId("topbar-actions-theme");
    expect(row).toHaveTextContent("切换主题");
    fireEvent.click(row);
    // 默认主题已切到品牌色 openbuddy / openbuddy-dark (R10),不再是 sakura。
    // jsdom 默认 colorScheme=dark,所以 ThemeProvider 起始就是 openbuddy-dark。
    expect(window.localStorage.getItem("openbuddy.theme.name")).toBe("openbuddy-dark");
    expect(screen.getByTestId("topbar-actions-theme")).toHaveTextContent("openbuddy-dark");
  });

  it("themeMenu 开启但宿主没挂 ThemeProvider 时降级成禁用行", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<TopbarActions sessionId="s-1" title="项目复盘" themeMenu />);
      open();
      expect(screen.getByText("主题不可用")).toBeInTheDocument();
      expect(screen.queryByTestId("topbar-actions-theme")).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("themeMenu 未开启时不渲染主题行(也就不会要求 ThemeProvider)", () => {
    render(<TopbarActions sessionId="s-1" title="项目复盘" />);
    open();
    expect(screen.queryByTestId("topbar-actions-theme")).toBeNull();
  });

  it("onShowShortcuts 提供时渲染快捷键行并回调", () => {
    const onShowShortcuts = vi.fn();
    render(<TopbarActions sessionId="s-1" title="项目复盘" onShowShortcuts={onShowShortcuts} />);
    open();
    const row = screen.getByTestId("topbar-actions-shortcuts");
    expect(row).toHaveTextContent("键盘快捷键");
    fireEvent.click(row);
    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
    // 点击后菜单收起。
    expect(screen.queryByTestId("topbar-actions-shortcuts")).toBeNull();
  });
});
