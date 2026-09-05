/**
 * @openbuddy/ui-locale/invariant — package-owned invariant companion.
 */

import type { Context } from "@openbuddy/cordis";

export const name = "ui-locale-invariant";
export const inject = ["invariants"] as const;

/**
 * No runtime invariant: locale changes emit no cordis events; the dict
 * lookup is a pure synchronous function over (currentLocale, namespaces).
 * Missing-key behavior (returns the key string) is the contract.
 */
export async function apply(_ctx: Context): Promise<() => void> {
  return () => {};
}
