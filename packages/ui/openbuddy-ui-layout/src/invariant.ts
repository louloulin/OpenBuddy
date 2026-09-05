/**
 * @openbuddy/ui-layout/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-layout-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the AppFrame is a pure React component whose
 * slot dispatches are pure reads against the SlotCore registry. The
 * renderer-host SlotCore's load-time validation (no duplicate children
 * declaration, no unregistered slot, no shared handle scope violation)
 * is the contract.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
