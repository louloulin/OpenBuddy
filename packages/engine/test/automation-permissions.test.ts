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

// 待决审批快照 (20261117-mobile.md §2.4 path 3): a phone that reconnects reads
// `permission_pending` and must get the exact card the live event carried.
describe("permission_pending snapshot", () => {
  it("mirrors agent://permission, filters by session, and clears on resolve", async () => {
    const { settings } = gate();
    const events: { event: string; payload: Record<string, unknown> }[] = [];
    const permissions = new Permissions(settings, (event, payload) =>
      events.push({ event, payload: payload as Record<string, unknown> }),
    );
    const pending = permissions.decision("s1", "call-1", "bash", { command: "rm -rf build" });

    const snapshot = permissions.pendingRequests();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ sessionId: "s1", toolCallId: "call-1", toolKind: "bash" });
    // Identical to what the listener would have received.
    expect(snapshot[0]).toEqual(events.find((entry) => entry.event === "agent://permission")?.payload);
    // A different session's view is empty.
    expect(permissions.pendingRequests("s2")).toHaveLength(0);

    permissions.resolve(snapshot[0].requestId, "deny", false);
    await pending;
    expect(permissions.pendingRequests()).toHaveLength(0);
  });
});
