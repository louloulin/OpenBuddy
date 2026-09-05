// @vitest-environment node
/**
 * Tests for the Pi marketplace (pi.dev remote catalog + local sources).
 *
 * The marketplace implementation lives in `electron/main/agent/pi-resources.ts`
 * but only a small slice of that module — the HTML parser, the remote
 * scanner, and the on-disk config helpers — can be exercised without
 * booting the full Electron main process. The rest is validated by the
 * `agent-session-mutations-ipc-dispatch-realserver` suite through the
 * `marketplace_list` / `marketplace_action` IPC handlers.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const marketplaceCacheDir = vi.hoisted(() => ({ path: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-marketplace-test", on: vi.fn(), exit: vi.fn(), setPath: vi.fn(), quit: vi.fn() },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  clipboard: { writeText: vi.fn(), readText: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSession: vi.fn(),
    DefaultResourceLoader: vi.fn(),
    SessionManager: vi.fn(),
    ModelRuntime: vi.fn(),
    ModelRegistry: vi.fn(),
  };
});

vi.mock("@openbuddy/cordis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/cordis")>();
  return { ...actual, Context: vi.fn() };
});

vi.mock("@openbuddy/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/storage")>();
  return { ...actual, HarnessCursorStore: vi.fn() };
});

vi.mock("@openbuddy/team-team", () => ({}));
vi.mock("@openbuddy/plugin-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openbuddy/plugin-host")>();
  return actual;
});

vi.mock("../casdoor/casdoor-auth", () => ({
  casdoorAuth: {
    status: vi.fn().mockReturnValue({ config: { configured: true, issuer: "" }, identity: null, tenantContext: { activeTenantId: "" } }),
    setStatusListener: vi.fn(),
  },
}));

import {
  marketplaceScanRemote,
  parsePiDevPackageNames,
  parsePiDevPackagesFromHtml,
  aggregateFromFirstHtml,
  looksLikeFullPiDevHtml,
  fetchAndAggregateRemoteCatalog,
} from "../agent/pi-resources";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "agent", "__tests__", "__fixtures__");

const PI_DEV_HTML = `<!doctype html>
<html><body>
<a href="/packages/pi-session-only-model" data-package-link="true">a</a>
<a href="/packages/pi-mcp-adapter" data-package-link="true">b</a>
<a href="/packages/pi-memory" data-package-link="true">c</a>
<a href="/packages/pi-memory?ref=main" data-package-link="true">c dup with query</a>
<a href="/packages/pi-memory#readme" data-package-link="true">c dup with fragment</a>
<a href="/packages/pi%2Dfabric" data-package-link="true">d</a>
<a href="/not-packages/foo">ignored</a>
<a href="/packages/">empty name</a>
</body></html>`;

describe("pi marketplace (pi.dev) helpers", () => {
  it("extracts /packages/<name> anchors, dedupes, and decodes URL escapes", () => {
    const names = parsePiDevPackageNames(PI_DEV_HTML);
    expect(names).toEqual([
      "pi-session-only-model",
      "pi-mcp-adapter",
      "pi-memory",
      "pi-fabric",
    ]);
    // sanity: the same name referenced twice (with query/fragment) collapses to one
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns an empty list when the HTML has no /packages anchors", () => {
    expect(parsePiDevPackageNames("<html><body>hello</body></html>")).toEqual([]);
  });
});

describe("marketplaceScanRemote", () => {
  beforeEach(async () => {
    marketplaceCacheDir.path = await mkdtemp(join(tmpdir(), "openbuddy-mkt-cache-"));
    process.env.PI_CODING_AGENT_DIR = marketplaceCacheDir.path;
  });
  afterEach(() => {
    delete process.env.PI_CODING_AGENT_DIR;
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  function makeFetchMock(html: string, registryIndex: Record<string, unknown>): typeof fetch {
    return (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pi.dev/packages") return new Response(html, { status: 200 });
      if (url.startsWith("https://registry.npmjs.org/")) {
        const name = decodeURIComponent(url.slice("https://registry.npmjs.org/".length));
        const data = registryIndex[name];
        if (!data) return jsonResponse({ error: "not_found" }, 404);
        return jsonResponse(data);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
  }

  it("parses pi.dev anchors, enriches via npm registry, and writes a cache file", async () => {
    const registry = {
      "pi-memory": {
        name: "pi-memory",
        description: "Persistent memory for pi",
        homepage: "https://example/pi-memory",
        repository: { url: "git+https://example/pi-memory.git" },
        keywords: ["pi-package", "memory"],
        "dist-tags": { latest: "1.2.3" },
        versions: { "1.2.3": { dist: { tarball: "https://registry.npmjs.org/pi-memory/-/pi-memory-1.2.3.tgz" } } },
      },
      "pi-mcp-adapter": {
        name: "pi-mcp-adapter",
        description: "MCP bridge",
        "dist-tags": { latest: "0.9.0" },
        versions: { "0.9.0": { dist: { tarball: "https://registry.npmjs.org/pi-mcp-adapter/-/pi-mcp-adapter-0.9.0.tgz" } } },
      },
    };
    const fetchMock = makeFetchMock(PI_DEV_HTML, registry);

    const first = await marketplaceScanRemote("https://pi.dev/packages", { force: true, fetchImpl: fetchMock });
    expect(first.entries.map((entry) => entry.name)).toEqual(["pi-mcp-adapter", "pi-memory"]);
    expect(first.entries[0]?.version).toBe("0.9.0");
    expect(first.entries[0]?.tarball).toContain("pi-mcp-adapter-0.9.0.tgz");
    expect(typeof first.refreshedAt).toBe("string");
    expect(new Date(first.refreshedAt).getTime()).not.toBeNaN();

    const cachePath = join(marketplaceCacheDir.path, "marketplace-cache.json");
    const cacheRaw = JSON.parse(await readFile(cachePath, "utf8")) as { caches?: Array<{ sourceUrl: string; entries: Array<{ name: string }>; fetchedAt: string }> };
    const cached = cacheRaw.caches?.find((entry) => entry.sourceUrl === "https://pi.dev/packages");
    expect(cached?.entries.map((entry) => entry.name)).toEqual(["pi-mcp-adapter", "pi-memory"]);
    // Cache and scanner both call `new Date().toISOString()` independently
    // so they can drift by a few ms; assert they are within the same second.
    expect(Math.abs(Date.parse(cached!.fetchedAt) - Date.parse(first.refreshedAt))).toBeLessThan(1000);

    // second call without force reuses the warm cache (no new fetch)
    const second = await marketplaceScanRemote("https://pi.dev/packages", { fetchImpl: fetchMock });
    expect(second.refreshedAt).toBe(first.refreshedAt);
    expect(second.entries.map((entry) => entry.name)).toEqual(["pi-mcp-adapter", "pi-memory"]);

    // forcing a refresh always re-fetches
    let fetchCount = 0;
    const countingFetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://pi.dev/packages") fetchCount += 1;
      return makeFetchMock(PI_DEV_HTML, registry)(input);
    }) as unknown as typeof fetch;
    await marketplaceScanRemote("https://pi.dev/packages", { force: true, fetchImpl: countingFetch });
    expect(fetchCount).toBe(1);
  });

  it("parses total package count and pagination from a real pi.dev packages-count element", async () => {
    // Real pi.dev first page (saved to fixtures on 2026-09-02). The exact
    // headline is `<span class="packages-count">1-50 / 5573</span>`. The
    // last visible paginated link is `>112<` so we expect totalPages=112.
    const html = await readFile(join(FIXTURE_DIR, "pi-dev-packages-page-1.html"), "utf8");
    const page = parsePiDevPackagesFromHtml(html, 1);
    expect(page.totalPackages).toBe(5573);
    expect(page.totalPages).toBe(112);
    expect(page.packages.length).toBe(50);
    // First card is the highest-downloads package: pi-mcp-adapter. Verify
    // we lifted every field from the HTML without ever calling npm.
    const first = page.packages[0];
    expect(first?.name).toBe("pi-mcp-adapter");
    expect(first?.author).toBe("nicopreme");
    expect(first?.downloads).toBe("761.4K/mo");
    expect(first?.type).toBe("extension");
    expect(first?.repoUrl).toBe("https://github.com/nicobailon/pi-mcp-adapter");
    expect(first?.npmUrl).toBe("https://www.npmjs.com/package/pi-mcp-adapter");
  });

  it("aggregates packages across multiple pages without calling npm registry", async () => {
    // Promote the third page's headline + pagination to a small catalog so
    // the aggregator only fetches 3 pages (instead of all 112). The body of
    // each fixture is real pi.dev HTML so we still exercise the parser end-to-end.
    const page1 = await readFile(join(FIXTURE_DIR, "pi-dev-packages-page-1.html"), "utf8");
    const page2 = await readFile(join(FIXTURE_DIR, "pi-dev-packages-page-2.html"), "utf8");
    const page3 = await readFile(join(FIXTURE_DIR, "pi-dev-packages-page-3.html"), "utf8");
    // Rewrite the packages-count headline so the catalog announces "1-50 / 137".
    // The page body still has 50 real cards; only the headline + total count moves.
    const clipCount = (html: string, countText: string) =>
      html.replace(/<span class="packages-count"[^>]*>[\s\S]*?<\/span>/, () => `<span class="packages-count">${countText}</span>`);
    void page2;
    void page3;
    const sources = {
      "https://pi.dev/packages": clipCount(page1, "1-50 / 137"),
    };

    let npmFetches = 0;
    let htmlFetches = 0;
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("registry.npmjs.org")) npmFetches += 1;
      else htmlFetches += 1;
      const body = sources[url as keyof typeof sources];
      if (!body) throw new Error(`unexpected fetch: ${url}`);
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    });

    const aggregate = await fetchAndAggregateRemoteCatalog("https://pi.dev/packages", fetchMock);
    expect(aggregate.totalPackages).toBe(137);
    const names = aggregate.entries.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    // The first card of page 1 should be the highest-downloads package — no
    // npm registry detour required, so we never hit registry.npmjs.org.
    expect(aggregate.entries[0]?.name).toBe("pi-mcp-adapter");
    expect(npmFetches).toBe(0);
    expect(htmlFetches).toBeGreaterThanOrEqual(1);
  });

  it("falls back gracefully on the last page (23 cards) without inflating totals", async () => {
    // Page 112 renders `5551-5573 / 5573` — only 23 cards, the partial tail.
    // Verifies the parser handles short pages and doesn't lose totalPackages
    // when most of the catalog has already been loaded.
    const html = await readFile(join(FIXTURE_DIR, "pi-dev-packages-page-112.html"), "utf8");
    const page = parsePiDevPackagesFromHtml(html, 112);
    expect(page.totalPackages).toBe(5573);
    expect(page.totalPages).toBe(112);
    expect(page.packages.length).toBeLessThanOrEqual(50); /* pi.dev page size */
    expect(looksLikeFullPiDevHtml(html)).toBe(true);
    expect(page.packages.length).toBeGreaterThan(0);
  });
  it("tolerates individual npm registry failures so one missing package does not block the list", async () => {
    const registry = {
      "pi-memory": {
        name: "pi-memory",
        "dist-tags": { latest: "1.0.0" },
        versions: { "1.0.0": { dist: { tarball: "https://example/pi-memory.tgz" } } },
      },
      // pi-mcp-adapter missing → 404
    };
    const fetchMock = makeFetchMock(PI_DEV_HTML, registry);
    const result = await marketplaceScanRemote("https://pi.dev/packages", { force: true, fetchImpl: fetchMock });
    expect(result.entries.map((entry) => entry.name)).toEqual(["pi-memory"]);
  });
});
