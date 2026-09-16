import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WhatsNewCard } from "../components/WhatsNewCard";

afterEach(() => cleanup());

const ITEMS = [{ title: "主题系统 v2", description: "17 套 OKLCh 主题" }, { title: "编辑器升级" }];

describe("@openbuddy/ui-onboarding/WhatsNewCard", () => {
  it("渲染版本号、日期与条目", () => {
    render(
      <WhatsNewCard version="0.15.0" releasedAt="2026-09-16" items={ITEMS} onDismiss={() => {}} />,
    );
    expect(screen.getByTestId("whats-new-version").textContent).toBe("v0.15.0 · 2026-09-16");
    expect(screen.getAllByTestId("whats-new-item")).toHaveLength(2);
    expect(screen.getByTestId("whats-new-card").textContent).toContain("17 套 OKLCh 主题");
  });

  it("空条目给一句兜底文案", () => {
    render(<WhatsNewCard version="0.15.1" items={[]} onDismiss={() => {}} />);
    expect(screen.getByTestId("whats-new-empty")).toBeTruthy();
  });

  it("默认 onDismiss(false):不记住", () => {
    const onDismiss = vi.fn();
    render(<WhatsNewCard version="0.15.0" items={ITEMS} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("whats-new-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith(false);
  });

  it("勾选不再显示后 onDismiss(true)", () => {
    const onDismiss = vi.fn();
    render(<WhatsNewCard version="0.15.0" items={ITEMS} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("whats-new-remember"));
    fireEvent.click(screen.getByTestId("whats-new-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("关闭图标同样带上复选框状态;defaultRemember 可预勾选", () => {
    const onDismiss = vi.fn();
    render(<WhatsNewCard version="0.15.0" items={ITEMS} defaultRemember onDismiss={onDismiss} />);
    expect((screen.getByTestId("whats-new-remember") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("whats-new-close"));
    expect(onDismiss).toHaveBeenCalledWith(true);
  });

  it("onOpenChangelog 可选", () => {
    const onOpenChangelog = vi.fn();
    const { rerender } = render(
      <WhatsNewCard version="0.15.0" items={ITEMS} onDismiss={() => {}} />,
    );
    expect(screen.queryByTestId("whats-new-changelog")).toBeNull();
    rerender(
      <WhatsNewCard
        version="0.15.0"
        items={ITEMS}
        onDismiss={() => {}}
        onOpenChangelog={onOpenChangelog}
      />,
    );
    fireEvent.click(screen.getByTestId("whats-new-changelog"));
    expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  });
});
