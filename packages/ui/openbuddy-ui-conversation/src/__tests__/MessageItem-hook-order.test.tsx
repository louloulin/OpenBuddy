/**
 * MessageItem-hook-order.test.tsx — R93 regression guard.
 *
 * MessageItem 内部有一个「空白 assistant 气泡直接 return null」的提前返回,
 * 它原先排在 `inlineEditing` 的 Esc/Cmd+Enter useEffect 之前。同一个
 * MessageItem 实例(同一个 message.id)在
 *   `streaming=true, parts=[]`  →  `complete=true, parts=[]`
 * 之间切换时,后者提前 return null,导致 hook 数量从 N 掉到 0,
 * React 直接抛 #300 / #310「Rendered fewer/more hooks than expected」,
 * 整个会话视图塌进 ErrorBoundary。
 *
 * 这个用例把同一实例沿「有内容 → 空白完成 → 又有内容」推一遍:
 * 修复前 rerender 会同步抛错,修复后三个阶段都正常。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MessageItem } from "../MessageItem";
import type { ChatMessage } from "@/stores/session-store";

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (s: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

function makeAssistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  const now = Date.now();
  return {
    id: "hook-order-1",
    role: "assistant",
    parts: [{ kind: "text", text: "partial" }],
    complete: false,
    createdAt: now - 1000,
    ...overrides,
  } as ChatMessage;
}

describe("MessageItem — R93 hook 顺序稳定", () => {
  it("同一实例在「有内容 → 空白完成 → 有内容」之间切换不改变 hook 数量", () => {
    const { rerender } = render(
      <MessageItem sessionId="s1" message={makeAssistant()} streaming={true} />,
    );

    // ① 空白完成:命中 `return null` 的提前返回。修复前这里同步抛错。
    expect(() => {
      rerender(
        <MessageItem
          sessionId="s1"
          message={makeAssistant({ parts: [], complete: true, completedAt: Date.now() })}
          streaming={false}
        />,
      );
    }).not.toThrow();

    // ② 同一实例又拿到内容:hook 数量不能变化(修复前反向同样抛错)。
    expect(() => {
      rerender(
        <MessageItem
          sessionId="s1"
          message={makeAssistant({ parts: [{ kind: "text", text: "late content" }], complete: true, completedAt: Date.now() })}
          streaming={false}
        />,
      );
    }).not.toThrow();
  });

  it("user 气泡与 assistant 气泡分别渲染时也不改变同一实例的 hook 数量", () => {
    const user = {
      id: "hook-order-2",
      role: "user",
      parts: [{ kind: "text", text: "hi" }],
      complete: true,
      createdAt: Date.now(),
    } as ChatMessage;
    const assistant = makeAssistant({ id: "hook-order-2" });

    const { rerender } = render(
      <MessageItem sessionId="s1" message={user} streaming={false} />,
    );
    expect(() => {
      rerender(<MessageItem sessionId="s1" message={assistant} streaming={true} />);
    }).not.toThrow();
  });
});
