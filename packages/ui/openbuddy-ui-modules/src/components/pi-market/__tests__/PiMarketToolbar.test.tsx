import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiMarketToolbar, DEFAULT_LABELS } from "../PiMarketToolbar";

afterEach(() => cleanup());

const noop = () => {};

describe("PiMarketToolbar", () => {
  it("renders the hero, search, type select, sort select and pagination", () => {
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5697}
        onPageChange={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Package Catalog");
    expect(screen.getByTestId("pi-market-search")).toBeTruthy();
    expect(screen.getByTestId("pi-market-type-filter")).toBeTruthy();
    expect(screen.getByTestId("pi-market-sort")).toBeTruthy();
    expect(screen.getByTestId("pi-market-range").textContent).toBe("1-50 / 5697");
  });

  it("forwards query + type + sort + page changes", () => {
    const onQueryChange = vi.fn();
    const onTypeFilterChange = vi.fn();
    const onSortChange = vi.fn();
    const onPageChange = vi.fn();
    render(
      <PiMarketToolbar
        query="mcp"
        onQueryChange={onQueryChange}
        typeFilter="extension"
        onTypeFilterChange={onTypeFilterChange}
        sort="recent"
        onSortChange={onSortChange}
        page={2}
        pageSize={50}
        total={120}
        onPageChange={onPageChange}
      />,
    );
    fireEvent.change(screen.getByTestId("pi-market-search"), { target: { value: "theme" } });
    expect(onQueryChange).toHaveBeenCalledWith("theme");
    fireEvent.change(screen.getByTestId("pi-market-type-filter"), { target: { value: "theme" } });
    expect(onTypeFilterChange).toHaveBeenCalledWith("theme");
    fireEvent.change(screen.getByTestId("pi-market-sort"), { target: { value: "name" } });
    expect(onSortChange).toHaveBeenCalledWith("name");
    fireEvent.click(screen.getByTestId("pi-market-page-next"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("disables prev on page 1 and next on last page", () => {
    const { rerender } = render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5697}
        onPageChange={noop}
      />,
    );
    expect(screen.getByTestId("pi-market-page-prev")).toHaveAttribute("disabled");

    rerender(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={114}
        pageSize={50}
        total={5697}
        onPageChange={noop}
      />,
    );
    expect(screen.getByTestId("pi-market-page-next")).toHaveAttribute("disabled");
  });

  it("renders the default labels object", () => {
    expect(DEFAULT_LABELS.installHint).toBe("Install with");
    expect(DEFAULT_LABELS.searchPlaceholder).toContain("筛选");
  });

  it("clears the search when Escape is pressed and the input is non-empty", () => {
    const onQueryChange = vi.fn();
    render(
      <PiMarketToolbar
        query="mcp"
        onQueryChange={onQueryChange}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    const input = screen.getByTestId("pi-market-search");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("does NOT clear the search when Escape is pressed and the input is empty", () => {
    const onQueryChange = vi.fn();
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={onQueryChange}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    const input = screen.getByTestId("pi-market-search");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("shows a friendly label when total is 0", () => {
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={0}
        onPageChange={noop}
      />,
    );
    expect(screen.getByTestId("pi-market-range").textContent).toBe("0 packages");
  });

  it("hides prev/next buttons when total is 0 (no useful pager)", () => {
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={0}
        onPageChange={noop}
      />,
    );
    expect(screen.queryByTestId("pi-market-page-prev")).toBeNull();
    expect(screen.queryByTestId("pi-market-page-next")).toBeNull();
    // range indicator still rendered ("0 packages")
    expect(screen.getByTestId("pi-market-range").textContent).toBe("0 packages");
  });

  it("renders the search-clear button with data-testid when query is non-empty", () => {
    const onQueryChange = vi.fn();
    render(
      <PiMarketToolbar
        query="mcp"
        onQueryChange={onQueryChange}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    const btn = screen.getByTestId("pi-market-search-clear");
    expect(btn.getAttribute("aria-label")).toBe("清除筛选");
    fireEvent.click(btn);
    expect(onQueryChange).toHaveBeenCalledWith("");
  });

  it("does NOT render the search-clear button when query is empty", () => {
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    expect(screen.queryByTestId("pi-market-search-clear")).toBeNull();
  });

  it("offers Oldest first as a sort option (R88-2)", () => {
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={noop}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    const sort = screen.getByTestId("pi-market-sort") as HTMLSelectElement;
    const values = Array.from(sort.querySelectorAll("option")).map((opt) => opt.value);
    expect(values).toContain("oldest");
    const oldestOption = sort.querySelector('option[value="oldest"]') as HTMLOptionElement;
    expect(oldestOption.textContent).toBe("Oldest first");
  });

  it("forwards 'oldest' sort change to host", () => {
    const onSortChange = vi.fn();
    render(
      <PiMarketToolbar
        query=""
        onQueryChange={noop}
        typeFilter="all"
        onTypeFilterChange={noop}
        sort="downloads"
        onSortChange={onSortChange}
        page={1}
        pageSize={50}
        total={5}
        onPageChange={noop}
      />,
    );
    fireEvent.change(screen.getByTestId("pi-market-sort"), { target: { value: "oldest" } });
    expect(onSortChange).toHaveBeenCalledWith("oldest");
  });
});
