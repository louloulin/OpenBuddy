// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ExtensionRegistryService, deriveCategories } from "../src/extensions/registry";

const row = (overrides: Record<string, unknown> = {}) => ({
  package: {
    name: "pi-web-access",
    version: "0.48.0",
    description: "Web search for Pi",
    keywords: ["pi-package", "search"],
    publisher: { username: "nicopreme" },
    license: "MIT",
    links: { npm: "https://www.npmjs.com/package/pi-web-access", repository: "git+https://github.com/a/b.git" },
    ...overrides,
  },
  downloads: { weekly: 12, monthly: 34 },
  score: { final: 0.9123, detail: { quality: 0.9, popularity: 0.55, maintenance: 0.777 } },
  updated: "2026-11-17T10:07:26.630Z",
});

const json = (body: unknown, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 503,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe("Pi 包市场搜索 (S15)", () => {
  it("searches npm by the pi-package keyword and maps real fields", async () => {
    const calls: string[] = [];
    const service = new ExtensionRegistryService({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return json({ total: 1, objects: [row()] });
      },
      now: () => 1000,
    });
    const result = await service.search("web");
    expect(calls[0]).toContain("keywords%3Api-package%20web");
    expect(calls[0]).toContain("size=25");
    expect(calls[0]).toContain("from=0");
    expect(result).toMatchObject({ query: "web", source: "npm", total: 1, from: 0, fetchedAt: 1000 });
    expect(result.packages[0]).toMatchObject({
      name: "pi-web-access",
      version: "0.48.0",
      publisher: "nicopreme",
      weeklyDownloads: 12,
      monthlyDownloads: 34,
      score: { final: 0.91, quality: 0.9, popularity: 0.55, maintenance: 0.777 },
      keywords: ["pi-package", "search"],
    });
  });

  it("keeps npm's raw final score and drops only unreadable rows (E1)", async () => {
    const service = new ExtensionRegistryService({
      fetchImpl: async () => json({ total: 3, objects: [
        row({}),
        { ...row(), score: { final: 202.60645, detail: { quality: 1, popularity: 1, maintenance: 1 } } },
        { ...row(), score: { final: "high", detail: {} } },
      ] }),
    });
    const result = await service.search("");
    expect(result.packages[0].score?.final).toBe(0.91);
    expect(result.packages[1].score).toEqual({ final: 202.61, quality: 1, popularity: 1, maintenance: 1 });
    expect(result.packages[2].score).toBeUndefined();
  });

  it("caches identical queries and skips malformed rows", async () => {
    let calls = 0;
    const service = new ExtensionRegistryService({
      fetchImpl: async () => {
        calls += 1;
        return json({ total: 3, objects: [row(), null, { package: { version: "1.0.0" } }] });
      },
    });
    const first = await service.search("");
    const second = await service.search("  ");
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    expect(first.packages).toHaveLength(1);
  });

  it("reports unreachable / invalid responses as protocol codes", async () => {
    const offline = new ExtensionRegistryService({ fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
    await expect(offline.search()).rejects.toThrow(/registry_unreachable/);
    const badStatus = new ExtensionRegistryService({ fetchImpl: async () => json({}, false) });
    await expect(badStatus.search()).rejects.toThrow(/registry_unreachable/);
    const badBody = new ExtensionRegistryService({ fetchImpl: async () => json({ nope: true }) });
    await expect(badBody.search()).rejects.toThrow(/registry_invalid_response/);
  });

  it("rejects hostile query text before any network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new ExtensionRegistryService({ fetchImpl });
    await expect(service.search("x".repeat(121))).rejects.toThrow(/invalid_payload/);
    await expect(service.search("a\nb")).rejects.toThrow(/invalid_payload/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("paginates with a bounded offset (S16)", async () => {
    const calls: string[] = [];
    const service = new ExtensionRegistryService({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return json({ total: 100, objects: [row()] });
      },
    });
    const page = await service.search("web", { from: 25 });
    expect(calls[0]).toContain("from=25");
    expect(page.from).toBe(25);
    await expect(service.search("web", { from: 1001 })).rejects.toThrow(/invalid_payload/);
    await expect(service.search("web", { from: 1.5 })).rejects.toThrow(/invalid_payload/);
  });

  it("derives capability categories from the package's own npm keywords (E1)", async () => {
    const service = new ExtensionRegistryService({
      fetchImpl: async () => json({ total: 1, objects: [row({ keywords: ["pi-package", "browser", "web-search", "crawl"] })] }),
    });
    const result = await service.search("");
    expect(result.packages[0].categories).toEqual(["web", "search"]);
    expect(deriveCategories(["pi-package"])).toEqual(["other"]);
    expect(deriveCategories(["mcp-server"])).toEqual(["mcp"]);
  });

  it("reads integrity, maintainers, publish time and git commit from the packument (E1)", async () => {
    const calls: string[] = [];
    const service = new ExtensionRegistryService({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return json({
          name: "pi-web-access",
          "dist-tags": { latest: "0.48.0" },
          time: { "0.48.0": "2026-11-17T10:07:26.630Z" },
          versions: {
            "0.48.0": {
              dist: { integrity: "sha512-abc==", shasum: "deadbeef" },
              maintainers: [{ name: "nicopreme" }, { name: "other" }],
              keywords: ["pi-package", "browser"],
              license: "MIT",
              unpackedSize: 2048,
              gitHead: "1f0c2d3",
            },
          },
        });
      },
    });
    const details = await service.details("pi-web-access");
    expect(calls[0]).toContain("pi-web-access");
    expect(details).toMatchObject({
      name: "pi-web-access",
      version: "0.48.0",
      integrity: "sha512-abc==",
      shasum: "deadbeef",
      maintainers: ["nicopreme", "other"],
      publishedAt: "2026-11-17T10:07:26.630Z",
      gitHead: "1f0c2d3",
      license: "MIT",
      unpackedSize: 2048,
    });
    expect(details.categories).toEqual(["web"]);
  });

  it("refuses names that are not npm packages and reports registry failures (E1)", async () => {
    const service = new ExtensionRegistryService({ fetchImpl: vi.fn(async () => json({})) });
    await expect(service.details("../../etc/passwd")).rejects.toThrow(/invalid_payload/);
    await expect(service.details("Bad Name")).rejects.toThrow(/invalid_payload/);
    const offline = new ExtensionRegistryService({ fetchImpl: async () => { throw new Error("ENOTFOUND"); } });
    await expect(offline.details("pi-web-access")).rejects.toThrow(/registry_unreachable/);
    const missing = new ExtensionRegistryService({ fetchImpl: async () => json({}, false) });
    await expect(missing.details("pi-web-access")).rejects.toThrow(/registry_unreachable/);
  });
});
