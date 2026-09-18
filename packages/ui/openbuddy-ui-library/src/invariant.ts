/**
 * @openbuddy/ui-library/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-library-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: the page is a pure view over the `library.section`
 * slot (the contract is asserted by `__tests__/library-sections.test.ts`),
 * and every section delegates its data to the owning package.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
