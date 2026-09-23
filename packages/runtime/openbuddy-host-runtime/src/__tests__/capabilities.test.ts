/**
 * Tests for the typed capability wrappers.
 *
 * Strategy: stub the host.call with a vi.fn so we can assert that each
 * wrapper:
 *  - calls the expected JSON-RPC method
 *  - forwards params unchanged
 *  - returns the typed result
 *  - propagates errors from host.call
 */
import { describe, expect, it, vi } from "vitest";

import {
  callSecretsSet,
  callSecretsGet,
  callSecretsDelete,
  callSecretsList,
  callPermissionsEvaluate,
  callPermissionsReadRules,
  callPermissionsWriteRules,
  callPermissionsReadMode,
  callPermissionsWriteMode,
  callSessionSearch,
  callSessionMessage,
  callSessionSetRoot,
  callWorkspaceSetRoot,
  callWorkspaceResolve,
  callWorkspaceCheck,
  callWorkspaceListIgnored,
  callAuditAppend,
  callAuditTail,
} from "../capabilities.js";

function fakeHost(responses: Record<string, unknown> = {}) {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const host = {
    async call<T = unknown>(method: string, params?: unknown): Promise<T> {
      calls.push({ method, params });
      if (method in responses) return responses[method] as T;
      throw new Error(`unexpected method ${method}`);
    },
  };
  return { host: host as any, calls };
}

describe("capability wrappers — secrets", () => {
  it("callSecretsSet forwards params", async () => {
    const { host, calls } = fakeHost({ "secrets.set": { ref: "x", backend: "file_fallback", updatedAt: "2026-09-23T00:00:00Z" } });
    await callSecretsSet(host, { ref: "secret:x", value: "v", label: "L", kind: "file_fallback" });
    expect(calls[0]).toEqual({ method: "secrets.set", params: { ref: "secret:x", value: "v", label: "L", kind: "file_fallback" } });
  });

  it("callSecretsGet", async () => {
    const { host } = fakeHost({ "secrets.get": { backend: "file_fallback", value: "v" } });
    const res = await callSecretsGet(host, { ref: "secret:x" });
    expect(res.value).toBe("v");
  });

  it("callSecretsDelete", async () => {
    const { host, calls } = fakeHost({ "secrets.delete": { ok: true } });
    await callSecretsDelete(host, { ref: "secret:x" });
    expect(calls[0].method).toBe("secrets.delete");
  });

  it("callSecretsList", async () => {
    const { host } = fakeHost({ "secrets.list": { backend: "file_fallback", secrets: [] } });
    const res = await callSecretsList(host);
    expect(res.backend).toBe("file_fallback");
  });
});

describe("capability wrappers — permissions", () => {
  it("evaluate returns action + matched rule", async () => {
    const { host } = fakeHost({ "permissions.evaluate": { action: "deny", matchedRule: "rm *" } });
    const res = await callPermissionsEvaluate(host, { tool: "bash", pattern: "rm -rf /" });
    expect(res).toEqual({ action: "deny", matchedRule: "rm *" });
  });

  it("readRules returns rule array", async () => {
    const { host } = fakeHost({ "permissions.readRules": [{ action: "allow", tool: "bash" }] });
    const rules = await callPermissionsReadRules(host);
    expect(rules.length).toBe(1);
  });

  it("writeRules sends rules under .rules key", async () => {
    const { host, calls } = fakeHost({ "permissions.writeRules": { ok: true, count: 1 } });
    await callPermissionsWriteRules(host, [{ action: "allow", tool: "bash" }]);
    expect(calls[0].params).toEqual({ rules: [{ action: "allow", tool: "bash" }] });
  });

  it("readMode returns mode", async () => {
    const { host } = fakeHost({ "permissions.readMode": "bypassPermissions" });
    expect(await callPermissionsReadMode(host)).toBe("bypassPermissions");
  });

  it("writeMode sends { mode }", async () => {
    const { host, calls } = fakeHost({ "permissions.writeMode": { ok: true, mode: "acceptEdits" } });
    await callPermissionsWriteMode(host, "acceptEdits");
    expect(calls[0].params).toEqual({ mode: "acceptEdits" });
  });
});

describe("capability wrappers — session", () => {
  it("search with maxResults", async () => {
    const { host, calls } = fakeHost({ "session.search": { hits: [], total: 0 } });
    await callSessionSearch(host, { query: "rust", maxResults: 25 });
    expect(calls[0].params).toEqual({ query: "rust", maxResults: 25 });
  });

  it("message lookup", async () => {
    const { host } = fakeHost({ "session.message": { sessionId: "s", lineNo: 1, content: "x" } });
    const res = await callSessionMessage(host, { sessionId: "s", lineNo: 1 });
    expect(res.content).toBe("x");
  });

  it("setRoot", async () => {
    const { host, calls } = fakeHost({ "session.setRoot": { ok: true } });
    await callSessionSetRoot(host, { sessionsRoot: "/tmp" });
    expect(calls[0].params).toEqual({ sessionsRoot: "/tmp" });
  });
});

describe("capability wrappers — workspace", () => {
  it("setRoot", async () => {
    const { host, calls } = fakeHost({ "workspace.setRoot": { ok: true } });
    await callWorkspaceSetRoot(host, { workspaceRoot: "/work" });
    expect(calls[0].params).toEqual({ workspaceRoot: "/work" });
  });

  it("resolve returns canonical + inWorkspace", async () => {
    const { host } = fakeHost({ "workspace.resolve": { canonical: "/x", inWorkspace: true, isDirectory: true } });
    const res = await callWorkspaceResolve(host, { path: "/x" });
    expect(res.inWorkspace).toBe(true);
  });

  it("check returns flags", async () => {
    const { host } = fakeHost({ "workspace.check": { inWorkspace: true, isDirectory: false, isFile: true, exists: true, ignored: false } });
    const res = await callWorkspaceCheck(host, { path: "/x" });
    expect(res.isFile).toBe(true);
  });

  it("listIgnored forwards max", async () => {
    const { host, calls } = fakeHost({ "workspace.listIgnored": [] });
    await callWorkspaceListIgnored(host, { max: 50 });
    expect(calls[0].params).toEqual({ max: 50 });
  });
});

describe("capability wrappers — audit", () => {
  it("append", async () => {
    const { host, calls } = fakeHost({ "audit.append": { id: "1", kind: "test", outcome: "success", action: "x", payloadHash: "h", at: "2026-09-23" } });
    await callAuditAppend(host, { kind: "test", outcome: "success", action: "x" });
    expect(calls[0].method).toBe("audit.append");
  });

  it("tail", async () => {
    const { host } = fakeHost({ "audit.tail": { entries: [], rotatedFiles: 0 } });
    const res = await callAuditTail(host, { limit: 10 });
    expect(res.rotatedFiles).toBe(0);
  });
});

describe("capability wrappers — error propagation", () => {
  it("propagates host.call errors", async () => {
    const host = {
      async call() { throw new Error("backend down"); },
    };
    await expect(callSecretsGet(host as any, { ref: "x" })).rejects.toThrow(/backend down/);
  });
});
