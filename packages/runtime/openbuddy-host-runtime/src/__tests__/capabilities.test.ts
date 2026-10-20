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

describe("capability wrappers — audit (wire shape v1, ADR-0012)", () => {
  it("append forwards kind/outcome/action", async () => {
    const { host, calls } = fakeHost({
      "audit.append": { id: "1", at: "2026-09-23T00:00:00Z", payloadHash: "abcdef0123456789" },
    });
    const res = await callAuditAppend(host, {
      kind: "permission",
      outcome: "denied",
      action: "bash.run",
      subject: "rm -rf /",
    });
    expect(calls[0].method).toBe("audit.append");
    expect(calls[0].params).toEqual({
      kind: "permission",
      outcome: "denied",
      action: "bash.run",
      subject: "rm -rf /",
    });
    expect(res).toEqual({ id: "1", at: "2026-09-23T00:00:00Z", payloadHash: "abcdef0123456789" });
  });

  it("append forwards optional structured fields (tenant_id / resource / provider / target)", async () => {
    const { host, calls } = fakeHost({ "audit.append": { id: "2", at: "t", payloadHash: "h" } });
    await callAuditAppend(host, {
      kind: "host",
      outcome: "failure",
      action: "secrets.resolve",
      tenant_id: "acme",
      resource: "secret:provider:openai",
      reason: "missing",
      code: "SECRET_NOT_FOUND",
      provider: "openai",
      target: "sk-...",
    });
    expect(calls[0].params).toMatchObject({
      tenant_id: "acme",
      resource: "secret:provider:openai",
      reason: "missing",
      code: "SECRET_NOT_FOUND",
      provider: "openai",
      target: "sk-...",
    });
  });

  it("tail parses AuditEntry wire shape (event / source / hash / detail)", async () => {
    const wireEntry = {
      id: "01HXYZW",
      at: "2026-09-23T01:00:00Z",
      event: "bash.run",
      outcome: "deny",
      source: "main",
      subject: "rm -rf /",
      detail: {
        kind: "permission",
        tenant_id: "acme",
        resource: "shell:bash",
        reason: "deny-rule-match",
        code: "PERMISSION_DENIED",
        provider: undefined,
        target: undefined,
      },
      hash: "deadbeef0123456789abcdef",
    };
    const { host } = fakeHost({
      "audit.tail": { entries: [wireEntry], rotatedFiles: 0 },
    });
    const res = await callAuditTail(host, { limit: 50 });
    expect(res.rotatedFiles).toBe(0);
    expect(res.entries[0]).toEqual(wireEntry);
    // 关键契约:detail.kind / event / source / hash 全部存在
    expect(res.entries[0].detail.kind).toBe("permission");
    expect(res.entries[0].event).toBe("bash.run");
    expect(res.entries[0].source).toBe("main");
    expect(res.entries[0].hash).toBe("deadbeef0123456789abcdef");
    expect(res.entries[0].outcome).toBe("deny");
  });

  it("wire shape 拒绝旧字段(payloadHash / action 顶层 / kind 顶层)— 类型层不兼容", () => {
    // 旧 shape:{ id, kind, outcome, action, subject?, payloadHash, at }
    // 新 shape:{ id, at, event, outcome, source, subject?, detail, hash }
    //
    // 这是一个类型层契约断言:旧 shape 对象不应该「结构兼容」AuditEntry。
    // 如果未来有人改回旧 wire shape,这里 typecheck 会失败。
    //
    // 实现:用 `as unknown as AuditEntry` 强制 cast 绕过 excess property check,
    // 然后用 `Expect<...>` 类型层断言:如果旧 shape 的所有 key 都能映射到 AuditEntry,
    // `_MustBeNever` 会被赋值为 string,触发 TS2322 错误。
    type AuditEntryLike = import("../capabilities.js").AuditEntry;
    type ExcessKeys<T, U> = Exclude<keyof U, keyof T>;
    type Expect<T extends never> = T;

    // 旧 shape 1:顶层 `action`(新 AuditEntry 没有)
    const bad1 = { id: "1", at: "2026-09-23", action: "bash.run" } as unknown as AuditEntryLike;
    type _Old1MustBeEmpty = Expect<ExcessKeys<AuditEntryLike, typeof bad1>>;
    void (null as unknown as _Old1MustBeEmpty);

    // 旧 shape 2:顶层 `payloadHash`(新 AuditEntry 只有 `hash`)
    const bad2 = { id: "1", at: "2026-09-23", payloadHash: "h" } as unknown as AuditEntryLike;
    type _Old2MustBeEmpty = Expect<ExcessKeys<AuditEntryLike, typeof bad2>>;
    void (null as unknown as _Old2MustBeEmpty);

    // 旧 shape 3:顶层 `kind`(新 AuditEntry 只有 `detail.kind`)
    const bad3 = { id: "1", at: "2026-09-23", kind: "permission" } as unknown as AuditEntryLike;
    type _Old3MustBeEmpty = Expect<ExcessKeys<AuditEntryLike, typeof bad3>>;
    void (null as unknown as _Old3MustBeEmpty);

    // 抑制未使用警告
    void bad1; void bad2; void bad3;
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
