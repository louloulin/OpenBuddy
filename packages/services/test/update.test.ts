// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertFeedUrl, compareVersions, parseManifest, UpdateService } from "../src/update/update";

const manifest = (over: Record<string, unknown> = {}) => ({
  version: "1.2.0",
  channel: "stable",
  notes: "修复与改进",
  publishedAt: "2026-11-20T00:00:00.000Z",
  download: { url: "https://example.com/OpenBuddy-1.2.0.dmg", sha256: "a".repeat(64), size: 1024 },
  ...over,
});
const fetchJson = (body: unknown, init: ResponseInit = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init }));
const service = (over: Partial<ConstructorParameters<typeof UpdateService>[0]> = {}) =>
  new UpdateService({ currentVersion: "1.0.0", feedUrl: "https://example.com/latest.json", ...over });

describe("版本比较 (A3)", () => {
  it("orders releases and prereleases", () => {
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.1")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0-beta.9")).toBe(1);
    expect(compareVersions("1.2.0-beta", "1.2.0")).toBe(-1);
    expect(() => compareVersions("one.two", "1.0.0")).toThrow(/invalid_version/);
  });
});

describe("更新源与清单校验 (A3)", () => {
  it("accepts https anywhere but plain http only on loopback", () => {
    expect(assertFeedUrl("https://releases.example.com/latest.json").protocol).toBe("https:");
    expect(assertFeedUrl("http://127.0.0.1:47700/latest.json").hostname).toBe("127.0.0.1");
    expect(() => assertFeedUrl("http://releases.example.com/latest.json")).toThrow(/insecure_feed_url/);
    expect(() => assertFeedUrl("https://u2:p@example.com/latest.json")).toThrow(/invalid_feed_url/);
    expect(() => assertFeedUrl("file:///etc/passwd")).toThrow(/insecure_feed_url/);
  });

  it("rejects malformed manifests", () => {
    expect(() => parseManifest(null)).toThrow(/invalid_manifest/);
    expect(() => parseManifest(manifest({ version: "" }))).toThrow(/invalid_manifest_version/);
    expect(() => parseManifest(manifest({ version: "x.y" }))).toThrow(/invalid_version/);
    expect(() => parseManifest(manifest({ channel: "nightly" }))).toThrow(/invalid_manifest_channel/);
    expect(() => parseManifest(manifest({ download: {} }))).toThrow(/invalid_manifest_download/);
    expect(() => parseManifest(manifest({ download: { url: "http://evil.example.com/x" } }))).toThrow(/insecure_feed_url/);
    expect(() => parseManifest(manifest({ download: { url: "https://example.com/x", sha256: "nope" } }))).toThrow(/invalid_manifest_sha256/);
  });
});

describe("检查更新 (A3)", () => {
  it("reports an available release from a real manifest fetch", async () => {
    const fetchImpl = fetchJson(manifest());
    const result = await service({ fetchImpl }).check();
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/latest.json", expect.objectContaining({ headers: { accept: "application/json" } }));
    expect(result).toMatchObject({ status: "available", currentVersion: "1.0.0", version: "1.2.0", channel: "stable" });
    expect(result.notes).toContain("修复");
    expect(result.download.sha256).toHaveLength(64);
  });

  it("reports up-to-date for the same or older release", async () => {
    expect((await service({ fetchImpl: fetchJson(manifest({ version: "1.0.0" })) }).check()).status).toBe("up-to-date");
    expect((await service({ fetchImpl: fetchJson(manifest({ version: "0.9.0" })) }).check()).status).toBe("up-to-date");
  });

  it("refuses a channel mismatch and unconfigured feeds", async () => {
    await expect(service({ fetchImpl: fetchJson(manifest()) }).check({ channel: "beta" })).rejects.toThrow(/update_channel_mismatch/);
    await expect(service({ feedUrl: undefined }).check()).rejects.toThrow(/update_feed_unconfigured/);
  });

  it("surfaces HTTP, JSON, size and timeout failures without throwing raw errors", async () => {
    await expect(service({ fetchImpl: vi.fn(async () => new Response("nope", { status: 404 })) }).check()).rejects.toThrow(/update_feed_http_404/);
    await expect(service({ fetchImpl: vi.fn(async () => new Response("{not json", { status: 200 })) }).check()).rejects.toThrow(/invalid_manifest_json/);
    const huge = JSON.stringify({ ...manifest(), notes: "x".repeat(70_000) });
    await expect(service({ fetchImpl: vi.fn(async () => new Response(huge, { status: 200 })) }).check()).rejects.toThrow(/update_manifest_too_large/);
    const hang = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    await expect(service({ fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 }).check()).rejects.toThrow(/update_feed_timeout/);
  });

  it("accepts a loopback http feed for local release mirrors", async () => {
    const fetchImpl = fetchJson(manifest());
    const result = await service({ fetchImpl, feedUrl: "http://127.0.0.1:47700/latest.json" }).check();
    expect(result.status).toBe("available");
  });
});

/** A real loopback HTTP server so the download path is exercised end to end. */
function serve(body: Buffer, status = 200) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(status, { "content-length": String(body.length) });
      res.end(body);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/OpenBuddy-test.dmg`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

const sha = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");

describe("下载并校验安装包 (A3)", () => {
  it("writes the verified installer into the app's updates directory", async () => {
    const payload = Buffer.from("OpenBuddy installer bytes");
    const mirror = await serve(payload);
    const dir = mkdtempSync(join(tmpdir(), "openbuddy-update-dl-"));
    try {
      const result = await service().download({ url: mirror.url, sha256: sha(payload), size: payload.length, dir });
      expect(result.path).toBe(join(dir, "OpenBuddy-test.dmg"));
      expect(result.bytes).toBe(payload.length);
      expect(result.sha256).toBe(sha(payload));
      expect(readFileSync(result.path)).toEqual(payload);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await mirror.close();
    }
  });

  it("deletes a checksum or size mismatch instead of keeping a half-trusted file", async () => {
    const payload = Buffer.from("tampered");
    const mirror = await serve(payload);
    const dir = mkdtempSync(join(tmpdir(), "openbuddy-update-bad-"));
    try {
      await expect(service().download({ url: mirror.url, sha256: "b".repeat(64), size: payload.length, dir })).rejects.toThrow(/update_checksum_mismatch/);
      await expect(service().download({ url: mirror.url, sha256: sha(payload), size: payload.length + 1, dir })).rejects.toThrow(/update_size_mismatch/);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await mirror.close();
    }
  });

  it("refuses insecure URLs and reports HTTP failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openbuddy-update-http-"));
    const missing = await serve(Buffer.from("gone"), 404);
    try {
      await expect(service().download({ url: "http://releases.example.com/x.dmg", dir })).rejects.toThrow(/insecure_feed_url/);
      await expect(service().download({ url: missing.url, dir })).rejects.toThrow(/update_download_http_404/);
      expect(existsSync(join(dir, "OpenBuddy-test.dmg"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await missing.close();
    }
  });
});
