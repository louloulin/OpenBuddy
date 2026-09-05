/**
 * 拖拽文件落区集成测试 —— 对齐 WorkBuddy drop-zone。
 *
 * desktop `getCurrentWebview().onDragDropEvent` 在 vitest 下不存在,这里用一个
 * mock:捕获注册的 handler,测试代码手动派发 enter/drop/leave 事件,验证 Composer
 * 的附件集合与遮罩显示行为。
 */

// vi.mock 工厂被提升到文件顶部执行,引用的外部变量必须用 vi.hoisted 声明,
// 否则工厂里拿到的是 TDZ(未初始化)的 let。
const { dragState } = vi.hoisted(() => ({
  dragState: {
    handler: null as ((event: { payload: unknown }) => void) | null,
    unlisten: () => {},
  },
}));

vi.mock("@/lib/platform/electron-api", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (event: { payload: unknown }) => void) => {
      dragState.handler = cb;
      return Promise.resolve(dragState.unlisten);
    },
  }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Composer } from "@openbuddy/ui-conversation";

const base = { streaming: false, onSend: vi.fn(), onCancel: vi.fn() };

const emit = (payload: unknown) => {
  if (!dragState.handler) throw new Error("drag handler not registered");
  // 用 act 包裹,确保 React state 更新在断言前已刷新。
  act(() => {
    dragState.handler!({ payload });
  });
};

describe("Composer drop-zone", () => {
  beforeEach(() => {
    dragState.handler = null;
    dragState.unlisten = vi.fn();
  });

  it("enter 事件显示落区遮罩", async () => {
    render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({ type: "enter", paths: [], position: { x: 0, y: 0 } });
    expect(screen.getByText("松开以添加文件到对话")).toBeInTheDocument();
  });

  it("leave 事件隐藏遮罩", async () => {
    render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({ type: "enter", paths: [], position: { x: 0, y: 0 } });
    expect(screen.getByText("松开以添加文件到对话")).toBeInTheDocument();
    emit({ type: "leave" });
    expect(screen.queryByText("松开以添加文件到对话")).toBeNull();
  });

  it("drop 事件收集路径为附件并隐藏遮罩", async () => {
    render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({
      type: "drop",
      paths: ["C:\\proj\\a.ts", "C:\\proj\\b.md"],
      position: { x: 0, y: 0 },
    });
    // 附件 chip 渲染文件名(basename)。
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.md")).toBeInTheDocument();
    // 遮罩隐藏。
    expect(screen.queryByText("松开以添加文件到对话")).toBeNull();
  });

  it("drop 目录(以分隔符结尾)被过滤,不进附件", async () => {
    render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({
      type: "drop",
      paths: ["C:\\proj\\subdir\\", "C:\\proj\\keep.ts"],
      position: { x: 0, y: 0 },
    });
    expect(screen.getByText("keep.ts")).toBeInTheDocument();
    expect(screen.queryByText("subdir")).toBeNull();
  });

  it("drop 重复路径去重", async () => {
    render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({
      type: "drop",
      paths: ["C:\\proj\\a.ts", "C:\\proj\\a.ts"],
      position: { x: 0, y: 0 },
    });
    expect(screen.getAllByText("a.ts")).toHaveLength(1);
  });

  it("附件随发送清空(onSend 收到含文件清单的正文)", async () => {
    const onSend = vi.fn();
    render(<Composer {...base} onSend={onSend} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    emit({
      type: "drop",
      paths: ["C:\\proj\\a.ts"],
      position: { x: 0, y: 0 },
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "看一下" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(onSend).toHaveBeenCalled();
    const body = onSend.mock.calls[0][0] as string;
    expect(body).toContain("看一下");
    expect(body).toContain("a.ts");
  });

  it("卸载时解绑监听", async () => {
    const unlistenFn = vi.fn();
    dragState.unlisten = unlistenFn;
    const { unmount } = render(<Composer {...base} />);
    await waitFor(() => expect(dragState.handler).not.toBeNull());
    unmount();
    expect(unlistenFn).toHaveBeenCalled();
  });
});
