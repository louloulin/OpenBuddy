import type { SessionEntry } from "@earendil-works/pi-coding-agent";
/**
 * Per-session state for built-in extensions (20261116-pii §5, S7). State lives in custom
 * session entries on the conversation tree, so forks, branch switches and regenerations see the
 * state of their own branch with no extra bookkeeping. Custom entries never reach the model
 * (`buildSessionContext` ignores them).
 *
 * Every built-in uses a `customType` of the form `openbuddy.<id>` (e.g. `openbuddy.mode`).
 */
export interface BranchReader {
  getBranch(fromId?: string): SessionEntry[];
}
export interface EntryWriter {
  appendCustomEntry(customType: string, data?: unknown): string;
}

/** Latest `data` of `customType` on the current branch (leaf → root), or undefined. */
export function readBranchState<T>(sm: BranchReader, customType: string, fromId?: string): T | undefined {
  const branch = sm.getBranch(fromId);
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === customType) return entry.data as T;
  }
  return undefined;
}

/** Every `data` of `customType` on the current branch, oldest first. */
export function readBranchHistory<T>(sm: BranchReader, customType: string, fromId?: string): T[] {
  const out: T[] = [];
  for (const entry of sm.getBranch(fromId)) if (entry.type === "custom" && entry.customType === customType) out.push(entry.data as T);
  return out;
}

/**
 * Append a state entry unless the branch already ends on an equal value (keeps the tree free of
 * no-op entries when a setting is re-applied). Returns the new entry id, or undefined if skipped.
 */
export function writeBranchState(sm: BranchReader & EntryWriter, customType: string, data: unknown): string | undefined {
  const current = readBranchState<unknown>(sm, customType);
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(data)) return undefined;
  return sm.appendCustomEntry(customType, data);
}
