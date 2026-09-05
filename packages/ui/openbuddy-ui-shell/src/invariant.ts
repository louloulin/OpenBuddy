/**
 * @openbuddy/ui-shell/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-shell-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: shell chrome is pure presentation over
 * existing stores. Wiring is asserted by the App-level mount.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
