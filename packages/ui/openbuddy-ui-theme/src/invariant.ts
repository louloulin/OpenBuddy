/**
 * @openbuddy/ui-theme/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-theme-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the theme store emits no cordis events;
 * toggle/setPreference are pure synchronous state writes. Wiring is
 * asserted by the ThemeProvider test.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
