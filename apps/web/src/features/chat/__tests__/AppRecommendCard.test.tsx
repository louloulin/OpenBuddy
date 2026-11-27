import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { TurnView } from "../TurnView";
import { useAppsStore } from "@/features/apps/state/apps-store";
import type { ChatMessage } from "@/features/chat/state/session-store";

const appsRecommendDismiss = vi.fn();
const appsSetEnabled = vi.fn();
const appsSetCurrent = vi.fn();
vi.mock("@openbuddy/client/api/files", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  appsRecommendDismiss: (...args: unknown[]) => appsRecommendDismiss(...args),
  appsSetEnabled: (...args: unknown[]) => appsSetEnabled(...args),
  appsSetCurrent: (...args: unknown[]) => appsSetCurrent(...args),
}));

const now = Date.now();
const user: ChatMessage = { id: "u", role: "user", complete: true, parts: [{ kind: "text", text: "查北向资金" }], meta: { timestamp: now - 5_000 } };
const turn = (enabled = true): ChatMessage => ({
  id: "a",
  role: "assistant",
  complete: true,
  meta: { timestamp: now - 1_000, stopReason: "stop" },
  parts: [
    {
      kind: "tool_call",
      toolCall: {
        toolCallId: "rec-1",
        title: "ob_app_recommend",
        kind: "ob_app_recommend",
        status: "completed",
        content: [{ type: "text", text: "可以推荐给用户的已安装应用：upup" }],
        details: {
          query: "查北向资金",
          recommendations: [{ appId: "upup", name: "upup", tagline: "证券智能投研助手", packageSource: "/repo/upup", enabled, matched: ["北向资金"], scene: { name: "个股速览", prompt: "看一下 600519" } }],
        },
      },
    },
    { kind: "text", text: "北向资金今天净流入。" },
  ],
});
const view = (message: ChatMessage, props: Record<string, unknown> = {}) =>
  render(<ThemeProvider><TurnView messages={[message]} user={user} running={false} isLast sessionId="s" {...props} /></ThemeProvider>);

beforeEach(() => {
  window.localStorage.clear();
  useAppsStore.setState({ currentAppId: "openbuddy", recentAppIds: [], dismissedRecommendations: [] });
  appsRecommendDismiss.mockReset().mockResolvedValue({ dismissed: ["upup"] });
  appsSetEnabled.mockReset().mockResolvedValue({});
  appsSetCurrent.mockReset().mockResolvedValue({});
});

describe("会话内推荐卡 (U5 / UP-6.2)", () => {
  it("单卡：名称、定位、命中词；「切换」改当前应用", async () => {
    view(turn());
    const card = screen.getByRole("complementary", { name: "推荐应用 upup" });
    expect(card.textContent).toContain("证券智能投研助手");
    expect(card.textContent).toContain("与「北向资金」相关");
    fireEvent.click(screen.getByRole("button", { name: "切换到 upup" }));
    await waitFor(() => expect(useAppsStore.getState().currentAppId).toBe("upup"));
    expect(appsSetEnabled).not.toHaveBeenCalled();
  });

  it("停用的应用：「启用并切换」先启用再切换", async () => {
    view(turn(false));
    fireEvent.click(screen.getByRole("button", { name: "启用并切换" }));
    await waitFor(() => expect(appsSetEnabled).toHaveBeenCalledWith("/repo/upup", true));
    await waitFor(() => expect(useAppsStore.getState().currentAppId).toBe("upup"));
  });

  it("「试试」把场景 prompt 放进输入框", () => {
    const onInsertPrompt = vi.fn();
    view(turn(), { onInsertPrompt });
    fireEvent.click(screen.getByRole("button", { name: "试试：个股速览" }));
    expect(onInsertPrompt).toHaveBeenCalledWith("看一下 600519");
  });

  it("「不用了」写进宿主并收起；历史会话里的同一推荐也不再显示", async () => {
    const first = view(turn());
    fireEvent.click(screen.getByRole("button", { name: "不用了" }));
    await waitFor(() => expect(appsRecommendDismiss).toHaveBeenCalledWith("upup"));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "推荐应用 upup" })).toBeNull());
    first.unmount();
    view(turn());
    expect(screen.queryByRole("complementary", { name: "推荐应用 upup" })).toBeNull();
  });
});
