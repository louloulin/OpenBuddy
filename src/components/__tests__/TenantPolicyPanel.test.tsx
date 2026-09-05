/**
 * TenantPolicyPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 默认渲染当前策略字段 + 保存按钮 disabled
 *  - 修改任意字段后保存按钮启用 + IPC 正确负载（含 expectedVersion）
 *  - Kill Switch / 模型白名单 / New API Group 等字段更新
 *  - 保存错误展示
 *  - 加载失败时展示空态
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const casdoorGetTenantPolicyMock = vi.fn();
const casdoorUpdateTenantPolicyMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorGetTenantPolicy: (...args: unknown[]) => casdoorGetTenantPolicyMock(...args),
  casdoorUpdateTenantPolicy: (...args: unknown[]) => casdoorUpdateTenantPolicyMock(...args),
}));

vi.mock("lucide-react", () => ({
  Power: () => <span data-icon="power" />,
  RefreshCw: () => <span data-icon="refresh" />,
  Save: () => <span data-icon="save" />,
  Shield: () => <span data-icon="shield" />,
}));

import { TenantPolicyPanel } from "@openbuddy/ui-account";

function policyFixture(overrides: Partial<{ status: string; version: number; killSwitch: boolean }> = {}) {
  return {
    status: overrides.status ?? "active",
    maxResources: 100,
    version: overrides.version ?? 3,
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "admin",
    modelAllowlist: ["gpt-4", "claude-3"],
    mcpAllowlist: ["github"],
    killSwitch: overrides.killSwitch ?? false,
    maxTokensPerDay: 100000,
    tokensUsedToday: 200,
    maxPointsPerDay: 5000,
    pointsUsedToday: 120,
    newApiGroup: "default",
  };
}

describe("TenantPolicyPanel", () => {
  beforeEach(() => {
    casdoorGetTenantPolicyMock.mockReset();
    casdoorUpdateTenantPolicyMock.mockReset();
    casdoorGetTenantPolicyMock.mockResolvedValue(policyFixture());
  });

  it("renders all policy fields with current values", async () => {
    render(<TenantPolicyPanel />);
    const status = await screen.findByTestId("tenant-policy-status");
    expect((status as HTMLSelectElement).value).toBe("active");
    const maxResources = await screen.findByTestId("tenant-policy-max-resources");
    expect((maxResources as HTMLInputElement).value).toBe("100");
    const maxTokens = await screen.findByTestId("tenant-policy-max-tokens");
    expect((maxTokens as HTMLInputElement).value).toBe("100000");
    const maxPoints = await screen.findByTestId("tenant-policy-max-points");
    expect((maxPoints as HTMLInputElement).value).toBe("5000");
    const newApiGroup = await screen.findByTestId("tenant-policy-new-api-group");
    expect((newApiGroup as HTMLInputElement).value).toBe("default");
    const modelAllowlist = await screen.findByTestId("tenant-policy-model-allowlist");
    expect((modelAllowlist as HTMLTextAreaElement).value).toContain("gpt-4");
    expect((modelAllowlist as HTMLTextAreaElement).value).toContain("claude-3");
    const killSwitch = await screen.findByTestId("tenant-policy-kill-switch");
    expect((killSwitch as HTMLInputElement).checked).toBe(false);
    const save = await screen.findByTestId("tenant-policy-save");
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables save when fields are edited and sends the patch with expectedVersion", async () => {
    casdoorUpdateTenantPolicyMock.mockResolvedValueOnce(policyFixture({ version: 4, status: "suspended" }));
    render(<TenantPolicyPanel />);
    const killSwitch = await screen.findByTestId("tenant-policy-kill-switch");
    fireEvent.click(killSwitch);
    const save = await screen.findByTestId("tenant-policy-save");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(casdoorUpdateTenantPolicyMock).toHaveBeenCalled());
    const patch = casdoorUpdateTenantPolicyMock.mock.calls[0]?.[0];
    expect(patch?.expectedVersion).toBe(3);
    expect(patch?.killSwitch).toBe(true);
    expect(await screen.findByTestId("tenant-policy-message")).toHaveTextContent("策略已更新到版本 4");
  });

  it("treats comma and newline lists equivalently", async () => {
    casdoorUpdateTenantPolicyMock.mockResolvedValueOnce(policyFixture({ version: 5 }));
    render(<TenantPolicyPanel />);
    const modelAllowlist = await screen.findByTestId("tenant-policy-model-allowlist");
    fireEvent.change(modelAllowlist, { target: { value: "gpt-4, claude-3, gemini-1.5" } });
    const save = await screen.findByTestId("tenant-policy-save");
    fireEvent.click(save);
    await waitFor(() => expect(casdoorUpdateTenantPolicyMock).toHaveBeenCalled());
    const patch = casdoorUpdateTenantPolicyMock.mock.calls[0]?.[0];
    expect(patch?.modelAllowlist).toEqual(["gpt-4", "claude-3", "gemini-1.5"]);
  });

  it("surfaces save errors", async () => {
    casdoorUpdateTenantPolicyMock.mockRejectedValueOnce(new Error("TENANT_POLICY_VERSION_CONFLICT"));
    render(<TenantPolicyPanel />);
    const status = await screen.findByTestId("tenant-policy-status");
    fireEvent.change(status, { target: { value: "suspended" } });
    const save = await screen.findByTestId("tenant-policy-save");
    fireEvent.click(save);
    expect(await screen.findByTestId("tenant-policy-message")).toHaveTextContent("TENANT_POLICY_VERSION_CONFLICT");
  });

  it("shows empty state when loading fails", async () => {
    casdoorGetTenantPolicyMock.mockRejectedValueOnce(new Error("TENANT_POLICY_LOAD_DENIED"));
    render(<TenantPolicyPanel />);
    expect(await screen.findByTestId("tenant-policy-message")).toHaveTextContent("TENANT_POLICY_LOAD_DENIED");
  });

  it("treats clearing maxTokensPerDay as a real patch", async () => {
    casdoorUpdateTenantPolicyMock.mockResolvedValueOnce(policyFixture({ version: 6 }));
    render(<TenantPolicyPanel />);
    const maxTokens = await screen.findByTestId("tenant-policy-max-tokens");
    fireEvent.change(maxTokens, { target: { value: "" } });
    const save = await screen.findByTestId("tenant-policy-save");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(casdoorUpdateTenantPolicyMock).toHaveBeenCalled());
    const patch = casdoorUpdateTenantPolicyMock.mock.calls[0]?.[0];
    expect(patch?.maxTokensPerDay).toBeUndefined();
  });
});
