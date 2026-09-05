/**
 * @openbuddy/ui-experts/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-experts-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the experts panel renders pure presentation
 * over expert/skill/connector catalog data fetched through the agent
 * runtime. Catalog freshness is asserted by the panel's own loading
 * states, not by a runtime invariant.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
