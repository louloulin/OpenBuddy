/**
 * @openbuddy/ui-settings-models/invariant — package-owned invariant companion.
 *
 * No runtime invariant: model provider config is purely declarative;
 * reactivity comes from the settings panel store when the content
 * package lands.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-settings-models-invariant";
export const inject = ["invariants"] as const;

export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
