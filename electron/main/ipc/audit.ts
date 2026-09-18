/**
 * IPC surface — Audit Trail (R17 / Phase D).
 *
 * Local-first audit viewer exposed to the renderer. Four channels:
 *   - audit:list      paginated read (newest last)
 *   - audit:record    append a renderer-side event (settings open, ...)
 *   - audit:clear     wipe local file (no remote backup, by design)
 *   - audit:export    write a copy to a path the user picked (R41)
 *
 * 导出是「本地优先 · 数据自决」的最后一公里:数据本来就只在本机,但"能不能
 * 拿走、拿去给谁看"必须由用户自己决定 —— 所以导出目标一律走原生保存对话框,
 * 并且复用 `export_text_file` 那套一次性审批(`./save-path-approval`),
 * 不接受渲染层直接给绝对路径。
 */
import { ipcMain, type BrowserWindow } from "electron";
import { auditTrail } from "../audit/audit-log";
import { requireApprovedSavePath } from "./save-path-approval";

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

  ipcMain.handle("audit:export", async (_e, args?: { path?: string; format?: string; limit?: number }) => {
    if (!args?.path || typeof args.path !== "string") {
      return { ok: false as const, error: "缺少导出路径:请先在保存对话框里选一个目标文件" };
    }
    let target: string;
    try {
      target = requireApprovedSavePath(args.path);
    } catch (error) {
      // 未经过保存对话框审批 —— 明确报错,绝不"换个地方写"。
      return { ok: false as const, error: String((error as Error)?.message ?? error) };
    }
    const format = args.format === "json" ? "json" : "jsonl";
    try {
      const result = await auditTrail.exportTo(target, {
        format,
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
      return { ok: true as const, ...result };
    } catch (error) {
      return { ok: false as const, error: String((error as Error)?.message ?? error) };
    }
  });
}
