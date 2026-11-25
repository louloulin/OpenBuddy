import type { HostModuleFactory } from "../module.js";
import { DataBackupService } from "@openbuddy/services/persistence/backup";
import { applyConversations, scanConversations } from "@openbuddy/services/data/import-conversations";
import { text } from "@openbuddy/services/settings/settings";

/**
 * 数据管理 (A2): export every versioned user-data file as one bundle, restore it (snapshotting
 * the current state first), and list/roll back to the automatic pre-migration snapshots.
 */
export const dataModule: HostModuleFactory = (ctx) => {
  const service = new DataBackupService(ctx.settings);
  return {
    id: "data",
    commands: {
      data_export: () => ({ bundle: service.exportBundle() }),
      data_restore: (payload) => service.restoreBundle(payload.bundle),
      data_snapshots: () => ({ snapshots: service.listSnapshots() }),
      // G4-3 外部会话导入: 只读扫描 + 以 Markdown 写进工作区（不伪造对话历史）。
      data_import_scan: (payload) => scanConversations(text(payload.path, "path")),
      data_import_apply: (payload) =>
        applyConversations(
          text(payload.path, "path"),
          Array.isArray(payload.ids) ? (payload.ids as string[]).filter((id): id is string => typeof id === "string") : [],
          text(payload.outputDir, "outputDir"),
        ),
      data_snapshot_restore: (payload) => {
        const id = payload.id;
        if (typeof id !== "string" || !id.trim() || id.length > 200) throw new Error("invalid_snapshot_id");
        return service.restoreSnapshot(id);
      },
    },
  };
};
