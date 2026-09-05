/**
 * @openbuddy/ui-sidebar/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-sidebar-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: sidebar pieces are pure presentation over
 * the sessions store / skills API. Wiring is asserted by the App-level
 * mount.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
