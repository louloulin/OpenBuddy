// @vitest-environment node
// 自动化 (pii W4.2): a `permissionMode: "fullAccess"` run grants the background session every tool,
// but explicit deny rules still win; revoking restores the normal ask path.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings } from "@openbuddy/services/settings/settings";
import { Permissions } from "../src/permissions/permissions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const secure = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };

function gate() {
  const root = mkdtempSync(join(tmpdir(), "openbuddy-automation-perm-"));
  dirs.push(root);
  const settings = createSettings(root, secure);
  return { settings, permissions: new Permissions(settings, () => {}) };
}

describe("自动化完全访问 (pii W4.2)", () => {
  it("grantAll allows unknown tools, deny rules still win, revokeAll restores asking", () => {
    const { settings, permissions } = gate();
    // Default: a write tool is neither allowed nor denied — it would raise a card.
    expect(permissions.decide("s1", "edit", { path: "/ws/a.txt" })).toBeUndefined();
    permissions.grantAll("s1");
    expect(permissions.decide("s1", "edit", { path: "/ws/a.txt" })).toBe(true);
    expect(permissions.decide("s1", "bash", { command: "touch x" })).toBe(true);
    // An explicit deny rule is a user decision the task cannot waive.
    settings.config.write({
      ...settings.config.read(),
      rules: [{ action: "deny", tool: "bash", pattern: "rm -rf" }],
    });
    expect(permissions.decide("s1", "bash", { command: "rm -rf build" })).toBe(false);
    expect(permissions.decide("s1", "bash", { command: "touch x" })).toBe(true);
    // Another session is unaffected.
    expect(permissions.decide("s2", "edit", { path: "/ws/a.txt" })).toBeUndefined();
    // The grant is scoped to one run.
    permissions.revokeAll("s1");
    expect(permissions.decide("s1", "edit", { path: "/ws/a.txt" })).toBeUndefined();
  });

  it("forget clears the run grant together with the session's tool grants", () => {
    const { permissions } = gate();
    permissions.grantAll("s1");
    expect(permissions.decide("s1", "write", { path: "/ws/a.txt" })).toBe(true);
    permissions.forget("s1");
    expect(permissions.decide("s1", "write", { path: "/ws/a.txt" })).toBeUndefined();
  });
});
