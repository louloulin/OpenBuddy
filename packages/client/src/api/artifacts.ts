// §5.3 `artifacts` module: artifacts_list, checkpoint_list / read / restore, turn_revert, artifact_save.
import { invoke } from "../ipc";

// ── 产物 / 文件快照 (20261115-ui U1/U2) ──────────────────────────────────

/** A file the agent created or modified in a session (write/edit only). */
export interface ArtifactInfo {
  path: string;
  status: "created" | "modified";
  toolCallIds: string[];
  added: number;
  removed: number;
  firstAt: number;
  lastAt: number;
  exists: boolean;
  size?: number;
  /** Written from an answer's code block with 「应用」. */
  applied?: boolean;
}

/** A file's content right before / after one change (sha256 of each; null = absent). */
export interface CheckpointRecord {
  id: string;
  toolCallId?: string;
  path: string;
  before: string | null;
  after: string | null;
  at: number;
  source: "tool" | "user" | "restore" | "apply";
  skipped?: "too_large";
}

export interface RevertResult {
  restored: string[];
  conflicts: { path: string; reason: "changed_since" | "missing_snapshot" }[];
}

export const artifactsList = (sessionId: string) => invoke<ArtifactInfo[]>("artifacts_list", { sessionId });
export const checkpointList = (sessionId: string, path?: string) => invoke<CheckpointRecord[]>("checkpoint_list", path ? { sessionId, path } : { sessionId });
export const checkpointRead = (sessionId: string, hash: string) => invoke<{ text?: string; binary: boolean; size: number }>("checkpoint_read", { sessionId, hash });
export const checkpointRestore = (sessionId: string, path: string, hash: string | null) => invoke<void>("checkpoint_restore", { sessionId, path, hash });
export const turnRevert = (sessionId: string, toolCallIds: string[], opts: { skip?: string[]; force?: boolean } = {}) =>
  invoke<RevertResult>("turn_revert", { sessionId, toolCallIds, ...(opts.skip ? { skip: opts.skip } : {}), ...(opts.force ? { force: true } : {}) });
export const artifactSave = (sessionId: string, path: string, content: string, origin?: "apply") => invoke<void>("artifact_save", { sessionId, path, content, ...(origin ? { origin } : {}) });
