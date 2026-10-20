// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";

type Stub = { api: { apiVersion: number; invoke: ReturnType<typeof vi.fn>; dialog?: { save: ReturnType<typeof vi.fn> } } };

beforeEach(() => {
  (globalThis as unknown as Stub & { window: Stub }).window = {
    api: {
      apiVersion: 1,
      invoke: vi.fn(async () => ({ ok: true, path: "/tmp/x.jsonl", count: 0, bytes: 0, format: "jsonl" })),
    },
  };
});

describe("audit-client:auditExport", () => {
  it("调用 invoke('audit:export') 并把 path/format/limit 透传过去", async () => {
    const { auditExport } = await import("../audit-client");
    await auditExport({ path: "/tmp/user-picked.jsonl", format: "jsonl", limit: 100 });
    const api = (globalThis as unknown as { window: { api: { invoke: ReturnType<typeof vi.fn> } } }).window.api;
    expect(api.invoke).toHaveBeenCalledWith("audit:export", {
      path: "/tmp/user-picked.jsonl",
      format: "jsonl",
      limit: 100,
    });
  });

  it("失败时把 error 字段透出来", async () => {
    const { auditExport } = await import("../audit-client");
    const api = (globalThis as unknown as { window: { api: { invoke: ReturnType<typeof vi.fn> } } }).window.api;
    api.invoke.mockResolvedValueOnce({ ok: false, error: "导出路径必须来自保存对话框" });
    const result = await auditExport({ path: "/etc/passwd" });
    expect(result).toEqual({ ok: false, error: "导出路径必须来自保存对话框" });
  });
});
