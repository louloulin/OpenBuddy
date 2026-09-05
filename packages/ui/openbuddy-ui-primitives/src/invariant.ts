/**
 * @openbuddy/ui-primitives/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-primitives-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: every primitive is a pure stateless component.
 * a11y labels and focus order are asserted by component tests, not by
 * cordis events.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
