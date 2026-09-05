/**
 * @openbuddy/ui-modules/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-modules-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: ClientModuleSystem validation lives in
 * renderer-host (bootGraph manifest mismatch throws at boot).
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
