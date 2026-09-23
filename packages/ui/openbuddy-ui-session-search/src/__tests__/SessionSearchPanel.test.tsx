/**
 * Tests for the session search UI panel.
 *
 * Covers:
 *   - empty state (no query)
 *   - search results render with highlights
 *   - keyboard navigation (Up/Down/Enter)
 *   - loading + error states
 *   - onOpen callback fires when user activates a hit
 *   - debouncing (rapid input → single search)
 *   - inputOnly mode skips results
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent, screen } from "@testing-library/react";

import { InMemorySessionSearchClient } from "../client.js";
import { SessionSearchPanel } from "../components/SessionSearchPanel.js";

describe("SessionSearchPanel", () => {
  let client: InMemorySessionSearchClient;
  beforeEach(() => {
    client = new InMemorySessionSearchClient();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function flush(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it("renders the input with placeholder", () => {
    render(<SessionSearchPanel client={client} autoFocus={false} />);
    const input = screen.getByTestId("session-search-input");
    expect(input).toBeTruthy();
    expect(input.getAttribute("placeholder")).toMatch(/search/i);
  });

  it("shows the empty state when no query is entered", () => {
    render(<SessionSearchPanel client={client} autoFocus={false} />);
    const empty = screen.getByTestId("session-search-empty");
    expect(empty.textContent).toMatch(/try a keyword/i);
  });

  it("renders search hits with highlights after debounce", async () => {
    client.addSession("s1", [
      { role: "user", content: "Find the rust compiler please" },
      { role: "assistant", content: "The Rust compiler is rustc." },
    ]);
    render(<SessionSearchPanel client={client} autoFocus={false} debounceMs={50} />);
    const input = screen.getByTestId("session-search-input");
    act(() => {
      fireEvent.change(input, { target: { value: "rust" } });
    });
    await flush(60);
    const hits = screen.getAllByTestId("session-search-hit");
    expect(hits.length).toBe(2);
    const firstHit = hits[0];
    expect(firstHit.querySelector("mark")?.textContent?.toLowerCase()).toBe("rust");
    expect(firstHit.textContent).toContain("Rust");
  });

  it("navigates with arrow keys and fires onOpen on Enter", async () => {
    client.addSession("s1", [
      { role: "user", content: "First hit candidate" },
      { role: "user", content: "Second hit candidate" },
    ]);
    const onOpen = vi.fn();
    render(<SessionSearchPanel client={client} autoFocus={false} debounceMs={50} onOpen={onOpen} />);
    const input = screen.getByTestId("session-search-input");
    act(() => {
      fireEvent.change(input, { target: { value: "hit" } });
    });
    await flush(60);
    screen.getAllByTestId("session-search-hit");
    const panel = screen.getByTestId("session-search-panel");
    act(() => {
      fireEvent.keyDown(panel, { key: "ArrowDown" });
    });
    act(() => {
      fireEvent.keyDown(panel, { key: "Enter" });
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].lineNo).toBe(2);
  });

  it("inputOnly mode skips the results section", async () => {
    render(<SessionSearchPanel client={client} autoFocus={false} inputOnly />);
    expect(screen.queryByTestId("session-search-results")).toBeNull();
    expect(screen.queryByTestId("session-search-empty")).toBeNull();
  });

  it("shows the loading label while searching (synchronous client)", async () => {
    const slow = {
      search: () => new Promise(() => {}), // never resolves
      message: async () => ({} as any),
    };
    render(<SessionSearchPanel client={slow as any} autoFocus={false} debounceMs={10} />);
    const input = screen.getByTestId("session-search-input");
    act(() => {
      fireEvent.change(input, { target: { value: "anything" } });
    });
    await flush(20);
    const loading = screen.getByTestId("session-search-loading");
    expect(loading.textContent).toMatch(/searching/i);
  });

  it("surfaces error state when the client rejects", async () => {
    const broken = {
      search: async () => { throw new Error("host-core down"); },
      message: async () => ({} as any),
    };
    render(<SessionSearchPanel client={broken as any} autoFocus={false} debounceMs={10} />);
    const input = screen.getByTestId("session-search-input");
    act(() => {
      fireEvent.change(input, { target: { value: "anything" } });
    });
    await flush(20);
    const err = screen.getByTestId("session-search-error");
    expect(err.textContent).toMatch(/host-core down/);
  });

  it("debounces rapid input changes to a single search call", async () => {
    const spy = vi.spyOn(client, "search");
    render(<SessionSearchPanel client={client} autoFocus={false} debounceMs={200} />);
    const input = screen.getByTestId("session-search-input");
    act(() => {
      fireEvent.change(input, { target: { value: "a" } });
    });
    await flush(50);
    act(() => {
      fireEvent.change(input, { target: { value: "ab" } });
    });
    await flush(50);
    act(() => {
      fireEvent.change(input, { target: { value: "abc" } });
    });
    // Before debounce expires: still 0 calls.
    expect(spy).not.toHaveBeenCalled();
    await flush(250);
    // After debounce expires: exactly 1 call with the latest value.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("abc");
  });
});
