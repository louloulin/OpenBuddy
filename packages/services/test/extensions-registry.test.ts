// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ExtensionRegistryService } from "../src/extensions/registry";

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
  updated: "2026-11-17T10:07:26.630Z",
});

const json = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response;

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
      keywords: ["pi-package", "search"],
    });
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
});
