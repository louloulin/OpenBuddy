/**
 * audit-bridge.test.ts — createHostCoreAuditWriter 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHostCoreAuditWriter } from "../audit-bridge";
import type { AuditDecisionEntry } from "../types";

beforeEach(() => vi.restoreAllMocks());

describe("audit-bridge — basic translation", () => {
  it("returns null when auditAppend is null", () => {
    expect(createHostCoreAuditWriter({ auditAppend: null })).toBeNull();
  });

  it("translates PI_ALLOW_RULE → kind=permission outcome=allow", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });
    expect(writer).not.toBeNull();

    await writer!.append({
      subject: "user-1",
      action: "bash.run",
      resource: "bash",
      allowed: true,
      code: "PI_ALLOW_RULE",
      source: "pi",
      matchedRule: "bash(git *)",
      reason: "ok",
    });

    expect(auditAppend).toHaveBeenCalledWith({
      kind: "permission",
      outcome: "allow",
      action: "authz.bash.run",
      subject: "user-1",
      resource: "bash",
      code: "PI_ALLOW_RULE",
      reason: "ok",
      target: "bash(git *)",
    });
  });

  it("translates PI_DENY_RULE → outcome=deny", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    await writer!.append({
      action: "bash.run",
      resource: "bash",
      allowed: false,
      code: "PI_DENY_RULE",
      source: "pi",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "permission", outcome: "deny",
    }));
  });

  it("translates FOLDER_TRUSTED → kind=folder_trust", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    await writer!.append({
      action: "write",
      resource: "file",
      allowed: true,
      code: "FOLDER_TRUSTED",
      source: "folder_trust",
      matchedRule: "/path:trusted",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "folder_trust", outcome: "allow",
    }));
  });

  it("translates PLUGIN_CAPABILITY_DENIED → kind=plugin outcome=deny", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    await writer!.append({
      action: "execute",
      resource: "tool",
      allowed: false,
      code: "PLUGIN_CAPABILITY_DENIED",
      source: "plugin_capability",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "plugin", outcome: "deny",
    }));
  });

  it("translates CASDOOR_* → kind=permission (merged)", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    await writer!.append({
      action: "read",
      resource: "workspace",
      allowed: false,
      code: "CASDOOR_PERMISSION_DENIED",
      source: "casdoor",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "permission", outcome: "deny",
    }));
  });

  it("translates DEFAULT_DENY → kind=permission outcome=deny", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    await writer!.append({
      action: "x", resource: "r",
      allowed: false, code: "DEFAULT_DENY", source: "default",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      kind: "permission", outcome: "deny",
    }));
  });
});

describe("audit-bridge — option handling", () => {
  it("uses custom actionPrefix", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend, actionPrefix: "policy" });

    await writer!.append({
      action: "bash.run", resource: "bash",
      allowed: true, code: "PI_ALLOW_RULE", source: "pi",
    });

    expect(auditAppend).toHaveBeenCalledWith(expect.objectContaining({
      action: "policy.bash.run",
    }));
  });

  it("omits undefined optional fields", async () => {
    const auditAppend = vi.fn().mockResolvedValue({ id: "1", at: "t" });
    const writer = createHostCoreAuditWriter({ auditAppend });

    // Note: code is required (decision.code), so it is always present.
    // subject / reason / matchedRule are optional.
    const entry: AuditDecisionEntry = {
      action: "x", resource: "r",
      allowed: false, code: "DEFAULT_DENY", source: "default",
    };

    await writer!.append(entry);

    const call = auditAppend.mock.calls[0][0];
    expect(call).not.toHaveProperty("subject");
    expect(call).not.toHaveProperty("reason");
    expect(call).not.toHaveProperty("target");
    expect(call).toHaveProperty("code", "DEFAULT_DENY");
  });
});

describe("audit-bridge — error handling", () => {
  it("swallows audit errors silently when onError not provided", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const auditAppend = vi.fn().mockRejectedValue(new Error("audit down"));
    const writer = createHostCoreAuditWriter({ auditAppend });

    await expect(writer!.append({
      action: "x", resource: "r",
      allowed: false, code: "DEFAULT_DENY", source: "default",
    })).resolves.toBeUndefined();

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("audit-bridge"),
      "audit down",
    );
  });

  it("calls onError when provided", async () => {
    const onError = vi.fn();
    const auditAppend = vi.fn().mockRejectedValue(new Error("boom"));
    const writer = createHostCoreAuditWriter({ auditAppend, onError });

    await writer!.append({
      action: "x", resource: "r",
      allowed: false, code: "DEFAULT_DENY", source: "default",
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
