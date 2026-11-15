/**
 * Branch switcher ‹1/2› (20261116-pii W1.1, Pi S1): `agent_tree` / `agent_navigate`.
 * Regenerating or editing a prompt leaves the old answer on its own branch of the session tree;
 * these DTOs describe the sibling versions of each user turn on the current path.
 */

/** One version of a user turn. */
export interface BranchSibling {
  /** Entry id of this version's user message. */
  entryId: string;
  /** What `agent_navigate` takes to show this version: the newest entry of its branch. */
  leafId: string;
  /** Message timestamp (ms). */
  timestamp: number;
  /** First words of the prompt. */
  preview: string;
  /** Files changed by tool calls on this version's branch (absolute paths, at most 50). */
  files: string[];
}

/** A user turn on the current path. */
export interface BranchTurn {
  /** Entry id of the user message on the current path. */
  entryId: string;
  /** Its message timestamp (ms): the renderer matches transcript turns by it. */
  timestamp: number;
  /** 0-based position of the current version among its siblings (oldest first). */
  index: number;
  /** Number of versions (1 = no other branch). */
  total: number;
  /** All versions, oldest first; empty when `total` is 1. */
  siblings: BranchSibling[];
}

export interface BranchTree {
  sessionId: string;
  leafId: string | null;
  turns: BranchTurn[];
}

export interface NavigateOptions {
  /** Summarize the abandoned branch into a branch-summary entry (Pi `navigateTree({ summarize })`). */
  summarize?: boolean;
  /**
   * Put the workspace files back to the target branch's state before switching (U2.4 linkage).
   * `force` overwrites files changed since; `skip` leaves those paths alone.
   */
  restoreFiles?: boolean | { force?: boolean; skip?: string[] };
}

export interface NavigateFileConflict {
  path: string;
  reason: 'changed_since' | 'missing_snapshot';
}

export interface NavigateResult {
  /** False when nothing moved: files changed since need a decision (`conflicts`). */
  navigated: boolean;
  /** Files written back to the target branch's state. */
  restored: string[];
  conflicts: NavigateFileConflict[];
  /** Set when the target version has no reply yet: its prompt goes back to the composer. */
  editorText?: string;
  /** A branch summary was written for the abandoned branch. */
  summarized?: boolean;
}
