/**
 * @openbuddy/ui-home/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-home-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the home page is pure presentation. Wiring is
 * asserted by the App-level mount.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
