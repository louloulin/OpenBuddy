import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  readPiMarketUrlState,
  writePiMarketUrlState,
  usePiMarketUrlState,
} from "../usePiMarketUrlState";

afterEach(() => {
  // 清掉可能残留的 window history state
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
  }
});

describe("readPiMarketUrlState", () => {
  it("returns empty when search is empty / null / undefined", () => {
    expect(readPiMarketUrlState("")).toEqual({});
    expect(readPiMarketUrlState(null)).toEqual({});
    expect(readPiMarketUrlState(undefined)).toEqual({});
  });

  it("extracts pi.q / pi.t / pi.s / pi.p from a search string", () => {
    const out = readPiMarketUrlState("?pi.q=mcp&pi.t=extension&pi.s=name&pi.p=3");
    expect(out).toEqual({
      initialQuery: "mcp",
      initialType: "extension",
      initialSort: "name",
      initialPage: 3,
    });
  });

  it("accepts a URLSearchParams instance too", () => {
    const params = new URLSearchParams("pi.q=foo&pi.t=theme");
    expect(readPiMarketUrlState(params)).toEqual({
      initialQuery: "foo",
      initialType: "theme",
    });
  });

  it("rejects invalid type / sort / page values", () => {
    const out = readPiMarketUrlState("?pi.t=unknown&pi.s=invalid&pi.p=-3&pi.p=NaN");
    // 不在白名单的字段全部丢弃,parseInt NaN 也丢弃
    expect(out).toEqual({});
  });

  it("keeps valid params even when others are invalid", () => {
    const out = readPiMarketUrlState("?pi.q=hi&pi.t=bogus&pi.s=downloads&pi.p=2");
    expect(out).toEqual({
      initialQuery: "hi",
      initialSort: "downloads",
      initialPage: 2,
    });
  });
});

describe("writePiMarketUrlState", () => {
  it("writes the given params into window.location.search via replaceState", () => {
    if (typeof window === "undefined") return;
    writePiMarketUrlState({
      initialQuery: "mcp",
      initialType: "extension",
      initialSort: "recent",
      initialPage: 2,
    });
    expect(window.location.search).toContain("pi.q=mcp");
    expect(window.location.search).toContain("pi.t=extension");
    expect(window.location.search).toContain("pi.s=recent");
    expect(window.location.search).toContain("pi.p=2");
  });

  it("drops page=1 from the URL (default value should not pollute)", () => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/");
    writePiMarketUrlState({ initialPage: 1 });
    expect(window.location.search).not.toContain("pi.p=");
  });

  it("preserves unrelated params", () => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/?other=keep&theme=dark");
    writePiMarketUrlState({ initialQuery: "mcp" });
    expect(window.location.search).toContain("other=keep");
    expect(window.location.search).toContain("theme=dark");
    expect(window.location.search).toContain("pi.q=mcp");
  });
});

describe("usePiMarketUrlState", () => {
  it("reads initial state from window.location.search when enabled", () => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/?pi.q=adapter&pi.t=theme&pi.p=4");
    const { result } = renderHook(() => usePiMarketUrlState());
    expect(result.current).toEqual({
      initialQuery: "adapter",
      initialType: "theme",
      initialPage: 4,
    });
  });

  it("returns empty when enabled=false", () => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/?pi.q=adapter");
    const { result } = renderHook(() => usePiMarketUrlState({ enabled: false }));
    expect(result.current).toEqual({});
  });

  it("does NOT pollute URL on mount when params are empty", () => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", "/?other=keep");
    renderHook(() => usePiMarketUrlState());
    expect(window.location.search).not.toMatch(/pi\./);
    expect(window.location.search).toContain("other=keep");
  });
});
