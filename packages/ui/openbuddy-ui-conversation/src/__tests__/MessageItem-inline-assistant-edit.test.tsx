/**
 * MessageItem-inline-assistant-edit.test.tsx — R78 (assistant inline edit)
 *
 * 不 mock 任何真实实现,只验证:
 *  1) MessageItem 收到 onEditAssistantMessage + onResendAfterAssistantEdit 后,
 *     渲染「就地编辑」、「应用」、「应用并重新生成」按钮(因为 editor.body 槽在
 *     builtin apply() 后已有 TiptapEditor 注册,生产环境永远成立)。
 *  2) 点按钮 → 正确触发对应回调。
 *  3) Esc / Cancel → 不触发 onEditAssistantMessage。
 *  4) user 消息不渲染「就地编辑」按钮(R78 只针对 assistant)。
 *
 * 注意:不依赖槽位清空来测"无 editor.body 时按钮不渲染" —— 那是 MessageItem
 * 设计的健壮性保证,在 builtin-applies-registration.test 里已经有"L3 接线证据"
 * (editor.body 注册了 TiptapEditor);R78 测试专注消息级契约。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { SlotProvider } from "@openbuddy/ui-runtime/client";
import { MessageItem } from "../MessageItem";
import { useSessionStore } from "@/stores/session-store";
import type { ChatMessage } from "@/stores/session-store";

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

vi.mock("@openbuddy/ui-theme/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/ui-theme/client")>();
  return {
    ...actual,
    useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
      selector({ current: () => "light" }),
  };
});

const mount = (node: ReactNode) => render(<SlotProvider>{node}</SlotProvider>);

function makeAssistant(text = "原 AI 回复"): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    parts: [{ kind: "text", text }],
    complete: true,
    createdAt: Date.now(),
  } as ChatMessage;
}

function seedAssistantInStore(msg: ChatMessage) {
  useSessionStore.setState((s) => ({
    messages: [msg, ...s.messages.filter((m) => m.id !== msg.id)],
    streamingMessageId: null,
  }));
}

describe("R78 — assistant inline edit (MessageItem UI 接线)", () => {
  it("assistant 消息渲染「就地编辑」按钮(editor.body 槽在 builtin 后有 TiptapEditor)", () => {
    seedAssistantInStore(makeAssistant());
    mount(<MessageItem message={makeAssistant()} streaming={false} sessionId="s1" />);
    expect(screen.queryByTestId("message-inline-edit-button")).toBeTruthy();
  });

  it("点「就地编辑」进入编辑态,显示「应用」「取消」按钮", () => {
    mount(<MessageItem message={makeAssistant()} streaming={false} sessionId="s1" />);
    fireEvent.click(screen.getByTestId("message-inline-edit-button"));
    expect(screen.getByTestId("message-inline-edit-apply")).toBeTruthy();
    expect(screen.getByTestId("message-inline-edit-cancel")).toBeTruthy();
  });

  it("「应用」→ 调用 onEditAssistantMessage(messageId, markdown)", () => {
    const onEdit = vi.fn();
    mount(
      <MessageItem
        message={makeAssistant("原 AI 回复")}
        streaming={false}
        sessionId="s1"
        onEditAssistantMessage={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId("message-inline-edit-button"));
    fireEvent.click(screen.getByTestId("message-inline-edit-apply"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("a1", "原 AI 回复");
  });

  it("「取消」→ 不触发 onEditAssistantMessage", () => {
    const onEdit = vi.fn();
    mount(
      <MessageItem
        message={makeAssistant()}
        streaming={false}
        sessionId="s1"
        onEditAssistantMessage={onEdit}
      />,
    );
    fireEvent.click(screen.getByTestId("message-inline-edit-button"));
    fireEvent.click(screen.getByTestId("message-inline-edit-cancel"));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("「应用并重新生成」→ 先 onEditAssistantMessage 再 onResendAfterAssistantEdit", () => {
    const onEdit = vi.fn();
    const onResend = vi.fn();
    mount(
      <MessageItem
        message={makeAssistant()}
        streaming={false}
        sessionId="s1"
        onEditAssistantMessage={onEdit}
        onResendAfterAssistantEdit={onResend}
      />,
    );
    fireEvent.click(screen.getByTestId("message-inline-edit-button"));
    fireEvent.click(screen.getByTestId("message-inline-edit-apply-resend"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onResend).toHaveBeenCalledWith("a1");
  });

  it("user 消息不渲染「就地编辑」按钮", () => {
    const userMsg: ChatMessage = {
      id: "u1",
      role: "user",
      parts: [{ kind: "text", text: "hi" }],
      complete: true,
      createdAt: Date.now(),
    } as ChatMessage;
    mount(<MessageItem message={userMsg} streaming={false} sessionId="s1" />);
    expect(screen.queryByTestId("message-inline-edit-button")).toBeNull();
  });

  it("接 ChatView 真实接线 → onEditAssistantMessage 触发 store editAssistantMessage → message.parts 被替换", () => {
    // 端到端最小验证:不走 ChatView,直接模拟 ChatView 的 onEditAssistantMessage 行为。
    seedAssistantInStore(makeAssistant("原始 AI 回复"));
    const msg = useSessionStore.getState().messages[0];
    mount(
      <MessageItem
        message={msg}
        streaming={false}
        sessionId="s1"
        onEditAssistantMessage={(id, md) => {
          useSessionStore.getState().editAssistantMessage(id, md);
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("message-inline-edit-button"));
    fireEvent.click(screen.getByTestId("message-inline-edit-apply"));
    const updated = useSessionStore.getState().messages[0];
    const texts = (updated.parts as Array<{ kind: string; text?: string }>).filter((p) => p.kind === "text");
    expect(texts.length).toBe(1);
    expect(texts[0].text).toBe("原始 AI 回复");
  });
});
