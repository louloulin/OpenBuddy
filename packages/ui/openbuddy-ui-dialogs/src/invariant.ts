/**
 * @openbuddy/ui-dialogs/invariant — package-owned invariant companion.
 *
 * No runtime invariant: dialogs are pure presentation over local React
 * state. Store interactions (feedback-store, permission-store) are
 * emitted as side-effects that the renderer-host event bus picks up;
 * the dialog itself doesn't depend on plugin ordering.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-dialogs-invariant";
export const inject = ["invariants"] as const;

export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
