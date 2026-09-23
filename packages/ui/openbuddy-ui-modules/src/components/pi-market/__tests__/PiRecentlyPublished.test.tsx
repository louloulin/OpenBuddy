import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PiRecentlyPublished } from "../PiRecentlyPublished";
import type { MarketplaceEntry } from "../../marketplace-model";

afterEach(() => cleanup());

const ENTRIES: MarketplaceEntry[] = [
  {
    id: "a",
    name: "alpha-mcp",
    publisher: "alice",
    description: "MCP integration for testing",
    version: "0.1.0",
    kinds: ["plugin"],
    primaryKind: "plugin",
    updatedAt: "2026-09-23T08:00:00Z",
  },
  {
    id: "b",
    name: "beta-theme",
    publisher: "bob",
    description: "A theme with mcp-style highlights",
    version: "1.2.0",
    kinds: ["theme"],
    primaryKind: "theme",
    updatedAt: "2026-09-23T07:00:00Z",
  },
  {
    id: "c",
    name: "gamma",
    publisher: "carol",
    description: "totally unrelated",
    version: "0.0.1",
    kinds: ["plugin"],
    primaryKind: "plugin",
    updatedAt: "2026-09-22T08:00:00Z",
  },
];

describe("PiRecentlyPublished", () => {
  it("renders nothing when entries are all empty updatedAt", () => {
    render(<PiRecentlyPublished entries={[{ ...ENTRIES[0], updatedAt: undefined }]} />);
    expect(screen.queryByTestId("pi-recently-published")).toBeNull();
  });

  it("shows recent entries sorted by updatedAt desc", () => {
    render(<PiRecentlyPublished entries={ENTRIES} />);
    const links = screen.getAllByTestId("pi-recently-link");
    expect(links).toHaveLength(3);
    // entries have same updatedAt order: a (08:00) > b (07:00) > c (22:00 prev day)
    expect(links[0].getAttribute("data-entry-id")).toBe("a");
  });

  it("limits to max (default 7)", () => {
    const many: MarketplaceEntry[] = Array.from({ length: 12 }, (_, i) => ({
      ...ENTRIES[0],
      id: `p-${i}`,
      name: `pkg-${i}`,
      updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }));
    render(<PiRecentlyPublished entries={many} />);
    expect(screen.getAllByTestId("pi-recently-link")).toHaveLength(7);
  });

  it("highlights query matches in name and description", () => {
    render(<PiRecentlyPublished entries={ENTRIES} query="mcp" />);
    // alpha-mcp's name contains mcp + description contains "MCP"
    const links = screen.getAllByTestId("pi-recently-link");
    // beta-theme's description contains "mcp-style" too
    expect(links[0].innerHTML).toMatch(/<mark[^>]*>mcp<\/mark>/i);
    expect(links[1].innerHTML).toMatch(/<mark[^>]*>mcp<\/mark>/i);
    // gamma has no match — no mark
    expect(links[2].innerHTML).not.toMatch(/<mark/i);
  });

  it("does NOT highlight when query is empty", () => {
    render(<PiRecentlyPublished entries={ENTRIES} query="" />);
    const links = screen.getAllByTestId("pi-recently-link");
    for (const link of links) {
      expect(link.innerHTML).not.toMatch(/<mark/i);
    }
  });

  it("calls onOpen with the right entry when clicked", () => {
    const onOpen = vi.fn();
    render(<PiRecentlyPublished entries={ENTRIES} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByTestId("pi-recently-link")[1]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(ENTRIES[1].id);
  });

  it("aria-label includes published age", () => {
    render(<PiRecentlyPublished entries={ENTRIES} />);
    const link = screen.getAllByTestId("pi-recently-link")[0];
    const label = link.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/Open alpha-mcp/);
    expect(label).toMatch(/published/);
  });
});
