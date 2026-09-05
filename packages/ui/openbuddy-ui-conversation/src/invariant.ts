/**
 * @openbuddy/ui-conversation/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-conversation-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the conversation column is pure presentation
 * over session-store messages, tool call views, and per-session renderer
 * slots. Message ordering and slot presence are asserted by the
 * conversation's own layout (header / scroll / composer pinning).
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
