/**
 * @openbuddy/ui-settings/invariant — package-owned invariant companion.
 *
 * No runtime invariant: the settings panel host declares slots only;
 * each per-domain settings package owns its content and reactivity.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-settings-invariant";
export const inject = ["invariants"] as const;

export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
