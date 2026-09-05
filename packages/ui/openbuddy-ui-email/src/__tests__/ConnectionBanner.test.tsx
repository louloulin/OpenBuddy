import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionBanner, shouldShowConnectionBanner } from "../ConnectionBanner";

describe("ConnectionBanner", () => {
  it("renders default no-provider banner", () => {
    render(<ConnectionBanner variant="no-provider" onPrimaryAction={() => {}} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("邮箱 MCP 未连接")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开连接器" })).toBeTruthy();
  });

  it("renders partial variant with warning icon + 重新授权? no — 查看连接器", () => {
    render(<ConnectionBanner variant="partial" onPrimaryAction={() => {}} />);
    expect(screen.getByText("邮箱能力部分可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看连接器" })).toBeTruthy();
  });

  it("renders reauthorize variant with 重新授权 label", () => {
    render(<ConnectionBanner variant="reauthorize" onPrimaryAction={() => {}} />);
    expect(screen.getByText("邮箱需要重新授权")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新授权" })).toBeTruthy();
  });

  it("invokes onPrimaryAction when primary button clicked", () => {
    const onPrimary = vi.fn();
    render(<ConnectionBanner variant="no-provider" onPrimaryAction={onPrimary} />);
    screen.getByRole("button", { name: "打开连接器" }).click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("renders secondary action when both provided", () => {
    const onSecondary = vi.fn();
    render(
      <ConnectionBanner
        variant="no-provider"
        onPrimaryAction={() => {}}
        onSecondaryAction={onSecondary}
        secondaryActionLabel="重试"
      />,
    );
    const retry = screen.getByRole("button", { name: "重试" });
    expect(retry).toBeTruthy();
    retry.click();
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("does not render secondary action when not provided", () => {
    render(<ConnectionBanner variant="no-provider" onPrimaryAction={() => {}} />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });

  it("renders dismiss button when onDismiss provided", () => {
    const onDismiss = vi.fn();
    render(<ConnectionBanner variant="no-provider" onPrimaryAction={() => {}} onDismiss={onDismiss} />);
    const dismiss = screen.getByRole("button", { name: "关闭提示" });
    expect(dismiss).toBeTruthy();
    dismiss.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses custom title and description when provided", () => {
    render(
      <ConnectionBanner
        variant="no-provider"
        title="自定义标题"
        description="自定义描述"
        onPrimaryAction={() => {}}
      />,
    );
    expect(screen.getByText("自定义标题")).toBeTruthy();
    expect(screen.getByText("自定义描述")).toBeTruthy();
  });

  it("autoFocus the primary button so keyboard users can dismiss banner with Enter", () => {
    render(<ConnectionBanner variant="no-provider" onPrimaryAction={() => {}} />);
    const primary = screen.getByRole("button", { name: "打开连接器" }) as HTMLButtonElement;
    expect(document.activeElement).toBe(primary);
  });

  it("exposes data-variant attribute for styling hooks", () => {
    render(<ConnectionBanner variant="reauthorize" onPrimaryAction={() => {}} />);
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("data-variant")).toBe("reauthorize");
  });
});

describe("shouldShowConnectionBanner", () => {
  it("returns null when accounts exist", () => {
    expect(shouldShowConnectionBanner({ accountsLength: 3 })).toBeNull();
    expect(shouldShowConnectionBanner({ accountsLength: 1, providerReadiness: "ready" })).toBeNull();
  });

  it("returns no-provider when accounts empty + no readiness", () => {
    expect(shouldShowConnectionBanner({ accountsLength: 0 })).toBe("no-provider");
    expect(shouldShowConnectionBanner({ accountsLength: 0, providerReadiness: "unavailable" })).toBe("no-provider");
  });

  it("returns partial when readiness is partial", () => {
    expect(shouldShowConnectionBanner({ accountsLength: 0, providerReadiness: "partial" })).toBe("partial");
  });

  it("returns reauthorize when readiness is reauthorization-required", () => {
    expect(shouldShowConnectionBanner({ accountsLength: 0, providerReadiness: "reauthorization-required" })).toBe("reauthorize");
  });
});
