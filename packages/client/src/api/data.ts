// 数据管理 (A2): full export / restore + automatic snapshots.
import { invoke } from "../ipc";

export interface DataBundle {
  kind: "openbuddy-data";
  schemaVersion: number;
  exportedAt: string;
  files: Record<string, unknown>;
  omitted: string[];
}

export interface DataSnapshot {
  id: string;
  at: string;
  label: string;
  schemaVersion: number;
  files: Array<{ name: string; bytes: number }>;
}

export interface DataRestoreResult {
  restored: string[];
  skipped: string[];
  snapshotId?: string;
  restartRequired: true;
}

export const dataExport = () => invoke<{ bundle: DataBundle }>("data_export", {});

export const dataRestore = (bundle: DataBundle) => invoke<DataRestoreResult>("data_restore", { bundle });

export const dataSnapshots = () => invoke<{ snapshots: DataSnapshot[] }>("data_snapshots", {});

export const dataSnapshotRestore = (id: string) => invoke<DataRestoreResult>("data_snapshot_restore", { id });
