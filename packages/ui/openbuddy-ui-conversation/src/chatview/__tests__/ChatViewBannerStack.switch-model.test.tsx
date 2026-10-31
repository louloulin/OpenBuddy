/**
 * 20261031 Phase 1.8 — 发送即被拒(如 429)的错误只出现在顶部横幅,不进转录里的错误卡;
 * 横幅同样要给"切换模型"。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/StatusIndicator", () => ({ StatusIndicator: () => null }));
vi.mock("@openbuddy/ui-shell", async (orig) => ({ ...(await orig<object>()), PlanModeBanner: () => null }));

import { MODEL_SELECTOR_OPEN_EVENT } from "@openbuddy/ui-workbench";
import { ChatViewBannerStack, type ChatViewBannerStackProps } from "../ChatViewBannerStack";

const base: Omit<ChatViewBannerStackProps, "error"> = {
  canRetry: true,
  onRetry: () => undefined,
  onCloseError: () => undefined,
  planMode: false,
  onPlanExit: () => undefined,
};

describe("ChatViewBannerStack switch model", () => {
  it("限流错误横幅显示切换模型并打开模型菜单", () => {
    const opened = vi.fn((e: Event) => e.preventDefault());
    window.addEventListener(MODEL_SELECTOR_OPEN_EVENT, opened);
    try {
      render(<ChatViewBannerStack {...base} error={'429 {"type":"error","error":{"type":"rate_limit_error"}}'} />);
      fireEvent.click(screen.getByTestId("chatview-error-switch-model"));
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(MODEL_SELECTOR_OPEN_EVENT, opened);
    }
  });

  it("只有友好文案(原始状态码已丢)时同样识别限流", () => {
    render(<ChatViewBannerStack {...base} error="⚠️ API 速率限制已触发。请等待 1-2 分钟后重试。" />);
    expect(screen.getByTestId("chatview-error-switch-model")).toBeTruthy();
  });

  it("鉴权错误不显示切换模型", () => {
    render(<ChatViewBannerStack {...base} error="401 invalid api key" />);
    expect(screen.queryByTestId("chatview-error-switch-model")).toBeNull();
  });
});
