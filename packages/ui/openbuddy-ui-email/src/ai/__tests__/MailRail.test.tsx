import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen } from "@testing-library/react";
import { MailRail, type RailCounts } from "../components/MailRail";

const accounts = [
  { id: "a1", address: "me@openbuddy.ai", name: "Work", status: "connected" as const },
];

const counts: RailCounts = {
  today: 7, later: 14, done: 105,
  inbox: 21, drafts: 3, scheduled: 3, snoozed: 5, starred: 4,
};

beforeEach(() => { swrCacheInternal.reset(); });
describe("MailRail", () => {
  it("renders account status", () => {
    render(
      <MailRail
        accounts={accounts}
        accountId="a1"
        view="today"
        folder="inbox"
        counts={counts}
        onAccountChange={vi.fn()}
        onViewChange={vi.fn()}
        onFolderChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("邮箱账户")).toBeTruthy();
    expect(screen.getByText("已连接")).toBeTruthy();
  });

  it("emits onViewChange when Today is clicked", () => {
    const onViewChange = vi.fn();
    render(
      <MailRail
        accounts={accounts}
        accountId="a1"
        view="today"
        folder="inbox"
        counts={counts}
        onAccountChange={vi.fn()}
        onViewChange={onViewChange}
        onFolderChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Later · 本周再处理/ }));
    expect(onViewChange).toHaveBeenCalledWith("later");
  });

  it("exposes primary folders with counts", () => {
    render(
      <MailRail
        accounts={accounts}
        accountId="a1"
        view="today"
        folder="inbox"
        counts={counts}
        onAccountChange={vi.fn()}
        onViewChange={vi.fn()}
        onFolderChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Inbox/ })).toBeTruthy();
    expect(screen.getByText("21")).toBeTruthy(); expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2);
    // consolidated into line 64
  });

  it("expands More section on click", () => {
    render(
      <MailRail
        accounts={accounts}
        accountId="a1"
        view="today"
        folder="inbox"
        counts={counts}
        onAccountChange={vi.fn()}
        onViewChange={vi.fn()}
        onFolderChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    expect(screen.getByRole("button", { name: /Starred/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Provider \/ Rules/ })).toBeTruthy();
  });
});
