import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EmailProviderDiagnostic } from "@openbuddy/capability-email";
import { ProviderDiagnosticCard } from "../ProviderDiagnosticCard";

function makeDiagnostic(overrides: Partial<EmailProviderDiagnostic> = {}): EmailProviderDiagnostic {
  return {
    provider: "mcp:gmail",
    serverName: "gmail",
    profile: "gmail",
    toolDiscovery: "discovered",
    discoveredTools: ["list_emails", "send_email"],
    accounts: [],
    operations: [
      { name: "邮件读取", ready: true, requiredTools: ["list_emails"], missingTools: [] },
    ],
    availableCapabilities: ["邮件读取"],
    missingCapabilities: [],
    readiness: "ready",
    ...overrides,
  } as EmailProviderDiagnostic;
}

describe("ProviderDiagnosticCard", () => {
  it("renders ready state with 「已就绪」 label", () => {
    render(<ProviderDiagnosticCard diagnostic={makeDiagnostic({ readiness: "ready" })} onNavigateToConnectors={() => {}} />);
    expect(screen.getByText("邮箱能力已就绪")).toBeTruthy();
    const root = screen.getByLabelText("邮箱连接诊断");
    expect(root.getAttribute("data-readiness")).toBe("ready");
  });

  it("renders partial state with 「部分可用」 label + missing capabilities", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({
          readiness: "partial",
          missingCapabilities: ["发送邮件", "草稿写入"],
        })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText("邮箱能力部分可用")).toBeTruthy();
    expect(screen.getByText(/缺少:发送邮件、草稿写入/)).toBeTruthy();
  });

  it("renders reauthorization-required label", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({ readiness: "reauthorization-required", message: "OAuth token 已过期" })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText("邮箱需要重新授权")).toBeTruthy();
    expect(screen.getByText("OAuth token 已过期")).toBeTruthy();
  });

  it("falls back to profile + discovered tool count when no message", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({ message: undefined, profile: "gmail", discoveredTools: ["list_emails", "send_email"] })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText(/Profile:gmail · 已发现 2 个工具/)).toBeTruthy();
  });

  it("renders connected accounts with capabilities", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({
          accounts: [
            { id: "a1", address: "me@example.com", status: "connected", capabilities: { read: true, write: true, attachments: true, multipleAccounts: false, sync: true } },
            { id: "a2", address: "work@example.com", status: "reauthorization-required", capabilities: { read: true, write: false, attachments: false, multipleAccounts: false } },
          ],
        })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText(/me@example.com:可写 · 附件 · 同步/)).toBeTruthy();
    expect(screen.getByText(/work@example.com:需授权/)).toBeTruthy();
  });

  it("does not render accounts list when accounts is empty", () => {
    render(<ProviderDiagnosticCard diagnostic={makeDiagnostic({ accounts: [] })} onNavigateToConnectors={() => {}} />);
    expect(screen.queryByLabelText("账户级邮箱能力")).toBeNull();
  });

  it("does not render missing list when missingCapabilities is empty", () => {
    render(<ProviderDiagnosticCard diagnostic={makeDiagnostic({ missingCapabilities: [] })} onNavigateToConnectors={() => {}} />);
    expect(screen.queryByText(/缺少:/)).toBeNull();
  });

  it("caps missing capabilities display to first 5", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({
          readiness: "partial",
          missingCapabilities: ["a", "b", "c", "d", "e", "f", "g"],
        })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText(/缺少:a、b、c、d、e/)).toBeTruthy();
    // "f" 和 "g" 不应出现
    // "f" / "g" should not appear in the missing line.
    expect(screen.queryByText(/^缺少:.*[fg]/)).toBeNull();
  });

  it("renders operations inside details element", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({
          operations: [
            { name: "邮件读取", ready: true, requiredTools: ["list_emails"], missingTools: [] },
            { name: "受控发送", ready: false, requiredTools: ["send_email"], missingTools: ["send_email"] },
          ],
        })}
        onNavigateToConnectors={() => {}}
      />,
    );
    expect(screen.getByText("查看逐项能力")).toBeTruthy();
    fireEvent.click(screen.getByText("查看逐项能力"));
    expect(screen.getByText(/✓ 邮件读取/)).toBeTruthy();
    // 默认 mapping:"发送邮件" -> "受控发送"
    expect(screen.getByText(/! 受控发送/)).toBeTruthy();
  });

  it("invokes onNavigateToConnectors when 配置邮箱连接器 clicked", () => {
    const onNavigate = vi.fn();
    render(<ProviderDiagnosticCard diagnostic={makeDiagnostic()} onNavigateToConnectors={onNavigate} />);
    fireEvent.click(screen.getByText("查看逐项能力"));
    screen.getByText("配置邮箱连接器").click();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("uses custom operationLabel when provided", () => {
    render(
      <ProviderDiagnosticCard
        diagnostic={makeDiagnostic({
          operations: [{ name: "custom.op", ready: true, requiredTools: [], missingTools: [] }],
        })}
        operationLabel={(name) => `Label ${name}`}
        onNavigateToConnectors={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("查看逐项能力"));
    expect(screen.getByText(/Label custom\.op/)).toBeTruthy();
  });
});
