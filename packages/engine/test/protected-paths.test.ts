// @vitest-environment node
// 受保护路径 (pii W6.2 / W6.4): write/edit/delete may never touch .env / .git / keys,
// not even under always-approve or an automation's full-access grant.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings, DEFAULT_PROTECTED_PATHS } from "@openbuddy/services/settings/settings";
import { Permissions, protectedPathOf } from "../src/permissions/permissions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const secure = { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

function gate() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-protected-"));
  dirs.push(root);
  const settings = createSettings(root, secure);
  return { settings, permissions: new Permissions(settings, () => {}) };
}

describe("protectedPathOf (pii W6.2)", () => {
  it("matches .env variants, .git / .ssh segments, key suffixes and credential files", () => {
    const paths = [...DEFAULT_PROTECTED_PATHS];
    expect(protectedPathOf(paths, "write", { path: "/ws/.env" })).toBe(".env");
    expect(protectedPathOf(paths, "write", { path: "/ws/.env.local" })).toBe(".env");
    expect(protectedPathOf(paths, "edit", { path: "/ws/.git/config" })).toBe(".git");
    expect(protectedPathOf(paths, "write", { path: "/home/u/.ssh/id_rsa" })).toBe(".ssh");
    expect(protectedPathOf(paths, "write", { path: "/ws/server.pem" })).toBe("*.pem");
    expect(protectedPathOf(paths, "write", { path: "/ws/credentials.json" })).toBe("credentials.json");
    expect(protectedPathOf(paths, "delete", { path: "/ws/.env" })).toBe(".env");
  });

  it("does not guard reads or ordinary files", () => {
    const paths = [...DEFAULT_PROTECTED_PATHS];
    expect(protectedPathOf(paths, "read", { path: "/ws/.env" })).toBeUndefined();
    expect(protectedPathOf(paths, "grep", { path: "/ws/.env" })).toBeUndefined();
    expect(protectedPathOf(paths, "write", { path: "/ws/report.md" })).toBeUndefined();
    expect(protectedPathOf(paths, "write", {})).toBeUndefined();
  });
});

describe("权限门里的受保护路径 (pii W6.2 / W6.4)", () => {
  it("denies .env even with a full-access grant or always-approve", async () => {
    const { settings, permissions } = gate();
    permissions.grantAll("auto-1");
    const blocked = await permissions.decision("auto-1", "call-1", "write", { path: "/ws/.env" });
    expect(blocked).toMatchObject({ allow: false, kind: "protected" });
    expect(blocked.note).toContain("受保护路径");

    settings.config.write({ ...settings.config.read(), permissionMode: "always-approve" });
    expect((await permissions.decision("s2", "call-2", "edit", { path: "/ws/.git/config" })).allow).toBe(false);
    // Ordinary files are still allowed by the same grant / mode.
    expect((await permissions.decision("auto-1", "call-3", "write", { path: "/ws/report.md" })).allow).toBe(true);
    // Reading a protected file is not blocked by this guard.
    expect((await permissions.decision("s2", "call-4", "read", { path: "/ws/.env" })).allow).toBe(true);
  });

  it("the list is editable: removing a pattern lifts the guard", async () => {
    const { settings, permissions } = gate();
    permissions.grantAll("s1");
    settings.config.write({
      ...settings.config.read(),
      protectedPaths: DEFAULT_PROTECTED_PATHS.filter((path) => path !== ".env"),
    });
    expect((await permissions.decision("s1", "c1", "write", { path: "/ws/.env" })).allow).toBe(true);
    // .git stays protected.
    expect((await permissions.decision("s1", "c2", "write", { path: "/ws/.git/config" })).allow).toBe(false);
  });
});
