/**
 * @openbuddy/ui-files-tree/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-files-tree-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the tree helpers are pure functions over Node[]
 * (asserted by lib/tree-utils.test.ts) and the component is a controlled
 * view over the host's data.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
