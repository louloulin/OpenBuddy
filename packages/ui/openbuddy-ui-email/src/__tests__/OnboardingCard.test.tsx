import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OnboardingCard } from "../OnboardingCard";

describe("OnboardingCard", () => {
  it("renders default empty state without mailServer", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByText("尚未连接邮箱")).toBeTruthy();
    expect(screen.getByText(/先选择一个邮箱连接器/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开连接器" })).toBeTruthy();
  });

  it("shows 「授权邮箱」 when mailServerName provided and not authorizing", () => {
    render(<OnboardingCard mailServerName="gmail" authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByRole("button", { name: "授权邮箱" })).toBeTruthy();
    expect(screen.getByText(/检测到邮箱连接器「gmail」/)).toBeTruthy();
  });

  it("shows 「授权中…」 loading state when authorizing is true", () => {
    render(<OnboardingCard mailServerName="gmail" authorizing={true} onPrimaryAction={() => {}} />);
    expect(screen.getByRole("button", { name: "授权中…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "授权中…" }).hasAttribute("disabled")).toBe(true);
  });

  it("disables primary action button during authorizing", () => {
    render(<OnboardingCard authorizing={true} onPrimaryAction={() => {}} />);
    expect(screen.getByRole("button", { name: "授权中…" }).hasAttribute("disabled")).toBe(true);
  });

  it("invokes onPrimaryAction when CTA clicked", () => {
    const onPrimary = vi.fn();
    render(<OnboardingCard authorizing={false} onPrimaryAction={onPrimary} />);
    screen.getByRole("button", { name: "打开连接器" }).click();
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("does NOT invoke onPrimaryAction when CTA clicked during authorizing", () => {
    const onPrimary = vi.fn();
    render(<OnboardingCard authorizing={true} onPrimaryAction={onPrimary} />);
    screen.getByRole("button", { name: "授权中…" }).click();
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it("renders all 4 mainstream provider guides", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByText("Gmail / Google Workspace")).toBeTruthy();
    expect(screen.getByText("Outlook / Microsoft 365")).toBeTruthy();
    expect(screen.getByText(/QQ \/ 163/)).toBeTruthy();
    expect(screen.getByText("Fastmail / JMAP")).toBeTruthy();
  });

  it("each provider guide has access / capabilities / note", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByText(/OAuth \+ Gmail MCP\/API/)).toBeTruthy();
    expect(screen.getByText(/Microsoft Graph OAuth/)).toBeTruthy();
    expect(screen.getByText(/JMAP OAuth\/Token/)).toBeTruthy();
    expect(screen.getByText(/Agent Mail MCP/)).toBeTruthy();
  });

  it("renders footer note explaining OpenBuddy does not store passwords", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByText(/OpenBuddy 不保存邮箱密码/)).toBeTruthy();
  });

  it("renders long-form explanation about partial capability fallback", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByText(/不会静默执行未声明操作/)).toBeTruthy();
  });

  it("renders aria-label for screen readers", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getByRole("region", { name: "邮箱未连接提示" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "主流邮箱接入向导" })).toBeTruthy();
  });

  it("data-provider attributes for e2e targeting", () => {
    render(<OnboardingCard authorizing={false} onPrimaryAction={() => {}} />);
    expect(screen.getAllByText(/Gmail \/ Google Workspace/)[0].closest("article")!.getAttribute("data-provider")).toBe("Gmail / Google Workspace");
  });
});
