import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ensureLink, MarketplaceLinkError, removeLink, resolveLinkTarget } from "../marketplace/link-target";

describe("marketplace link-target", () => {
  it("creates a POSIX symlink and resolves its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-link-target-"));
    try { const target = join(root, "target"); await mkdir(target); const path = await ensureLink(root, "current", target); expect((await lstat(path)).isSymbolicLink()).toBe(true); expect(await resolveLinkTarget(root, "current")).toBe(target); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it("removes a link without following it", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-link-target-"));
    try { await ensureLink(root, "current", root); expect(await removeLink(root, "current")).toBe(true); expect(await removeLink(root, "current")).toBe(false); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it("returns EEXIST with the link path", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-link-target-"));
    try { await ensureLink(root, "current", root); await expect(ensureLink(root, "current", root)).rejects.toMatchObject({ name: "MarketplaceLinkError", code: "EEXIST", path: join(root, "current") }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it("returns ENOENT for missing links", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-link-target-"));
    try { await expect(resolveLinkTarget(root, "missing")).rejects.toMatchObject({ name: "MarketplaceLinkError", code: "ENOENT", path: join(root, "missing") }); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects removing a regular directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbuddy-link-target-"));
    try { await mkdir(join(root, "regular")); await expect(removeLink(root, "regular")).rejects.toBeInstanceOf(MarketplaceLinkError); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
});
