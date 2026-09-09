/**
 * @openbuddy/folder-trust tests — Phase D.2 verification.
 *
 * The FolderTrustStore already implements the contract that
 * v3 §D.2 plans to wire into FolderTrustDialog (PI ProjectTrust
 * replacement). These tests pin the existing JSON-backed store
 * so the future SettingsStore / ProjectTrust wiring can trust the
 * underlying primitive without re-implementing folder-trust
 * semantics.
 *
 * What's verified:
 * - Basic grant + isTrusted round-trip
 * - Revoke flips the trust flag without losing the decidedAt
 * - respond(trusted=true) is grant; respond(false) is revoke
 * - list() returns all entries
 * - Persists to disk (writes JSON, reads back)
 * - Missing or corrupt file → start empty (best-effort)
 * - Multiple grants on same cwd: only one entry (latest wins)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFolderTrustStore } from "./index";

let root = "";
let storePath = "";
let store: JsonFolderTrustStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "folder-trust-test-"));
  storePath = join(root, "folder-trust.json");
  store = new JsonFolderTrustStore(storePath);
});

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("JsonFolderTrustStore (Phase D.2 verification)", () => {
  it("starts empty when the file does not exist", () => {
    expect(store.list()).toEqual([]);
    expect(store.isTrusted("/some/path")).toBe(false);
  });

  it("grant + isTrusted round-trip", () => {
    store.grant("/path/a");
    expect(store.isTrusted("/path/a")).toBe(true);
    expect(store.grant("/path/a").cwd).toBe("/path/a");
  });

  it("revoke flips the trust flag", () => {
    store.grant("/path/a");
    expect(store.isTrusted("/path/a")).toBe(true);
    store.revoke("/path/a");
    expect(store.isTrusted("/path/a")).toBe(false);
  });

  it("respond(true) is grant; respond(false) is revoke", () => {
    expect(store.respond("/path/a", true).trusted).toBe(true);
    expect(store.respond("/path/a", false).trusted).toBe(false);
  });

  it("list returns all entries", () => {
    store.grant("/a");
    store.grant("/b");
    store.revoke("/c");
    const cwds = store.list().map((entry) => entry.cwd).sort();
    expect(cwds).toEqual(["/a", "/b", "/c"]);
  });

  it("writes JSON to disk after each mutation", () => {
    store.grant("/a");
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].cwd).toBe("/a");
    expect(parsed.entries[0].trusted).toBe(true);
  });

  it("survives a fresh store instance reading the same file", () => {
    store.grant("/a");
    store.revoke("/b");
    const reloaded = new JsonFolderTrustStore(storePath);
    expect(reloaded.isTrusted("/a")).toBe(true);
    expect(reloaded.isTrusted("/b")).toBe(false);
    expect(reloaded.list()).toHaveLength(2);
  });

  it("multiple grants on the same cwd keep only the latest entry", () => {
    store.grant("/a");
    store.revoke("/a");
    store.grant("/a");
    const matching = store.list().filter((entry) => entry.cwd === "/a");
    expect(matching).toHaveLength(1);
    expect(matching[0]?.trusted).toBe(true);
  });

  it("recovers from a corrupt file (starts empty + warns via best-effort)", () => {
    // Seed the file with bad JSON.
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(storePath, "{not valid json");
    const fresh = new JsonFolderTrustStore(storePath);
    expect(fresh.list()).toEqual([]);
    expect(fresh.isTrusted("/anywhere")).toBe(false);
  });

  it("decidedAt is preserved across reload", async () => {
    store.grant("/a");
    const first = store.list().find((entry) => entry.cwd === "/a");
    expect(first?.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Brief pause so timestamps would differ if regenerated.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const reloaded = new JsonFolderTrustStore(storePath);
    const second = reloaded.list().find((entry) => entry.cwd === "/a");
    expect(second?.decidedAt).toBe(first?.decidedAt);
  });
});
