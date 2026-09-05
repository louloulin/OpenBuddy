import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/openbuddy-audit-test" } }));

import { __casdoorAuditTestables } from "./casdoor/casdoor-audit";

describe("Casdoor audit event sanitization", () => {
  it("removes credentials and control characters from audit reasons", () => {
    const event = __casdoorAuditTestables.sanitizeEvent({
      event: "authorization\ncheck",
      outcome: "deny",
      reason: "password=secret access_token=abc\tBearer xyz",
    });

    expect(event.event).toBe("authorization check");
    expect(event.reason).toContain("password=[redacted]");
    expect(event.reason).toContain("access_token=[redacted]");
    expect(event.reason).toContain("Bearer [redacted]");
    expect(event.reason).not.toContain("secret");
    expect(event.reason).not.toContain("abc");
    expect(event.reason).not.toContain("xyz");
  });

  it("keeps audit files bounded by event count and byte size", () => {
    const content = Array.from({ length: 5 }, (_, index) => JSON.stringify({ id: index, value: "x".repeat(20) })).join("\n");
    const trimmed = __casdoorAuditTestables.trimPersistedAudit(content, 3, 80);
    expect(trimmed.split("\n").filter(Boolean)).toHaveLength(2);
    expect(trimmed).toContain('"id":4');
    expect(trimmed).not.toContain('"id":0');
  });
});
