/**
 * 20261031 Phase 2.9 — 断网时对话底部立即提示,而不是等一轮发送失败才知道。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("../Composer", () => ({ Composer: () => null }));
vi.mock("@openbuddy/ui-dialogs", () => ({ PermissionInlineCard: () => null }));

import { ChatViewFooter } from "../chatview/ChatViewFooter";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

describe("ChatViewFooter offline banner", () => {
  afterEach(() => setOnline(true));

  it("shows a banner while offline and hides it when back online", () => {
    render(
      <ChatViewFooter
        sessionId="s1"
        streaming={false}
        readOnlySubagent={false}
        yielded={false}
        composerProps={{} as never}
        composerFallback={<div />}
        onSend={() => undefined}
        onResume={() => undefined}
        onResumeAndContinue={() => undefined}
        onPause={() => undefined}
        pendingApprovalCount={0}
        blockedOnApproval={false}
      />,
    );
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    act(() => setOnline(false));
    expect(screen.getByTestId("offline-banner")).toBeTruthy();
    act(() => setOnline(true));
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});
