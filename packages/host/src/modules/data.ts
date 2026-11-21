import type { HostModuleFactory } from "../module.js";
import { DataBackupService } from "@openbuddy/services/persistence/backup";

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
      data_snapshot_restore: (payload) => {
        const id = payload.id;
        if (typeof id !== "string" || !id.trim() || id.length > 200) throw new Error("invalid_snapshot_id");
        return service.restoreSnapshot(id);
      },
    },
  };
};
