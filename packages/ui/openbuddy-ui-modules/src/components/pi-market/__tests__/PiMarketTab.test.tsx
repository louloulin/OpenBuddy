import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiMarketTab } from "../PiMarketTab";
import type { MarketplaceEntry } from "../../marketplace-model";

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
  }
});

const ENTRIES: MarketplaceEntry[] = [
  {
    id: "pi-mcp-adapter",
    name: "pi-mcp-adapter",
    publisher: "nicopreme",
    description: "MCP adapter for Pi",
    version: "2.37.0",
    kinds: ["extension"],
    primaryKind: "extension",
    npmName: "pi-mcp-adapter",
    downloadsLastMonth: 1_000_000,
    updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  },
  {
    id: "pi-fabric",
    name: "pi-fabric",
    publisher: "monotykamary",
    description: "Custom runtime for Pi",
    version: "0.93.0",
    kinds: ["extension"],
    primaryKind: "extension",
    npmName: "pi-fabric",
    downloadsLastMonth: 22_600,
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "hotmilk",
    name: "hotmilk",
    publisher: "earendil",
    description: "Pi meta-package with prompts, skills, themes",
    version: "0.1.0",
    kinds: ["plugin"],
    primaryKind: "plugin",
    npmName: "hotmilk",
    downloadsLastMonth: 1_200,
    updatedAt: new Date(Date.now() - 9 * 60 * 1000).toISOString(),
  },
];

describe("PiMarketTab", () => {
  it("renders the hero + toolbar + recently published + main list", () => {
    render(<PiMarketTab entries={ENTRIES} />);
    expect(screen.getByTestId("pi-market-toolbar")).toBeTruthy();
    expect(screen.getByTestId("pi-recently-published")).toBeTruthy();
    expect(screen.getByTestId("pi-market-results")).toBeTruthy();
    expect(screen.getAllByTestId("pi-package-card").length).toBe(3);
    expect(screen.getByTestId("pi-market-range").textContent).toBe("1-3 / 3");
  });

  it("shows the empty state when no entries", () => {
    render(<PiMarketTab entries={[]} />);
    expect(screen.getByTestId("pi-market-empty")).toBeTruthy();
  });

  it("shows loading skeletons when loading=true", () => {
    render(<PiMarketTab entries={[]} loading />);
    expect(screen.getByTestId("pi-market-loading")).toBeTruthy();
  });

  it("shows error message with retry button", () => {
    render(<PiMarketTab entries={[]} error="network down" onRetry={() => {}} />);
    const error = screen.getByTestId("pi-market-error");
    expect(error.textContent).toContain("network down");
    expect(screen.getByTestId("pi-market-retry")).toBeTruthy();
  });

  it("shows the refresh hint (not skeletons) when refreshing with existing entries", () => {
    render(<PiMarketTab entries={ENTRIES} loading />);
    expect(screen.queryByTestId("pi-market-loading")).toBeNull();
    const hint = screen.getByTestId("pi-market-refreshing");
    expect(hint.getAttribute("role")).toBe("status");
    expect(hint.getAttribute("aria-live")).toBe("polite");
    // entries should still be visible during refresh
    expect(screen.getAllByTestId("pi-package-card").length).toBe(3);
  });

  it("Clear-filters button shows in empty state when filters are active, and resets them", () => {
    render(<PiMarketTab entries={ENTRIES} hookOptions={{ initialQuery: "nope-no-match" }} />);
    // Empty state visible
    const empty = screen.getByTestId("pi-market-empty");
    expect(empty).toBeTruthy();
    // Clear button visible because query is non-default
    const clearBtn = screen.getByTestId("pi-market-clear-filters");
    expect(clearBtn).toBeTruthy();
    // Click it → filters reset → cards reappear
    fireEvent.click(clearBtn);
    expect(screen.queryByTestId("pi-market-empty")).toBeNull();
    expect(screen.getAllByTestId("pi-package-card").length).toBe(3);
  });

  it("Clear-filters button does NOT show when no filters are active (unfiltered empty)", () => {
    render(<PiMarketTab entries={[]} />);
    expect(screen.getByTestId("pi-market-empty")).toBeTruthy();
    expect(screen.queryByTestId("pi-market-clear-filters")).toBeNull();
  });

  it("installingIds marks matching cards as installing (disabled + 安装中… label)", () => {
    const onInstall = vi.fn();
    // Install 按钮只在 community / local 源上渲染,把 ENTRIES 转成 community。
    const communityEntries = ENTRIES.map((entry) => ({ ...entry, sourceKind: "community" as const }));
    render(
      <PiMarketTab
        entries={communityEntries}
        onInstall={onInstall}
        installingIds={[communityEntries[0].id]}
      />,
    );
    const firstInstall = document.querySelector(
      `[data-entry-id="${communityEntries[0].id}"] [data-testid="pi-package-install"]`,
    ) as HTMLButtonElement | null;
    expect(firstInstall).toBeTruthy();
    expect(firstInstall?.disabled).toBe(true);
    expect(firstInstall?.textContent).toContain("安装中");
    // 第二张卡片也是 community,但不在 installingIds,按钮可用。
    const secondInstall = document.querySelector(
      `[data-entry-id="${communityEntries[1].id}"] [data-testid="pi-package-install"]`,
    ) as HTMLButtonElement | null;
    expect(secondInstall).toBeTruthy();
    expect(secondInstall?.disabled).toBe(false);
  });
});

describe("PiMarketTab urlSync", () => {
  it("writes query / type / sort / page to window.location.search when urlSync=true", () => {
    // 关 debounce 让 URL sync 同步生效,本测试专注 sync 行为。
    render(<PiMarketTab entries={ENTRIES} urlSync queryDebounceMs={0} />);
    fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "mcp" } });
    expect(window.location.search).toContain("pi.q=mcp");
    fireEvent.change(screen.getByTestId("pi-market-type-filter"), { target: { value: "extension" } });
    expect(window.location.search).toContain("pi.t=extension");
    fireEvent.change(screen.getByTestId("pi-market-sort"), { target: { value: "name" } });
    expect(window.location.search).toContain("pi.s=name");
  });

  it("does NOT touch window.location when urlSync is omitted", () => {
    render(<PiMarketTab entries={ENTRIES} />);
    fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "mcp" } });
    expect(window.location.search).not.toContain("pi.q=");
  });
});

describe("PiMarketTab queryDebounceMs (R88-1)", () => {
  it("debounces URL writes by the configured delay", () => {
    vi.useFakeTimers();
    try {
      render(<PiMarketTab entries={ENTRIES} urlSync queryDebounceMs={200} />);
      // 输入 mcp,200ms 内 URL 不应该被写
      fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "mcp" } });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(window.location.search).not.toContain("pi.q=");
      // 继续敲到 mcp-server,前一次的 debounce timer 被重置
      fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "mcp-server" } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(window.location.search).not.toContain("pi.q=");
      // 再过 200ms 才触发最后一次写
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(window.location.search).toContain("pi.q=mcp-server");
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounceMs=0 disables debounce (immediate URL write)", () => {
    render(<PiMarketTab entries={ENTRIES} urlSync queryDebounceMs={0} />);
    fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "mcp" } });
    expect(window.location.search).toContain("pi.q=mcp");
  });
});