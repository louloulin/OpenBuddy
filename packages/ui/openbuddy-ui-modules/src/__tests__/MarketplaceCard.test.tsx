import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketplaceCard, primaryActionFor } from "../components/MarketplaceCard";
import type { MarketplaceEntry } from "../components/marketplace-model";

afterEach(() => cleanup());

function entry(partial: Partial<MarketplaceEntry> = {}): MarketplaceEntry {
  return {
    id: "pi-fs",
    name: "Pi FS Tools",
    publisher: "openbuddy",
    description: "文件系统读写工具集",
    version: "1.2.0",
    kinds: ["plugin"],
    ...partial,
  };
}

describe("primaryActionFor", () => {
  it("derives the primary button from the install state", () => {
    expect(primaryActionFor("available")).toMatchObject({
      label: "安装",
      kind: "install",
      disabled: false,
    });
    expect(primaryActionFor("update-available")).toMatchObject({ label: "更新", kind: "upgrade" });
    expect(primaryActionFor("installed")).toMatchObject({
      label: "已安装",
      kind: "none",
      disabled: true,
    });
    expect(primaryActionFor("installing")).toMatchObject({
      label: "安装中…",
      loading: true,
      disabled: true,
    });
    expect(primaryActionFor("blocked", "引擎版本过低")).toMatchObject({
      label: "不可用",
      disabled: true,
      title: "引擎版本过低",
    });
  });
});

describe("MarketplaceCard", () => {
  it("renders identity, state badge and version chip", () => {
    render(<MarketplaceCard entry={entry()} />);
    expect(screen.getByText("Pi FS Tools")).toBeTruthy();
    expect(screen.getByText("openbuddy")).toBeTruthy();
    expect(screen.getByTestId("install-state").textContent).toBe("可安装");
    expect(screen.getByText("1.2.0")).toBeTruthy();
  });

  it("shows the update state for an outdated install", () => {
    render(<MarketplaceCard entry={entry({ installedVersion: "1.0.0" })} />);
    expect(screen.getByTestId("install-state").textContent).toBe("可更新");
    expect(screen.getByTestId("marketplace-card-primary").getAttribute("data-action")).toBe(
      "upgrade",
    );
  });

  it("blocks the primary action when incompatible", () => {
    render(
      <MarketplaceCard
        entry={entry({ incompatible: true, blockedReason: "需要 OpenBuddy 2.x" })}
      />,
    );
    expect(screen.getByTestId("install-state").textContent).toBe("已阻止");
    expect(screen.getByTestId("marketplace-card-primary")).toBeDisabled();
    expect(screen.getByText("需要 OpenBuddy 2.x")).toBeTruthy();
  });

  it("routes install / update / open callbacks", () => {
    const onInstall = vi.fn();
    const onUpgrade = vi.fn();
    const onOpen = vi.fn();
    const { rerender } = render(
      <MarketplaceCard
        entry={entry()}
        onInstall={onInstall}
        onUpgrade={onUpgrade}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByTestId("marketplace-card-primary"));
    expect(onInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("marketplace-card-open"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    rerender(
      <MarketplaceCard
        entry={entry({ installedVersion: "1.0.0" })}
        onInstall={onInstall}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.click(screen.getByTestId("marketplace-card-primary"));
    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("exposes a rollback affordance when the market version is older", () => {
    const onRollback = vi.fn();
    const { rerender } = render(
      <MarketplaceCard entry={entry({ installedVersion: "2.0.0" })} onRollback={onRollback} />,
    );
    fireEvent.click(screen.getByTestId("marketplace-card-rollback"));
    expect(onRollback).toHaveBeenCalledTimes(1);

    // 市场版本更新时不显示回滚;未注入回调时同样不显示。
    rerender(
      <MarketplaceCard entry={entry({ installedVersion: "1.0.0" })} onRollback={onRollback} />,
    );
    expect(screen.queryByTestId("marketplace-card-rollback")).toBeNull();
    rerender(<MarketplaceCard entry={entry({ installedVersion: "2.0.0" })} />);
    expect(screen.queryByTestId("marketplace-card-rollback")).toBeNull();
  });

  it("prefers the installing prop over the derived state", () => {
    render(
      <MarketplaceCard
        entry={entry({ installedVersion: "1.0.0" })}
        installing
        onUpgrade={() => {}}
      />,
    );
    expect(screen.getByTestId("install-state").textContent).toBe("安装中");
    expect(screen.getByTestId("marketplace-card-primary")).toBeDisabled();
  });

  it("truncates capability chips and counts the rest", () => {
    render(
      <MarketplaceCard
        entry={entry({
          capabilities: [
            { id: "fs.read", label: "读文件", risk: "low" },
            { id: "fs.write", label: "写文件", risk: "medium" },
            { id: "shell.exec", label: "执行命令", risk: "high" },
            { id: "net.fetch", label: "联网", risk: "low" },
          ],
        })}
      />,
    );
    const chips = screen.getByTestId("capability-chips");
    expect(chips.textContent).toContain("+1");
    // 高风险能力优先进展示位。
    expect(chips.textContent).toContain("执行命令");
  });

  it("opens and closes the overflow menu", () => {
    const onSelect = vi.fn();
    render(
      <MarketplaceCard
        entry={entry()}
        menuItems={[
          { id: "details", label: "查看详情", onSelect },
          { id: "remove", label: "卸载", danger: true, onSelect },
        ]}
      />,
    );
    expect(screen.queryByTestId("marketplace-card-menu-list")).toBeNull();
    fireEvent.click(screen.getByTestId("marketplace-card-menu"));
    const menu = screen.getByTestId("marketplace-card-menu-list");
    expect(menu.textContent).toContain("查看详情");
    fireEvent.click(screen.getByText("卸载"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("pi-fs");
    // 选择后菜单自动收起。
    expect(screen.queryByTestId("marketplace-card-menu-list")).toBeNull();
  });

  it("closes the overflow menu on Escape", () => {
    render(
      <MarketplaceCard entry={entry()} menuItems={[{ id: "a", label: "A", onSelect: () => {} }]} />,
    );
    fireEvent.click(screen.getByTestId("marketplace-card-menu"));
    expect(screen.getByTestId("marketplace-card-menu-list")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("marketplace-card-menu-list")).toBeNull();
  });

  it("closes the overflow menu on outside mousedown", () => {
    render(
      <div>
        <MarketplaceCard
          entry={entry()}
          menuItems={[{ id: "a", label: "A", onSelect: () => {} }]}
        />
        <span data-testid="outside">out</span>
      </div>,
    );
    fireEvent.click(screen.getByTestId("marketplace-card-menu"));
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("marketplace-card-menu-list")).toBeNull();
  });

  it("hides the overflow button when no menu items exist", () => {
    render(<MarketplaceCard entry={entry()} />);
    expect(screen.queryByTestId("marketplace-card-menu")).toBeNull();
  });

  it("highlights search hits", () => {
    render(<MarketplaceCard entry={entry()} query="fs" />);
    expect(document.querySelectorAll("mark").length).toBeGreaterThan(0);
  });

  it("falls back to the first letter when no icon is provided", () => {
    render(<MarketplaceCard entry={entry({ icon: undefined })} />);
    expect(screen.getByText("P")).toBeTruthy();
    cleanup();
    render(<MarketplaceCard entry={entry({ icon: "🔧" })} />);
    expect(screen.getByText("🔧")).toBeTruthy();
  });

  it("renders list layout and install size", () => {
    render(<MarketplaceCard layout="list" entry={entry({ installedBytes: 2048 })} />);
    expect(screen.getByTestId("marketplace-card").className).toContain("list");
    expect(screen.getByText("2 KB")).toBeTruthy();
  });
});
