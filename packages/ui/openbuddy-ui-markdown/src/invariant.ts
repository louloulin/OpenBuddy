/**
 * @openbuddy/ui-markdown/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-markdown-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the markdown renderer is pure presentation over
 * a string input. Plugin ordering (katex/mermaid) is asserted by the
 * composition tests in the conversation package.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
