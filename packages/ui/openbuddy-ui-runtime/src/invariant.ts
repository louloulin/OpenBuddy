/**
 * @openbuddy/ui-runtime/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-runtime-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the SlotProvider mounts a singleton with a
 * single creator call. Sessions/workspaces stores emit via subscribe()
 * but no cordis event semantics — the renderer-plugin-runtime already
 * asserts the bridge contract.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
