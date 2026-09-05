import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/openbuddy-pi-resources-test" },
  safeStorage: { isEncryptionAvailable: () => false },
}));

vi.mock("../../casdoor/casdoor-auth", () => ({
  casdoorAuth: {
    status: () => ({ config: { configured: false }, identity: null, tenantContext: { activeTenantId: undefined } }),
  },
}));

const originalPiHome = process.env.PI_HOME;
const originalPiAgent = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalPiHome === undefined) delete process.env.PI_HOME;
  else process.env.PI_HOME = originalPiHome;
  if (originalPiAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalPiAgent;
});

async function loadResources() {
  return import("./pi-resources");
}

async function makeFakeFetch(htmlForPage: (page: number) => string): Promise<{ fetchImpl: typeof fetch; calls: number[]; inflight: { current: number; max: number } }> {
  const inflight = { current: 0, max: 0 };
  const calls: number[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const pageMatch = /[?&]page=(\d+)/.exec(url);
    const page = pageMatch ? Number(pageMatch[1]) : 1;
    calls.push(page);
    inflight.current += 1;
    inflight.max = Math.max(inflight.max, inflight.current);
    try {
      // Honor AbortSignal — reject immediately if aborted.
      if (init?.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      const html = htmlForPage(page);
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    } finally {
      inflight.current -= 1;
    }
  }) as unknown as typeof fetch;
  return { fetchImpl, calls, inflight };
}

async function readFixture(name: string): Promise<string> {
  // Resolve relative to this test file's location so the path is stable
  // regardless of how vitest is invoked (repo root vs sub-package cwd).
  // The test file lives at electron/main/agent/<name>.test.ts; fixtures
  // live one directory over under electron/main/agent/__tests__/__fixtures__/.
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pathJoin } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = pathJoin(here, "__tests__", "__fixtures__", name);
  return readFile(fixturePath, "utf8");
}

describe("marketplaceScan cache guard", () => {
  it("returns local sources on the default (no-force) path without invoking the remote fetch hook", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-default-"));
    const source = await mkdtemp(join(tmpdir(), "openbuddy-market-default-source-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    await mkdir(join(source, "plugins", "alpha"), { recursive: true });
    await writeFile(
      join(source, "plugins", "alpha", "package.json"),
      JSON.stringify({ name: "alpha", version: "1.0.0" }),
    );
    await resources.marketplaceAddSource(source);

    // No cache file written yet, default call must still return local sources
    // without throwing and without inserting a refresh marker.
    const result = await resources.marketplaceScan();
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: expect.any(String),
          plugins: expect.arrayContaining([
            expect.objectContaining({ name: "alpha", installStatus: "available" }),
          ]),
        }),
      ]),
    );
    // Cache file should not have been written on the default path.
    const cachePath = join(home, ".pi", "agent", "marketplace-cache.json");
    await expect(
      import("node:fs/promises").then(({ access }) => access(cachePath).then(() => "ok").catch((err: NodeJS.ErrnoException) => err.code)),
    ).resolves.toBe("ENOENT");
  });

  it("clamps maxPages above 200 and below 1 to safe defaults", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-clamp-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    const fetchImpl = (async () => new Response("<html></html>", { status: 200 })) as unknown as typeof fetch;
    await expect(
      resources.marketplaceScan({ force: true, maxPages: 9999, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });
    await expect(
      resources.marketplaceScan({ force: true, maxPages: -1, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });
    await expect(
      resources.marketplaceScan({ force: true, maxPages: 0, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });
  });

  it("force=true fetches real pi.dev pages, parses data-package-card entries, and writes the cache", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-force-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    const page1 = await readFixture("pi-dev-packages-page-1.html");
    const { fetchImpl, calls } = await makeFakeFetch(() => page1);

    await resources.marketplaceScan({ force: true, maxPages: 1, fetchImpl });
    const cachePath = join(home, ".pi", "agent", "marketplace-cache.json");
    const cacheRaw = await readFile(cachePath, "utf8");
    const cache = JSON.parse(cacheRaw) as { caches: Array<{ sourceUrl: string; fetchedAt: string; entries: Array<Record<string, string>>; totalPackages?: number }> };
    expect(cache.caches.length).toBe(1);
    expect(cache.caches[0]?.sourceUrl).toBe("https://pi.dev/packages");
    expect(Number.isFinite(Date.parse(cache.caches[0]!.fetchedAt))).toBe(true);
    expect(cache.caches[0]?.entries.length ?? 0).toBeGreaterThan(0);
    expect(cache.caches[0]?.entries.some((entry) => entry.name === "pi-mcp-adapter")).toBe(true);
    expect(calls).toEqual([1]);
  });

  it("ignores non-positive maxPages and defaults to the safe cap", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-maxpages-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    const fetchImpl = (async () => new Response("<html></html>", { status: 200 })) as unknown as typeof fetch;
    await expect(
      resources.marketplaceScan({ force: true, maxPages: NaN, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });
    await expect(
      resources.marketplaceScan({ force: true, maxPages: 1.5, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });
  });

  it("surfaces cached remote entries inside the TTL window on the default path", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-cache-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    // Pre-seed the cache with a fresh entry by invoking force=true first.
    const page1 = await readFixture("pi-dev-packages-page-1.html");
    const { fetchImpl } = await makeFakeFetch(() => page1);
    await resources.marketplaceScan({ force: true, maxPages: 1, fetchImpl });

    const result = (await resources.marketplaceScan()) as { sources: Array<Record<string, unknown>> };
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "cache",
          sourceName: "openbuddy://cached-remote",
        }),
      ]),
    );
  });

  it("force=true tolerates non-2xx responses by degrading to empty entries", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-503-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    const fetchImpl = (async () =>
      new Response("upstream busy", { status: 503 })) as unknown as typeof fetch;
    await expect(
      resources.marketplaceScan({ force: true, maxPages: 2, fetchImpl }),
    ).resolves.toMatchObject({ sources: expect.any(Array) });

    const cachePath = join(home, ".pi", "agent", "marketplace-cache.json");
    const cacheRaw = await readFile(cachePath, "utf8");
    const cache = JSON.parse(cacheRaw) as { caches: Array<{ sourceUrl: string; entries: unknown[] }> };
    expect(cache.caches[0]?.sourceUrl).toBe("https://pi.dev/packages");
    expect(cache.caches[0]?.entries).toEqual([]);
  });

  it("force=true bounds in-flight HTTP requests by concurrency", async () => {
    const home = await mkdtemp(join(tmpdir(), "openbuddy-market-concurrency-"));
    process.env.PI_HOME = home;
    delete process.env.PI_CODING_AGENT_DIR;
    const resources = await loadResources();

    // The HTML includes the full pi.dev marker (`packages-count`) so the
    // aggregator takes the paged fetch path (mapWithConcurrency) rather
    // than the legacy anchor-only fallback that fires one npm call per name.
    // totalPackages=600 → 12 pages at 50/page; the cap is 4 in-flight.
    const { fetchImpl, inflight } = await makeFakeFetch((page) =>
      `<html><body><span class="packages-count">${(page - 1) * 50 + 1}-${page * 50} / 600</span><div data-package-card="true" data-package-name="pkg-${page}"></div></body></html>`,
    );
    await resources.marketplaceScan({ force: true, maxPages: 12, fetchImpl });
    expect(inflight.max).toBeLessThanOrEqual(4);
    expect(inflight.max).toBeGreaterThan(1);
  });
});
