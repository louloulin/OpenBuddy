/**
 * PiMarketTab footer 分页单测 — 验证 P3 修复(底部翻页)。
 * 用 pageSize=3 让 6+ 条 fixture 强制多页。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiMarketTab } from "../PiMarketTab";
import type { MarketplaceEntry } from "../../marketplace-model";

afterEach(() => cleanup());

const ENTRIES: MarketplaceEntry[] = Array.from({ length: 6 }).map((_, i) => ({
  id: `pkg-${i}`,
  name: `Package ${i}`,
  publisher: "alice",
  description: `desc-${i}`,
  version: "1.0.0",
  kinds: ["extension"],
  primaryKind: "extension",
  updatedAt: new Date(Date.now() - i * 3600_000).toISOString(),
}));

describe("PiMarketTab footer pager", () => {
  it("renders bottom pager only when totalPages > 1", () => {
    const { rerender } = render(<PiMarketTab entries={ENTRIES} hookOptions={{ pageSize: 50 }} />);
    expect(screen.queryByTestId("pi-market-page-prev-bottom")).toBeNull();
    expect(screen.queryByTestId("pi-market-page-next-bottom")).toBeNull();

    rerender(<PiMarketTab entries={ENTRIES} hookOptions={{ pageSize: 3 }} />);
    expect(screen.getByTestId("pi-market-page-prev-bottom")).toBeTruthy();
    expect(screen.getByTestId("pi-market-page-next-bottom")).toBeTruthy();
  });

  it("bottom prev disabled on page 1, bottom next disabled on last page", () => {
    render(<PiMarketTab entries={ENTRIES} hookOptions={{ pageSize: 3 }} />);
    expect(screen.getByTestId("pi-market-page-prev-bottom")).toHaveAttribute("disabled");
    expect(screen.getByTestId("pi-market-page-next-bottom")).not.toHaveAttribute("disabled");
    fireEvent.click(screen.getByTestId("pi-market-page-next-bottom"));
    // page 2: prev enabled, next enabled (3/2 = 2 pages)
    expect(screen.getByTestId("pi-market-page-prev-bottom")).not.toHaveAttribute("disabled");
    fireEvent.click(screen.getByTestId("pi-market-page-next-bottom"));
    // page 2 of 2: next disabled
    expect(screen.getByTestId("pi-market-page-next-bottom")).toHaveAttribute("disabled");
  });

  it("footer text shows Showing X-Y of N · Page A of B", () => {
    render(<PiMarketTab entries={ENTRIES} hookOptions={{ pageSize: 3 }} />);
    const footer = screen.getByTestId("pi-market-footer");
    expect(footer.textContent).toContain("Showing 1-3 of 6");
    expect(footer.textContent).toContain("Page 1 of 2");
  });
});
