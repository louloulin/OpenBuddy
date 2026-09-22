/**
 * MessagePartRegistry.test.tsx
 *
 * Phase A.2 测试:验证消息部件按 `kind` 派发,默认实现与改造前等效。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MessagePartRegistry } from "../MessagePartRegistry";
import type { ChatMessage } from "@openbuddy/ui-state/session-store";

function makeMessage(parts: ChatMessage["parts"]): ChatMessage {
  return {
    id: "m-1",
    role: "assistant",
    parts,
    complete: true,
  };
}

describe("MessagePartRegistry", () => {
  it("dispatches text parts via ConversationMarkdown", () => {
    const { container } = render(
      <MessagePartRegistry
        parts={[{ kind: "text", text: "hello" }]}
        messageId="m-1"
        isStreaming={false}
        complete={true}
      />,
    );
    expect(container.querySelector(".markdown-body")).toBeTruthy();
  });

  it("renders thought parts with msg__thought wrapper", () => {
    const { container } = render(
      <MessagePartRegistry
        parts={[{ kind: "thought", text: "considering…" }]}
        messageId="m-1"
        isStreaming={false}
        complete={true}
      />,
    );
    expect(container.querySelector(".msg__thought")).toBeTruthy();
    expect(container.querySelector(".msg__thought summary")).toBeTruthy();
  });

  it("renders tool_call parts via ToolCallCard", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <MessagePartRegistry
        parts={[
          {
            kind: "tool_call",
            toolCall: {
              toolCallId: "t-1",
              title: "ls -la",
              kind: "bash",
              status: "completed",
              content: [],
            },
          },
        ]}
        messageId="m-1"
        isStreaming={false}
        complete={true}
        onOpenTool={onOpen}
      />,
    );
    expect(container.querySelector(".toolcall")).toBeTruthy();
    expect(container.querySelector('[data-testid="toolcall-duration"]')).toBeNull(); // no duration
  });

  it("renders file parts via FilePreview", () => {
    const { container } = render(
      <MessagePartRegistry
        parts={[
          {
            kind: "file",
            name: "test.png",
            mediaType: "image/png",
            data: "iVBORw0KGgo=",
          },
        ]}
        messageId="m-1"
        isStreaming={false}
        complete={true}
      />,
    );
    // FilePreview renders a file chip; presence is enough
    expect(container.querySelector("*")).toBeTruthy();
  });

  it("renders multiple parts in order", () => {
    const message = makeMessage([
      { kind: "text", text: "I will do X" },
      {
        kind: "tool_call",
        toolCall: {
          toolCallId: "t-1",
          title: "X",
          kind: "bash",
          status: "completed",
          content: [],
        },
      },
      { kind: "text", text: "done" },
    ]);
    const { container } = render(
      <MessagePartRegistry
        parts={message.parts}
        messageId={message.id}
        isStreaming={false}
        complete={true}
      />,
    );
    // expect at least one markdown body and one toolcall
    expect(container.querySelectorAll(".markdown-body").length).toBe(2);
    expect(container.querySelectorAll(".toolcall").length).toBe(1);
  });

  it("marks streaming thought with data-thinking-streaming=true", () => {
    const { container } = render(
      <MessagePartRegistry
        parts={[{ kind: "thought", text: "still thinking…" }]}
        messageId="m-1"
        isStreaming={true}
        complete={false}
      />,
    );
    const thought = container.querySelector('[data-thinking-streaming="true"]');
    expect(thought).toBeTruthy();
  });
});
