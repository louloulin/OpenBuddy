import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EmailSidebar } from "../EmailSidebar";

const baseProps = () => ({ accounts: [{ id: "a1", address: "me@example.com", status: "connected" } as never], accountId: "all", folder: "inbox" as const, view: "all" as const, onAccountChange: vi.fn(), onFolderChange: vi.fn(), onViewChange: vi.fn() });

describe("EmailSidebar", () => {
  it("renders account, smart views, and folders", () => {
    render(<EmailSidebar {...baseProps()} />);
    expect(screen.getByRole("complementary", { name: "邮箱导航" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "收件箱" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
  });

  it("routes navigation without owning email data", () => {
    const props = baseProps();
    render(<EmailSidebar {...props} />);
    fireEvent.change(screen.getByLabelText("邮箱账户"), { target: { value: "a1" } });
    fireEvent.click(screen.getByRole("button", { name: "Signal" }));
    fireEvent.click(screen.getByRole("button", { name: "草稿" }));
    expect(props.onAccountChange).toHaveBeenCalledWith("a1");
    expect(props.onViewChange).toHaveBeenCalledWith("signal");
    expect(props.onFolderChange).toHaveBeenCalledWith("drafts");
  });
});
