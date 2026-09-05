import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { Composer } from "@openbuddy/ui-conversation";

const base = { streaming: false, onSend: vi.fn(), onCancel: vi.fn() };

describe("Composer", () => {
  it("输入后 Enter 发送", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "你好 pi" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("你好 pi");
  });

  it("原生 paste 事件保留中文、多行文本并同步受控草稿", () => {
    const onDraftChange = vi.fn();
    render(<Composer {...base} onDraftChange={onDraftChange} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "前后" } });
    input.selectionStart = 1;
    input.selectionEnd = 1;
    fireEvent.paste(input, {
      clipboardData: { getData: () => "中文\n多行" },
    });
    expect(input.value).toBe("前中文\n多行后");
    expect(onDraftChange).toHaveBeenLastCalledWith("前中文\n多行后");
  });

  it("Electron paste 优先读取系统剪贴板，保留大文本完整内容", async () => {
    const clipboardText = `${"中文大文本-".repeat(2048)}\nEND-OF-LARGE-PASTE`;
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { clipboard: { readText: vi.fn().mockResolvedValue(clipboardText) } },
    });
    render(<Composer {...base} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.paste(input, { clipboardData: { getData: () => "截断文本" } });
    await vi.waitFor(() => expect(input.value).toBe(clipboardText));
  });

  it("apiReady=false 时输入禁用并显示配置提示,点击触发 onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    render(<Composer {...base} apiReady={false} onOpenSettings={onOpenSettings} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    fireEvent.click(screen.getByText(/请先配置 API Key/));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("配置提示是真实按钮,Enter 也能打开设置", async () => {
    const onOpenSettings = vi.fn();
    render(<Composer {...base} apiReady={false} onOpenSettings={onOpenSettings} />);
    const hint = screen.getByRole("button", { name: /请先配置 API Key/ });
    hint.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("showMeta 时渲染权限模式选择器（PermissionPicker）", () => {
    // PermissionPicker 对应 pi 的 [ui] permission_mode,
    // 默认 default → 触发器显示「始终询问」。
    render(<Composer {...base} showMeta onPlaceholder={vi.fn()} />);
    expect(screen.getByText("始终询问")).toBeInTheDocument();
  });

  it("未传 workspaces 时选择工作空间 fallback 触发 onPlaceholder", () => {
    // When workspaces/onSelectWorkspace are absent, the workspace button falls
    // back to onPlaceholder("选择工作空间").
    const onPlaceholder = vi.fn();
    render(<Composer {...base} showMeta onPlaceholder={onPlaceholder} />);
    fireEvent.click(screen.getByText("选择工作空间"));
    expect(onPlaceholder).toHaveBeenCalledWith("选择工作空间");
  });

  it("streaming 时显示停止按钮", () => {
    const onCancel = vi.fn();
    render(<Composer {...base} streaming onCancel={onCancel} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancel).toHaveBeenCalled();
  });

  // ---------- 按会话持久化草稿 ----------
  it("draft + draftKey 初始回填草稿内容", () => {
    render(
      <Composer
        {...base}
        draft="北京天气怎么样"
        draftKey="s1"
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "北京天气怎么样",
    );
  });

  it("draftKey 变化时回填新草稿(切会话场景)", () => {
    const { rerender } = render(
      <Composer {...base} draft="会话A草稿" draftKey="s1" />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "会话A草稿",
    );
    rerender(<Composer {...base} draft="会话B草稿" draftKey="s2" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "会话B草稿",
    );
  });

  it("用户输入触发 onDraftChange 并带上最新文本", () => {
    const onDraftChange = vi.fn();
    render(
      <Composer {...base} draft="" draftKey="s1" onDraftChange={onDraftChange} />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "你好" },
    });
    expect(onDraftChange).toHaveBeenCalledWith("你好");
  });
  it("StrictMode 下用户输入只触发一次 onDraftChange:updateText 的 setText updater 必须保持纯函数", () => {
    // 背景:Composer 之前把 onDraftChange?.(value) 放在 React 的 setText
    // updater 里调用。updater 既是组件 render 阶段被调用的(引发
    // "Cannot update a component (HomePage) while rendering (Composer)"
    // ——suscriber 走 sessions-store.ts:134 的 setDraft),StrictMode 还会故意
    // 把 updater 调用两次,导致用户每敲一个字 onDraftChange 都被触发两次。
    // 改完后 updater 保持纯函数,onDraftChange 在外面触发。
    const onDraftChange = vi.fn();
    render(
      <StrictMode>
        <Composer {...base} draft="" draftKey="s1" onDraftChange={onDraftChange} />
      </StrictMode>,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "你好" },
    });
    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onDraftChange).toHaveBeenCalledWith("你好");
  });

  it("草稿回填(draftKey 变化)不触发 onDraftChange(避免把恢复内容当用户输入回写)", () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <Composer {...base} draft="" draftKey="s1" onDraftChange={onDraftChange} />,
    );
    onDraftChange.mockClear();
    rerender(
      <Composer {...base} draft="恢复出来的字" draftKey="s2" onDraftChange={onDraftChange} />,
    );
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("Pi 扩展 UI setEditorText 回填输入框并触发草稿同步", () => {
    const onDraftChange = vi.fn();
    const { rerender } = render(
      <Composer {...base} onDraftChange={onDraftChange} extensionTextNonce={0} extensionText="" />,
    );
    onDraftChange.mockClear();
    rerender(
      <Composer {...base} onDraftChange={onDraftChange} extensionTextNonce={1} extensionText="来自 Pi 扩展" />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("来自 Pi 扩展");
    expect(onDraftChange).toHaveBeenLastCalledWith("来自 Pi 扩展");
  });

  it("发送后清空草稿(onDraftChange 收到空串)", () => {
    const onDraftChange = vi.fn();
    render(
      <Composer {...base} draft="待发送" draftKey="s1" onDraftChange={onDraftChange} />,
    );
    onDraftChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });

  // ---------- 消息队列:流式时入队 ----------
  it("streaming + onEnqueue 时显示入队按钮,点击触发 onEnqueue 并清空输入", () => {
    const onEnqueue = vi.fn();
    const onDraftChange = vi.fn();
    render(
      <Composer
        {...base}
        streaming
        onEnqueue={onEnqueue}
        draft="排队中"
        draftKey="s1"
        onDraftChange={onDraftChange}
      />,
    );
    // 入队按钮可访问名 = "加入待发送队列"。
    const btn = screen.getByRole("button", { name: "加入待发送队列" });
    fireEvent.click(btn);
    expect(onEnqueue).toHaveBeenCalledWith("排队中");
    expect(onDraftChange).toHaveBeenLastCalledWith("");
  });

  it("streaming 但文本为空时不渲染入队按钮", () => {
    render(
      <Composer {...base} streaming onEnqueue={vi.fn()} draft="" draftKey="s1" />,
    );
    expect(screen.queryByRole("button", { name: "加入待发送队列" })).toBeNull();
    // 停止按钮仍在。
    expect(screen.getByRole("button", { name: "停止生成" })).toBeInTheDocument();
  });

  it("未传 onEnqueue 时 streaming 不渲染入队按钮(保持原行为)", () => {
    render(<Composer {...base} streaming draft="x" draftKey="s1" />);
    expect(screen.queryByRole("button", { name: "加入待发送队列" })).toBeNull();
  });

  // ---------- 输入历史(arrow-key recall)----------
  it("发送后按 ↑ 召回上一条历史,按 ↓ 回到输入框", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    // 发送一条。
    fireEvent.change(input, { target: { value: "第一条" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(onSend).toHaveBeenCalledWith("第一条");
    // 输入框已清空;按 ↑ 召回「第一条」。
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("第一条");
    // 按 ↓ 回到输入框(空)。
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("多次发送后 ↑ 连续上翻历史", () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    // ↑ → b(最新),再 ↑ → a。
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("b");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("a");
  });
});
