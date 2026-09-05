/**
 * @openbuddy/ui-slots/invariant — package-owned invariant companion.
 *
 * The slot core's load-time validation is the contract; runtime invariants
 * live in @openbuddy/ui-runtime (which owns the actual SlotCore instance
 * bridge). This file exists to satisfy the three-registration-surfaces
 * convention (see packages/ui/AGENTS.md).
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-slots-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the slot core's load-time validation is the
 * contract (registering into an undeclared slot throws; declaring an
 * already-declared child throws; etc.). The runtime SlotCore wrapper
 * owns the cordis-event bridge and its invariants.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
