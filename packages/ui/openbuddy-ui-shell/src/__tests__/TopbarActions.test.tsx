import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui-theme/client";

vi.mock("@/lib/platform/electron-api", () => ({ save: vi.fn(async () => null) }));
vi.mock("@/lib/agent/pi-client", () => ({
  exportTextFile: vi.fn(async () => undefined),
  piSetSessionPinned: vi.fn(async () => undefined),
  piSetSessionArchived: vi.fn(async () => undefined),
  collaborationOnUpdate: vi.fn(() => () => {}),
  calendarList: vi.fn(async () => []),
}));
vi.mock("@/lib/agent/assistant-facade", () => ({
  assistantFacade: {
    snapshot: vi.fn(async () => ({ rooms: [], events: [], pending: [] })),
    onUpdate: vi.fn(() => () => {}),
    propose: vi.fn(async () => ({ taskId: "x" })),
    execute: vi.fn(async () => ({})),
  },
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

// === R71 — 「📝 新草稿」入口 =====================================================
// 通过 SlotProvider 注入 editor.draft 默认实现,验证 TopbarActions 真能消费 slot。

import { SlotProvider, registerAllBuiltinUis } from "@openbuddy/ui-runtime/client";

function withDraftSlot(ui: React.ReactNode) {
  // 测试环境直接用 getRuntime() 拿单例,把 builtin 全装一遍再渲染。
  // 与生产一致:ui-editor apply() 注册了 editor.draft。
  registerAllBuiltinUis();
  return <SlotProvider>{ui}</SlotProvider>;
}

describe("R71 — editor.draft 槽位接入", () => {
  it("slot 装了 DraftEditor 后,菜单里出现「📝 新草稿」按钮", () => {
    render(withDraftSlot(<TopbarActions sessionId="s-1" title="项目复盘" />));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByTestId("topbar-draft-button")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-draft-button")).toHaveTextContent("新草稿");
  });

  it("点击「📝 新草稿」关菜单并打开草稿模态", async () => {
    render(withDraftSlot(<TopbarActions sessionId="s-1" title="项目复盘" onToast={vi.fn()} />));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByTestId("topbar-draft-button"));
    // 菜单已关 + DraftEditor 模态已挂(ProseMirror 实例存在)
    expect(screen.queryByTestId("topbar-draft-button")).toBeNull();
    expect(document.querySelector(".ProseMirror")).toBeTruthy();
  });

  // R72 — 键盘快捷键 Mod+Shift+D 真正打开/关闭草稿模态
  it("按 Mod+Shift+D 在 editor.draft 装好后切换草稿模态", async () => {
    render(withDraftSlot(<TopbarActions sessionId="s-1" title="项目复盘" />));
    // 第一次按下:打开草稿(ProseMirror 挂出)。setState 后 ProseMirror 异步挂出。
    fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeTruthy());
    // 第二次按下:关闭草稿(ProseMirror 卸下)
    fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(document.querySelector(".ProseMirror")).toBeNull());
  });

  it("editor.draft 未注册时,Mod+Shift+D 不报错也无副作用", () => {
    // 不包 SlotProvider → 没有 builtin 注册 → editor.draft 空 → 绑定成 no-op。
    render(<TopbarActions sessionId="s-1" title="项目复盘" />);
    expect(() => {
      fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    }).not.toThrow();
    expect(document.querySelector(".ProseMirror")).toBeNull();
  });

  it("菜单里「📝 新草稿」右侧显示快捷键 glyph(Ctrl+Shift+D / ⌘+Shift+D)", () => {
    render(withDraftSlot(<TopbarActions sessionId="s-1" title="项目复盘" />));
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByTestId("topbar-draft-button")).toHaveTextContent(/新草稿/);
    // 平台无关 chord 经过 ShortcutHint 渲染成带图标的 span,只看 label 即可。
    expect(screen.getByLabelText(/快捷键.*Shift.*D/)).toBeInTheDocument();
  });
});
