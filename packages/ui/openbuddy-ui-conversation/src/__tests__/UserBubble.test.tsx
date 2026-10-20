/**
 * UserBubble.test.tsx — Plan5 组件化回归测试
 *
 * 验证从 MessageItem 抽出的用户气泡:
 *   - 默认 display 态,显示 userDisplayedText
 *   - 双击进入编辑态,textarea 出现
 *   - 取消按钮退出编辑态
 *   - 提交触发 onInlineResend + 退出编辑态
 *   - 提交空文本 → 静默不触发
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the import chain that transitively pulls electron-api (which
// dynamically imports @openbuddy/ui-state/global-confirm-store and
// breaks vite-tsconfig-paths resolution in test env).
vi.mock("@openbuddy/ui-workbench", () => ({
  FilePreview: ({ filename }: { filename: string }) => (
    <div data-testid="file-preview">{filename}</div>
  ),
  ModelSelector: () => null,
  SlashCommands: () => null,
}));

import { UserBubble } from "../parts/UserBubble";
import type { ChatMessage } from "@/stores/session-store";

const baseMsg: ChatMessage = {
  id: "m1",
  parts: [{ kind: "text", text: "hi" }],
  role: "user",
  createdAt: Date.now(),
} as ChatMessage;

describe("UserBubble (Plan5 componentization)", () => {
  it("默认 display 态显示文本", () => {
    render(
      <UserBubble
        message={baseMsg}
        userDisplayedText="hello"
        fileParts={[]}
        revisionPager={null}
        copyText={() => {}}
      />,
    );
    expect(screen.getByText("hello")).toBeTruthy();
    expect(screen.getByTestId("user-bubble-display")).toBeTruthy();
  });

  it("双击进入编辑态", () => {
    render(
      <UserBubble
        message={baseMsg}
        userDisplayedText="hello"
        fileParts={[]}
        revisionPager={null}
        onInlineResend={() => {}}
        copyText={() => {}}
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("user-bubble-display"));
    expect(screen.getByTestId("user-bubble-edit")).toBeTruthy();
    expect(screen.getByTestId("user-bubble-edit-input")).toBeTruthy();
  });

  it("无 onInlineResend 时双击不进入编辑态", () => {
    render(
      <UserBubble
        message={baseMsg}
        userDisplayedText="hello"
        fileParts={[]}
        revisionPager={null}
        copyText={() => {}}
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("user-bubble-display"));
    expect(screen.queryByTestId("user-bubble-edit")).toBeNull();
  });

  it("提交触发 onInlineResend + 退出编辑态", () => {
    const onInlineResend = vi.fn();
    render(
      <UserBubble
        message={baseMsg}
        userDisplayedText="hello"
        fileParts={[]}
        revisionPager={null}
        onInlineResend={onInlineResend}
        copyText={() => {}}
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("user-bubble-display"));
    const textarea = screen.getByTestId(
      "user-bubble-edit-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "new text" } });
    fireEvent.click(screen.getByTestId("user-bubble-edit-submit"));
    expect(onInlineResend).toHaveBeenCalledWith("m1", "new text");
    expect(screen.queryByTestId("user-bubble-edit")).toBeNull();
  });

  it("提交与原文相同 → 静默不触发", () => {
    const onInlineResend = vi.fn();
    render(
      <UserBubble
        message={baseMsg}
        userDisplayedText="hello"
        fileParts={[]}
        revisionPager={null}
        onInlineResend={onInlineResend}
        copyText={() => {}}
      />,
    );
    fireEvent.doubleClick(screen.getByTestId("user-bubble-display"));
    fireEvent.click(screen.getByTestId("user-bubble-edit-submit"));
    expect(onInlineResend).not.toHaveBeenCalled();
  });
});
