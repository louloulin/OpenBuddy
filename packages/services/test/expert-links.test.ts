// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeZip } from "../src/skills/zip";
import { ExpertLinkRegistry, readExpertLink } from "../src/agents/expert-links";
import { fetchRemoteBytes, isPublicAddress } from "../src/agents/remote-fetch";
import { readWorkBuddyPackageFrom } from "../src/agents/workbuddy";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "openbuddy-link-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const packageZip = () =>
  writeZip([
    {
      name: ".codebuddy-plugin/plugin.json",
      bytes: Buffer.from(JSON.stringify({ name: "link-pkg", displayName: { zh: "链接包" }, agents: ["./agents/linker.md"] })),
    },
    { name: "agents/linker.md", bytes: Buffer.from("---\nname: linker\ndescription: 链接专家\ndisplayName:\n  zh: 链接员\n---\n\n你是链接员。\n") },
  ]);

async function serve(routes: Record<string, (res: import("node:http").ServerResponse) => void>) {
  const origin = { value: "" };
  const server = createServer((req, res) => {
    const handler = routes[req.url ?? ""];
    if (!handler) {
      res.statusCode = 404;
      res.end();
      return;
    }
    handler(res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin.value = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return origin;
}

describe("远程专家包读取 (B3b)", () => {
  it("accepts only public addresses and rejects loopback / private / link-local", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("203.0.113.9")).toBe(true);
    expect(isPublicAddress("127.0.0.1")).toBe(false);
    expect(isPublicAddress("10.0.0.7")).toBe(false);
    expect(isPublicAddress("172.20.1.1")).toBe(false);
    expect(isPublicAddress("192.168.1.1")).toBe(false);
    expect(isPublicAddress("169.254.169.254")).toBe(false);
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("::1")).toBe(false);
    expect(isPublicAddress("fd00::1")).toBe(false);
    expect(isPublicAddress("fe80::1")).toBe(false);
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects plain http, credentials in the URL, non-443 ports and private DNS answers", async () => {
    await expect(fetchRemoteBytes("http://example.com/pkg.zip")).rejects.toThrow(/remote_insecure/);
    await expect(fetchRemoteBytes("https://user:pass@example.com/pkg.zip")).rejects.toThrow(/remote_forbidden/);
    await expect(fetchRemoteBytes("https://example.com:8443/pkg.zip")).rejects.toThrow(/remote_insecure/);
    await expect(fetchRemoteBytes("https://public.example/pkg.zip", { resolveHost: async () => ["10.1.2.3"] })).rejects.toThrow(/remote_forbidden/);
    await expect(fetchRemoteBytes("https://public.example/pkg.zip", { resolveHost: async () => [] })).rejects.toThrow(/remote_dns/);
    await expect(fetchRemoteBytes("not a url")).rejects.toThrow(/remote_invalid_url/);
  });

  it("downloads a ZIP over the test loopback, follows a redirect and enforces the byte cap", async () => {
    const zip = packageZip();
    const origin = await serve({
      "/jump": (res) => { res.writeHead(302, { location: "/pkg.zip" }); res.end(); },
      "/pkg.zip": (res) => { res.setHeader("content-type", "application/zip"); res.end(zip); },
      "/big.zip": (res) => { res.setHeader("content-type", "application/zip"); res.end(Buffer.alloc(4096)); },
    });
    const fetched = await fetchRemoteBytes(`${origin.value}/jump`, { allowLoopback: true });
    expect(fetched.bytes.equals(zip)).toBe(true);
    expect(fetched.contentType).toBe("application/zip");
    const pkg = readWorkBuddyPackageFrom("pkg.zip", fetched.bytes);
    expect(pkg.name).toBe("link-pkg");
    expect(pkg.drafts).toHaveLength(1);
    await expect(fetchRemoteBytes(`${origin.value}/big.zip`, { allowLoopback: true, maxBytes: 100 })).rejects.toThrow(/remote_too_large/);
  });

  it("reads a local directory deterministically and keeps the digest stable", async () => {
    const root = tempDir();
    const pkg = join(root, "pkg");
    mkdirSync(join(pkg, ".codebuddy-plugin"), { recursive: true });
    mkdirSync(join(pkg, "agents"), { recursive: true });
    writeFileSync(join(pkg, ".codebuddy-plugin", "plugin.json"), JSON.stringify({ name: "dir-link", agents: ["./agents/a.md"] }));
    writeFileSync(join(pkg, "agents", "a.md"), "---\nname: a\ndescription: 甲\n---\n\n你是甲。\n");
    const first = await readExpertLink(pkg);
    const second = await readExpertLink(pkg);
    expect(first.remote).toBe(false);
    expect(first.bytes).toBeUndefined();
    expect(first.path).toBeTruthy();
    expect(first.sha256).toBe(second.sha256);
    expect(first.size).toBe(second.size);
    expect(readWorkBuddyPackageFrom(first.path!).drafts).toHaveLength(1);
    // A changed file changes the digest, so the same source imports again.
    writeFileSync(join(pkg, "agents", "a.md"), "---\nname: a\ndescription: 乙\n---\n\n你是乙。\n");
    expect((await readExpertLink(pkg)).sha256).not.toBe(first.sha256);
  });

  it("records one digest per source for idempotent imports", () => {
    const dir = tempDir();
    const registry = new ExpertLinkRegistry(dir);
    expect(registry.get("https://example.com/a.zip")).toBeUndefined();
    registry.record({ source: "https://example.com/a.zip", sha256: "aaa", package: "A", experts: ["a1"], at: "2026-11-19T00:00:00.000Z" });
    expect(registry.get("https://example.com/a.zip")).toMatchObject({ sha256: "aaa", experts: ["a1"] });
    registry.record({ source: "https://example.com/a.zip", sha256: "bbb", package: "A2", experts: ["a2"], at: "2026-11-19T01:00:00.000Z" });
    expect(registry.get("https://example.com/a.zip")).toMatchObject({ sha256: "bbb", package: "A2" });
  });
});
