/**
 * @openbuddy/ui-hmr/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-hmr-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: HMR dispose ordering is enforced by Vite; double-
 * dispose is idempotent. Profile-reload semantics are owned by
 * renderer-plugin-runtime's bridge.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
