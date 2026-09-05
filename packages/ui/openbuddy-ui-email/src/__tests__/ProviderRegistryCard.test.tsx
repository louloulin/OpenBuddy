import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmailConnection, EmailConnectionReadiness } from "@openbuddy/capability-email";
import { ProviderRegistryCard } from "../ProviderRegistryCard";

function makeConnection(overrides: Partial<EmailConnection> = {}): EmailConnection {
  return {
    id: "conn-1",
    providerType: "gmail-api",
    displayName: "Work Gmail",
    enabled: true,
    status: "configured",
    credentialRef: "vault://gmail/work",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as EmailConnection;
}

function makeReadiness(connectionId: string, readiness: "ready" | "partial" | "reauthorization-required" | "unavailable" | "configured"): EmailConnectionReadiness {
  return {
    connection: makeConnection({ id: connectionId }),
    readiness,
    ...(readiness === "reauthorization-required" ? { message: "OAuth token 已过期" } : {}),
  } as EmailConnectionReadiness;
}

describe("ProviderRegistryCard", () => {
  it("renders empty state with explanation when no connections", () => {
    render(
      <ProviderRegistryCard
        connections={[]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByRole("region", { name: "邮箱连接注册表" })).toBeTruthy();
    expect(screen.getByText(/尚未配置任何邮箱连接/)).toBeTruthy();
  });

  it("renders single connection card with display name + provider type", () => {
    const conn = makeConnection();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("Work Gmail")).toBeTruthy();
    expect(screen.getByText(/gmail-api/)).toBeTruthy();
    expect(screen.getByText("停用")).toBeTruthy();
    expect(screen.getByText("移除")).toBeTruthy();
  });

  it("shows 「启用」 when connection is disabled", () => {
    const conn = makeConnection({ enabled: false });
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("启用")).toBeTruthy();
    expect(screen.queryByText("停用")).toBeNull();
  });

  it("shows 「重新授权」 when readiness is reauthorization-required", () => {
    const conn = makeConnection();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[makeReadiness(conn.id, "reauthorization-required")]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("重新授权")).toBeTruthy();
    expect(screen.getByText("需要重新授权")).toBeTruthy();
    expect(screen.getByText("OAuth token 已过期")).toBeTruthy();
  });

  it("invokes onAdd when 「+ 添加邮箱连接」 clicked", () => {
    const onAdd = vi.fn();
    render(
      <ProviderRegistryCard
        connections={[]}
        readiness={[]}
        busyId={null}
        onAdd={onAdd}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    screen.getByText("+ 添加邮箱连接").click();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("invokes onToggle with (connection, true) when disabled connection clicked", () => {
    const conn = makeConnection({ enabled: false });
    const onToggle = vi.fn();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={onToggle}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    screen.getByText("启用").click();
    expect(onToggle).toHaveBeenCalledWith(conn, true);
  });

  it("invokes onToggle with (connection, false) when enabled connection clicked", () => {
    const conn = makeConnection({ enabled: true });
    const onToggle = vi.fn();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={onToggle}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    screen.getByText("停用").click();
    expect(onToggle).toHaveBeenCalledWith(conn, false);
  });

  it("invokes onRemove with the connection", () => {
    const conn = makeConnection();
    const onRemove = vi.fn();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={onRemove}
      />,
    );
    screen.getByText("移除").click();
    expect(onRemove).toHaveBeenCalledWith(conn);
  });

  it("invokes onReauthorize with the connection when readiness is reauthorization-required", () => {
    const conn = makeConnection();
    const onReauthorize = vi.fn();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[makeReadiness(conn.id, "reauthorization-required")]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={onReauthorize}
        onRemove={() => {}}
      />,
    );
    screen.getByText("重新授权").click();
    expect(onReauthorize).toHaveBeenCalledWith(conn);
  });

  it("disables buttons when busyId matches the connection id", () => {
    const conn = makeConnection();
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[makeReadiness(conn.id, "reauthorization-required")]}
        busyId={conn.id}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    const buttons = screen.getAllByRole("button").filter((b) => b.textContent !== "+ 添加邮箱连接");
    // 重新授权 + 停用 + 移除 = 3(添加按钮不参与 busyId)
    for (const button of buttons) {
      expect(button.hasAttribute("disabled")).toBe(true);
    }
    expect(screen.getByText("授权中…")).toBeTruthy();
  });

  it("does not disable buttons on other connections when busyId targets a different id", () => {
    const conn1 = makeConnection({ id: "conn-1", displayName: "Gmail 1" });
    const conn2 = makeConnection({ id: "conn-2", displayName: "Gmail 2" });
    render(
      <ProviderRegistryCard
        connections={[conn1, conn2]}
        readiness={[]}
        busyId="conn-1"
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    const gmail2Card = screen.getByText("Gmail 2").closest("article")!;
    const gmail2Buttons = gmail2Card.querySelectorAll("button");
    for (const button of Array.from(gmail2Buttons)) {
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("renders multiple connections in order", () => {
    const conn1 = makeConnection({ id: "conn-1", displayName: "Work Gmail" });
    const conn2 = makeConnection({ id: "conn-2", displayName: "Personal Gmail", providerType: "graph-api" });
    render(
      <ProviderRegistryCard
        connections={[conn1, conn2]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(articles[0].getAttribute("data-connection-id")).toBe("conn-1");
    expect(articles[1].getAttribute("data-connection-id")).toBe("conn-2");
  });

  it("renders MCP connection with mcpServerName", () => {
    const conn = makeConnection({
      providerType: "mcp",
      mcpServerName: "email-imap-smtp",
      credentialRef: undefined,
    });
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText(/MCP 连接器/)).toBeTruthy();
    expect(screen.getByText(/email-imap-smtp/)).toBeTruthy();
  });

  it("uses status from readiness over connection.status when both available", () => {
    const conn = makeConnection({ status: "configured" });
    render(
      <ProviderRegistryCard
        connections={[conn]}
        readiness={[makeReadiness(conn.id, "ready")]}
        busyId={null}
        onAdd={() => {}}
        onToggle={() => {}}
        onReauthorize={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("已就绪")).toBeTruthy();
    expect(screen.queryByText("未连接")).toBeNull();
  });
});
