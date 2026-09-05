/**
 * @openbuddy/ui-automation/invariant — package-owned invariant companion.
 *
 * No runtime invariant: automation panels are mounted directly by the
 * assistant placeholder / ChatView and read/write the same cordis
 * services (automations_snapshot, tasks-list, plan-utils) as the rest
 * of the app; plugin ordering is asserted by the conversation package.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-automation-invariant";
export const inject = ["invariants"] as const;

export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
