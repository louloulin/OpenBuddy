/**
 * GatewayHealthPanel 渲染层冒烟测试。
 *
 * 验证：
 *  - 未登录时给出提示
 *  - 拉取 gateway / tenant 健康并渲染字段
 *  - configured:false 时显示未配置提示
 *  - 加载失败时显示 warn 提示
 *  - 当日 token 用量与配额上限百分比正确
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const casdoorGatewayHealthMock = vi.fn();
const casdoorTenantHealthMock = vi.fn();
const casdoorStatusMock = vi.fn();

vi.mock("@/lib/casdoor/casdoor-client", () => ({
  casdoorGatewayHealth: (...args: unknown[]) => casdoorGatewayHealthMock(...args),
  casdoorTenantHealth: (...args: unknown[]) => casdoorTenantHealthMock(...args),
  casdoorStatus: (...args: unknown[]) => casdoorStatusMock(...args),
}));

vi.mock("lucide-react", () => ({
  Activity: () => <span data-icon="activity" />,
  AlertTriangle: () => <span data-icon="warn" />,
  RefreshCw: () => <span data-icon="refresh" />,
}));

import { GatewayHealthPanel } from "@openbuddy/ui-account";

function statusFixture(activeTenantId?: string) {
  return {
    status: "signed_in" as const,
    tenantContext: {
      activeTenantId: activeTenantId ?? "tenant-a",
      availableTenantIds: ["tenant-a"],
    },
    identity: { subject: "admin", owner: "org-built-in" },
  };
}

function gatewayFixture() {
  return {
    ok: true,
    store: "sqlite",
    latencyMs: 17,
    version: "v1.0.0",
  };
}

function tenantFixture(overrides: Partial<{ killSwitch: boolean; maxTokensPerDay: number; tokensUsedToday: number; maxPointsPerDay: number; pointsUsedToday: number }> = {}) {
  return {
    ok: true,
    store: "sqlite",
    latencyMs: 17,
    version: "v1.0.0",
    tenantId: "tenant-a",
    policy: {
      status: "active" as const,
      maxResources: 100,
      version: 3,
      killSwitch: overrides.killSwitch ?? false,
      modelAllowlist: 4,
      mcpAllowlist: 2,
      maxTokensPerDay: overrides.maxTokensPerDay ?? 1000,
      tokensUsedToday: overrides.tokensUsedToday ?? 250,
      maxPointsPerDay: overrides.maxPointsPerDay,
      pointsUsedToday: overrides.pointsUsedToday ?? 0,
    },
    budgets: {
      tokens: { limit: overrides.maxTokensPerDay ?? 1000, used: overrides.tokensUsedToday ?? 250, reserved: 100, committed: (overrides.tokensUsedToday ?? 250) + 100, remaining: 650, utilizationPercent: 35, status: "healthy" as const },
      points: { limit: overrides.maxPointsPerDay, used: overrides.pointsUsedToday ?? 0, reserved: 0, committed: overrides.pointsUsedToday ?? 0, status: overrides.maxPointsPerDay === undefined ? "unlimited" as const : "healthy" as const },
    },
    resources: { project: 3, knowledge_base: 1, storage_connection: 2 },
    revokedMembers: 1,
    activeSessions: 2,
    siem: { kind: "splunk", endpoint: "https://siem.example.com/ingest" },
    at: "2026-08-30T12:00:00.000Z",
  };
}

describe("GatewayHealthPanel", () => {
  beforeEach(() => {
    casdoorGatewayHealthMock.mockReset();
    casdoorTenantHealthMock.mockReset();
    casdoorStatusMock.mockReset();
    casdoorStatusMock.mockResolvedValue(statusFixture());
    casdoorGatewayHealthMock.mockResolvedValue(gatewayFixture());
    casdoorTenantHealthMock.mockResolvedValue(tenantFixture());
  });

  it("prompts the user to sign in when no tenant is active", async () => {
    casdoorStatusMock.mockResolvedValueOnce(statusFixture(""));
    render(<GatewayHealthPanel />);
    expect(await screen.findByText(/请先登录并选择租户/)).toBeTruthy();
  });

  it("renders gateway and tenant health fields", async () => {
    render(<GatewayHealthPanel />);
    expect(await screen.findByTestId("gateway-health-row-store")).toBeTruthy();
    expect(screen.getByTestId("gateway-health-row-store").textContent).toContain("sqlite");
    expect(screen.getByTestId("gateway-health-row-version").textContent).toContain("v1.0.0");
    expect(screen.getByTestId("gateway-health-row-latency").textContent).toContain("17");
    expect(screen.getByTestId("gateway-health-badge-ok")).toBeTruthy();
    expect(screen.getByTestId("gateway-health-tenant-badge-ok")).toBeTruthy();

    expect(screen.getByTestId("gateway-health-tenant-policy-status").textContent).toContain("active");
    expect(screen.getByTestId("gateway-health-tenant-allowlists").textContent).toContain("模型 4");
    expect(screen.getByTestId("gateway-health-tenant-allowlists").textContent).toContain("MCP 2");
    expect(screen.getByTestId("gateway-health-tenant-revoked-members").textContent).toContain("1");
    expect(screen.getByTestId("gateway-health-tenant-active-sessions").textContent).toContain("2");
    expect(screen.getByTestId("gateway-health-tenant-siem").textContent).toContain("splunk");
    expect(screen.getByTestId("gateway-health-tenant-token-budget").textContent).toContain("35%");
    expect(screen.getByTestId("gateway-health-tenant-points-budget").textContent).toContain("积分不限额");
  });

  it("computes the quota usage ratio correctly", async () => {
    casdoorTenantHealthMock.mockResolvedValueOnce(
      tenantFixture({ maxTokensPerDay: 1000, tokensUsedToday: 250 }),
    );
    render(<GatewayHealthPanel />);
    const quota = await screen.findByTestId("gateway-health-tenant-quota");
    expect(quota.textContent).toMatch(/250 \/ 1000/);
    expect(quota.textContent).toContain("25%");
  });

  it("shows 'no limit' when maxTokensPerDay is unset", async () => {
    casdoorTenantHealthMock.mockResolvedValueOnce({
      ...tenantFixture(),
      policy: { ...tenantFixture().policy, maxTokensPerDay: undefined },
    });
    render(<GatewayHealthPanel />);
    const quota = await screen.findByTestId("gateway-health-tenant-quota");
    expect(quota.textContent).toContain("无上限");
  });

  it("renders the configured:false hint when gateway is unconfigured", async () => {
    casdoorGatewayHealthMock.mockReset();
    casdoorGatewayHealthMock.mockResolvedValueOnce({ configured: false });
    render(<GatewayHealthPanel />);
    expect(await screen.findByTestId("gateway-health-gateway-unconfigured")).toBeTruthy();
  });

  it("shows a warn message when gateway fetch fails", async () => {
    casdoorGatewayHealthMock.mockRejectedValueOnce(new Error("NETWORK_DOWN"));
    render(<GatewayHealthPanel />);
    const msg = await screen.findByTestId("gateway-health-message");
    expect(msg.textContent).toMatch(/NETWORK_DOWN/);
    expect(screen.queryByTestId("gateway-health-row-store")).toBeNull();
  });

  it("renders kill switch flag in tenant status row", async () => {
    casdoorTenantHealthMock.mockResolvedValueOnce(tenantFixture({ killSwitch: true }));
    render(<GatewayHealthPanel />);
    const status = await screen.findByTestId("gateway-health-tenant-policy-status");
    expect(status.textContent).toContain("KILL SWITCH ON");
  });
});
