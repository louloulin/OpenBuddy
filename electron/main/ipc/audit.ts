/**
 * IPC surface — Audit Trail (R17 / Phase D).
 *
 * Local-first audit viewer exposed to the renderer. Three channels:
 *   - audit:list      paginated read (newest last)
 *   - audit:record    append a renderer-side event (settings open, ...)
 *   - audit:clear     wipe local file (no remote backup, by design)
 */
import { ipcMain, type BrowserWindow } from "electron";
import { auditTrail } from "../audit/audit-log";

const LIST_LIMIT_MAX = 1000;

export function registerAuditIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("audit:list", async (_e, args?: { limit?: number; cursor?: string }) => {
    const limit = Math.min(Math.max(1, Math.floor(args?.limit ?? 200)), LIST_LIMIT_MAX);
    return auditTrail.list(limit, args?.cursor);
  });

  ipcMain.handle("audit:record", async (_e, args?: { event?: string; outcome?: "allow" | "deny" | "success" | "failure" | "info"; subject?: string; detail?: Record<string, unknown> }) => {
    if (!args?.event || typeof args.event !== "string") {
      return { ok: false, error: "缺少事件名" };
    }
    const allowedOutcomes = new Set(["allow", "deny", "success", "failure", "info"] as const);
    const outcome = (args.outcome && allowedOutcomes.has(args.outcome)) ? args.outcome : "info";
    const event = await auditTrail.record({
      event: args.event.slice(0, 64),
      outcome,
      subject: args.subject?.slice(0, 96),
      detail: args.detail && typeof args.detail === "object" ? args.detail : undefined,
      source: "renderer",
    });
    // 只回传 id + 关键字段,避免序列化完整 detail 对象过 IPC 时撞到
    // context bridge 的结构化克隆边界。
    return { ok: true as const, id: event.id, at: event.at };
  });

  ipcMain.handle("audit:clear", async () => {
    await auditTrail.clear();
    return { ok: true };
  });
}
