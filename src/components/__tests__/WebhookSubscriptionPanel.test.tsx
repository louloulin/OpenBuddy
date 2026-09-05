/**
 * WebhookSubscriptionPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 未选择租户时提示
 *  - 默认全集 vs 显式列表两种 source 的渲染
 *  - 切换单个事件、全选/取消、保存调用 IPC
 *  - 错误信息会出现在 data-testid="webhook-subscription-message"
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorListWebhookSubscriptionsMock = vi.fn();
const casdoorUpdateWebhookSubscriptionsMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorListWebhookSubscriptions: (...args: unknown[]) => casdoorListWebhookSubscriptionsMock(...args),
  casdoorUpdateWebhookSubscriptions: (...args: unknown[]) => casdoorUpdateWebhookSubscriptionsMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
  CASDOOR_WEBHOOK_EVENT_TYPES: [
    "user.add", "user.update", "user.delete",
    "organization.update", "organization.delete",
    "role.update", "role.delete",
  ],
}));

vi.mock("lucide-react", () => ({
  Webhook: () => <span data-icon="webhook" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Save: () => <span data-icon="save" />,
  SquareCheck: () => <span data-icon="checkbox" />,
}));

import { WebhookSubscriptionPanel } from "@openbuddy/ui-account";

function fixture(overrides: Partial<{ activeTenantId: string | undefined }> = {}) {
  return {
    status: "signed_in" as const,
    tenantContext: { activeTenantId: overrides.activeTenantId ?? "tenant-a", availableTenantIds: ["tenant-a"] },
    identity: { subject: "admin", owner: "org-built-in" },
  };
}

describe("WebhookSubscriptionPanel", () => {
  beforeEach(() => {
    casdoorListWebhookSubscriptionsMock.mockReset();
    casdoorUpdateWebhookSubscriptionsMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(fixture());
    casdoorListWebhookSubscriptionsMock.mockResolvedValue({
      tenantId: "tenant-a",
      eventTypes: ["user.add", "user.update", "user.delete"],
      source: "explicit",
    });
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(fixture({ activeTenantId: undefined }));
    render(<WebhookSubscriptionPanel />);
    expect(await screen.findByText(/请先登录并选择租户/)).toBeTruthy();
  });

  it("renders the explicit subscription list with current state", async () => {
    render(<WebhookSubscriptionPanel />);
    const list = await screen.findByTestId("webhook-subscription-list");
    expect(list.textContent).toContain("新增用户");
    expect(list.textContent).toContain("user.update");
    // The source label should mention "显式列表"
    expect(screen.getByText(/显式列表/)).toBeTruthy();
    // The selected ones should be checked
    const userAddToggle = await screen.findByTestId("webhook-subscription-toggle-user.add");
    expect((userAddToggle as HTMLInputElement).checked).toBe(true);
  });

  it("toggles a single event and saves the selection", async () => {
    casdoorUpdateWebhookSubscriptionsMock.mockResolvedValueOnce({
      tenantId: "tenant-a",
      eventTypes: ["user.add"],
      source: "explicit",
    });
    render(<WebhookSubscriptionPanel />);
    const userUpdateToggle = await screen.findByTestId("webhook-subscription-toggle-user.update");
    fireEvent.click(userUpdateToggle);
    const saveButton = await screen.findByText("保存");
    fireEvent.click(saveButton);
    await waitFor(() => expect(casdoorUpdateWebhookSubscriptionsMock).toHaveBeenCalled());
    const input = casdoorUpdateWebhookSubscriptionsMock.mock.calls[0]?.[0];
    expect(input?.tenantId).toBe("tenant-a");
    expect(Array.isArray(input?.eventTypes)).toBe(true);
    expect(input?.eventTypes).toContain("user.add");
    expect(input?.eventTypes).not.toContain("user.update");
  });

  it("selects all events when 全选按钮 clicked", async () => {
    render(<WebhookSubscriptionPanel />);
    const allButton = await screen.findByText(/全部选择/);
    fireEvent.click(allButton);
    const toggle = await screen.findByTestId("webhook-subscription-toggle-role.update");
    expect((toggle as HTMLInputElement).checked).toBe(true);
    // The button should now read "全部取消"
    expect(screen.getByText(/全部取消/)).toBeTruthy();
  });

  it("disables save when nothing is selected", async () => {
    casdoorListWebhookSubscriptionsMock.mockResolvedValueOnce({
      tenantId: "tenant-a",
      eventTypes: [],
      source: "explicit",
    });
    render(<WebhookSubscriptionPanel />);
    const saveButton = await screen.findByText("保存");
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces error messages from the gateway", async () => {
    casdoorUpdateWebhookSubscriptionsMock.mockRejectedValueOnce(new Error("WEBHOOK_PERSIST_DENIED"));
    render(<WebhookSubscriptionPanel />);
    const userAddToggle = await screen.findByTestId("webhook-subscription-toggle-user.add");
    fireEvent.click(userAddToggle);
    fireEvent.click(userAddToggle);
    const saveButton = await screen.findByText("保存");
    fireEvent.click(saveButton);
    expect(await screen.findByTestId("webhook-subscription-message")).toHaveTextContent("WEBHOOK_PERSIST_DENIED");
  });
});
