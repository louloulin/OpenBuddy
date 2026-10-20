import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachHostCoreAudit,
  auditAppendViaBridge,
  auditBridgeState,
  resetAgentAuditBridge,
} from "../agent-audit-bridge";

const { callAuditAppend } = vi.hoisted(() => ({
  callAuditAppend: vi.fn(),
}));

vi.mock("@openbuddy/host-runtime", () => ({
  callAuditAppend,
}));

const fakeHost = { call: vi.fn(), dispose: vi.fn() } as unknown as { call: unknown };

let tmpDir: string;
let fallbackPath: string;

beforeEach(async () => {
  callAuditAppend.mockReset();
  resetAgentAuditBridge();
  tmpDir = await mkdtemp(join(tmpdir(), "audit-bridge-test-"));
  fallbackPath = join(tmpDir, "audit-fallback.jsonl");
});
afterEach(async () => {
  resetAgentAuditBridge();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("audit-bridge — fallback path (no host)", () => {
  it("append returns id+at when fallback path configured", async () => {
    attachHostCoreAudit(null, { fallbackPath });

    const res = await auditAppendViaBridge({
      kind: "permission",
      outcome: "deny",
      action: "bash.run",
      subject: "user-1",
      resource: "bash:rm",
      reason: "matched deny rule",
    });

    expect(res.id).toMatch(/^[0-9a-f-]+$/);
    expect(res.at).toMatch(/T.*Z$/);
  });

  it("append persists valid JSONL to fallback file", async () => {
    attachHostCoreAudit(null, { fallbackPath });

    await auditAppendViaBridge({
      kind: "permission",
      outcome: "success",
      action: "secrets.resolve",
      provider: "openai",
    });

    const content = await readFile(fallbackPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.event).toBe("secrets.resolve");
    expect(entry.outcome).toBe("success");
    expect(entry.source).toBe("main");
    expect(entry.detail.kind).toBe("permission");
    expect(entry.detail.provider).toBe("openai");
  });

  it("append returns dropped when no fallback path", async () => {
    attachHostCoreAudit(null);
    const res = await auditAppendViaBridge({ kind: "host", outcome: "info", action: "boot" });
    expect(res.id).toBe("dropped");
  });
});

describe("audit-bridge — host-core path", () => {
  beforeEach(() => attachHostCoreAudit(fakeHost as never, { fallbackPath }));

  it("append uses host-core on happy path", async () => {
    callAuditAppend.mockResolvedValue({ id: "audit-1", at: "2026-09-24T00:00:00Z", payloadHash: "abc123" });

    const res = await auditAppendViaBridge({
      kind: "permission",
      outcome: "deny",
      action: "bash.run",
    });

    expect(res).toEqual({ id: "audit-1", at: "2026-09-24T00:00:00Z", hash: "abc123" });
    expect(callAuditAppend).toHaveBeenCalledWith(fakeHost, expect.objectContaining({ kind: "permission", action: "bash.run" }));
  });

});

describe("audit-bridge — degradation + fallback file", () => {
  beforeEach(() => attachHostCoreAudit(fakeHost as never, { fallbackPath }));

  it("falls back to JSONL when host-core append fails", async () => {
    callAuditAppend.mockRejectedValue(new Error("rpc timeout"));

    await auditAppendViaBridge({ kind: "host", outcome: "failure", action: "boot.fail" });

    const content = await readFile(fallbackPath, "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.event).toBe("boot.fail");
    expect(entry.outcome).toBe("failure");
    expect(entry.detail.kind).toBe("host");
  });

});

describe("audit-bridge — backoff", () => {
  beforeEach(() => attachHostCoreAudit(fakeHost as never, { fallbackPath }));

  it("skips host-core during backoff window", async () => {
    callAuditAppend.mockRejectedValue(new Error("boom"));

    await auditAppendViaBridge({ kind: "host", outcome: "failure", action: "x" });
    expect(callAuditAppend).toHaveBeenCalledTimes(1);

    await auditAppendViaBridge({ kind: "host", outcome: "failure", action: "y" });
    expect(callAuditAppend).toHaveBeenCalledTimes(1); // no retry
  });

  it("bridgeState reports fallbackConfigured", () => {
    const s = auditBridgeState();
    expect(s.fallbackConfigured).toBe(true);
    expect(s.hostAttached).toBe(true);
  });
});
