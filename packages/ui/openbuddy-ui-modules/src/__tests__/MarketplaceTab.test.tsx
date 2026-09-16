import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MarketplaceTab, type MarketplaceTabProps } from "../components/MarketplaceTab";
import type { MarketplaceEntry } from "../components/marketplace-model";

afterEach(() => cleanup());

const ENTRIES: MarketplaceEntry[] = [
  {
    id: "pi-fs",
    name: "Pi FS Tools",
    publisher: "openbuddy",
    description: "文件系统读写工具集",
    version: "1.2.0",
    kinds: ["plugin"],
    capabilities: [{ id: "fs.write", label: "写文件", risk: "medium" }],
  },
  {
    id: "theme-sakura",
    name: "Sakura Theme",
    publisher: "moe",
    description: "樱花主题",
    version: "2.0.0",
    kinds: ["theme"],
    installedVersion: "2.0.0",
  },
  {
    id: "mcp-browser",
    name: "Browser MCP",
    publisher: "moe",
    description: "浏览器自动化",
    version: "1.2.0",
    kinds: ["mcp"],
    installedVersion: "1.0.0",
    capabilities: [{ id: "net.fetch", label: "联网", risk: "high" }],
  },
];

function renderTab(overrides: Partial<MarketplaceTabProps> = {}) {
  const props: MarketplaceTabProps = {
    entries: ENTRIES,
    query: "",
    onQueryChange: () => {},
    kindFilter: [],
    onKindFilterChange: () => {},
    ...overrides,
  };
  return render(<MarketplaceTab {...props} />);
}

describe("MarketplaceTab", () => {
  it("renders every entry with a result count", () => {
    renderTab();
    expect(screen.getByTestId("marketplace-results")).toBeTruthy();
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(3);
    expect(screen.getByTestId("marketplace-footer").textContent).toContain("共 3 个条目");
  });

  it("reports query changes and renders the clear button", () => {
    const onQueryChange = vi.fn();
    renderTab({ query: "fs", onQueryChange });
    fireEvent.change(screen.getByTestId("marketplace-search"), { target: { value: "fs tools" } });
    expect(onQueryChange).toHaveBeenCalledWith("fs tools");
    fireEvent.click(screen.getByLabelText("清空搜索"));
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("toggles kind filters through the owner callback", () => {
    const onKindFilterChange = vi.fn();
    const { rerender } = renderTab({ onKindFilterChange });
    fireEvent.click(screen.getByTestId("marketplace-kind-theme"));
    expect(onKindFilterChange).toHaveBeenCalledWith(["theme"]);

    rerender(
      <MarketplaceTab
        entries={ENTRIES}
        query=""
        onQueryChange={() => {}}
        kindFilter={["theme", "mcp"]}
        onKindFilterChange={onKindFilterChange}
      />,
    );
    fireEvent.click(screen.getByTestId("marketplace-kind-theme"));
    expect(onKindFilterChange).toHaveBeenLastCalledWith(["mcp"]);
  });

  it("disables kind chips with zero entries", () => {
    renderTab();
    expect(screen.getByTestId("marketplace-kind-skill")).toBeDisabled();
    expect(screen.getByTestId("marketplace-kind-plugin")).not.toBeDisabled();
  });

  it("applies the query as an uncontrolled visual filter", () => {
    renderTab({ query: "browser" });
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(1);
    expect(screen.getByTestId("marketplace-card").dataset.entryId).toBe("mcp-browser");
  });

  it("filters by kind through owner props", () => {
    renderTab({ kindFilter: ["theme"] });
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(1);
    expect(screen.getByTestId("marketplace-card").dataset.entryId).toBe("theme-sakura");
  });

  it("filters by capability using internal state", () => {
    renderTab();
    fireEvent.click(screen.getByText("能力", { selector: "summary" }));
    fireEvent.click(screen.getByLabelText("net.fetch"));
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(1);
    expect(screen.getByTestId("marketplace-card").dataset.entryId).toBe("mcp-browser");
  });

  it("filters by install state using internal state", () => {
    renderTab();
    fireEvent.click(screen.getByText("安装状态", { selector: "summary" }));
    fireEvent.click(screen.getByLabelText("可更新"));
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(1);
    expect(screen.getByTestId("marketplace-card").dataset.entryId).toBe("mcp-browser");
  });

  it("honours controlled capability filters", () => {
    const onCapabilityFilterChange = vi.fn();
    renderTab({ capabilityFilter: ["fs.write"], onCapabilityFilterChange });
    expect(screen.getAllByTestId("marketplace-card")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("net.fetch"));
    expect(onCapabilityFilterChange).toHaveBeenCalledWith(["fs.write", "net.fetch"]);
  });

  it("sorts via the sort select", () => {
    renderTab();
    fireEvent.change(screen.getByTestId("marketplace-sort"), { target: { value: "name" } });
    expect(screen.getAllByTestId("marketplace-card")[0].dataset.entryId).toBe("mcp-browser");
    fireEvent.change(screen.getByTestId("marketplace-sort"), { target: { value: "publisher" } });
    expect(screen.getAllByTestId("marketplace-card")[0].dataset.entryId).toBe("mcp-browser");
  });

  it("switches between grid and list layouts", () => {
    renderTab();
    expect(screen.getByTestId("marketplace-results").className).toContain("grid");
    fireEvent.click(screen.getByTestId("marketplace-view-list"));
    expect(screen.getByTestId("marketplace-results").className).toContain("list");
    expect(screen.getByTestId("marketplace-view-list").getAttribute("aria-pressed")).toBe("true");
  });

  it("wires card actions to the owner callbacks", () => {
    const onInstall = vi.fn();
    const onUpgrade = vi.fn();
    const onOpenItem = vi.fn();
    renderTab({ onInstall, onUpgrade, onOpenItem });
    // pi-fs 未安装 → 主操作是「安装」。
    const freshCard = document.querySelector<HTMLElement>('[data-entry-id="pi-fs"]')!;
    fireEvent.click(
      freshCard.querySelector<HTMLElement>('[data-testid="marketplace-card-primary"]')!,
    );
    expect(onInstall).toHaveBeenCalledTimes(1);
    fireEvent.click(freshCard.querySelector<HTMLElement>('[data-testid="marketplace-card-open"]')!);
    expect(onOpenItem).toHaveBeenCalledTimes(1);
    // 已安装且落后的条目 → 主操作是「更新」。
    const outdated = document.querySelector<HTMLElement>('[data-entry-id="mcp-browser"]')!;
    fireEvent.click(
      outdated.querySelector<HTMLElement>('[data-testid="marketplace-card-primary"]')!,
    );
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it("falls back to onInstall when no onUpgrade is provided", () => {
    const onInstall = vi.fn();
    renderTab({ onInstall });
    const updateCard = screen
      .getAllByTestId("marketplace-card-primary")
      .find((button) => button.getAttribute("data-action") === "upgrade")!;
    fireEvent.click(updateCard);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("marks installing entries from installingIds", () => {
    renderTab({ installingIds: ["pi-fs"] });
    const card = document.querySelector<HTMLElement>('[data-entry-id="pi-fs"]')!;
    expect(card.querySelector('[data-testid="install-state"]')?.textContent).toBe("安装中");
  });

  it("shows the loading skeleton", () => {
    renderTab({ loading: true, entries: [] });
    expect(screen.getByTestId("marketplace-loading")).toBeTruthy();
    expect(screen.queryByTestId("marketplace-results")).toBeNull();
  });

  it("shows the error state with retry", () => {
    const onRetry = vi.fn();
    renderTab({ error: "网络不可达", entries: [], onRetry });
    expect(screen.getByTestId("marketplace-error").textContent).toContain("网络不可达");
    fireEvent.click(screen.getByTestId("marketplace-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the error state without a retry button", () => {
    renderTab({ error: "boom", entries: [] });
    expect(screen.queryByTestId("marketplace-retry")).toBeNull();
  });

  it("shows distinct empty states for filtered vs empty markets", () => {
    const { rerender } = renderTab({ entries: [] });
    expect(screen.getByTestId("marketplace-empty").textContent).toContain("市场还是空的");
    rerender(
      <MarketplaceTab
        entries={ENTRIES}
        query="zzz"
        onQueryChange={() => {}}
        kindFilter={[]}
        onKindFilterChange={() => {}}
      />,
    );
    expect(screen.getByTestId("marketplace-empty").textContent).toContain("没有匹配的条目");
  });

  it("resets every filter from the reset button", () => {
    const onQueryChange = vi.fn();
    const onKindFilterChange = vi.fn();
    renderTab({ query: "fs", onQueryChange, kindFilter: ["plugin"], onKindFilterChange });
    fireEvent.click(screen.getByTestId("marketplace-reset"));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onKindFilterChange).toHaveBeenCalledWith([]);
  });

  it("renders owner-supplied menu items on cards", () => {
    const onSelect = vi.fn();
    renderTab({ menuItems: [{ id: "remove", label: "卸载", danger: true, onSelect }] });
    fireEvent.click(screen.getAllByTestId("marketplace-card-menu")[0]);
    fireEvent.click(screen.getByText("卸载"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("supports custom empty copy", () => {
    renderTab({ entries: [], emptyTitle: "没有可安装的扩展", emptyHint: "先添加市场源" });
    const empty = screen.getByTestId("marketplace-empty");
    expect(empty.textContent).toContain("没有可安装的扩展");
    expect(empty.textContent).toContain("先添加市场源");
  });
});
