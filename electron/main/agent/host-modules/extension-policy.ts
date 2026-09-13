/**
 * extension-policy.ts — pure policy + audit trail for pi extension
 * resolution (plan4.4 §E).
 *
 * ## Why this module exists
 *
 * `electron/main/agent/pi-extensions.ts::resolvePiExtensions` already
 * owns the policy decisions:
 *
 *   - `findCompatibilityAdapter(spec)` returns the matching adapter
 *     for known npm packages (passthrough OR canonical service).
 *   - `recordPassthrough(...)` records the decision so the Cordis
 *     capability plugin can short-circuit duplicate registrations.
 *   - `builtinPiExtensionFactories` is a fast allowlist for OpenBuddy
 *     built-in extensions.
 *
 * But the decision rationale lives in three different places, and
 * the renderer has no way to ask "why was pi-foo allowed / denied?".
 * This module factors the policy into a single pure function so:
 *
 *   1. `resolvePiExtensions` can call `policy.decide(...)` per spec and
 *      emit a consolidated `pi/extension-policy-report` event with the
 *      rationale.
 *   2. Tests can pin the decision matrix down without booting Electron.
 *   3. Renderer-side UI (e.g. an "Extension Audit" panel) can render
 *      the same report without re-implementing the policy.
 *
 * The module is pure: no IPC, no Electron deps, no side effects on
 * import. Vitest covers it without booting pi upstream.
 */

export type ExtensionPolicyAction = "allow" | "deny" | "needs-review";

export interface ExtensionPolicyDecision {
  action: ExtensionPolicyAction;
  reason: string;
}

export interface ExtensionPolicyInput {
  id: string;
  /** npm package name when the extension comes from a third-party package. */
  packageName?: string;
  /** True when the extension is one of OpenBuddy's built-ins. */
  builtIn?: boolean;
}

export interface ExtensionPolicy {
  /**
   * Decide what to do with a candidate extension. Always returns a
   * well-formed `ExtensionPolicyDecision`; never throws on missing
   * fields. The default policy denies everything that is not a
   * built-in or in the configured allowlist.
   */
  decide(input: ExtensionPolicyInput): ExtensionPolicyDecision;
}

export interface ExtensionPolicyOptions {
  /** Built-in extension IDs are always allowed (default: true). */
  allowBuiltins?: boolean;
  /** Package names that are vetted — always allowed. */
  allowlistPackageNames?: readonly string[];
  /** Package names that are explicitly blocked — never allowed. */
  denylistPackageNames?: readonly string[];
  /** Extension IDs that need manual review before they load. */
  needsReviewIds?: readonly string[];
  /** Package names that need manual review before they load. */
  needsReviewPackageNames?: readonly string[];
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asPackageName(input: ExtensionPolicyInput): string | undefined {
  if (typeof input.packageName === "string" && input.packageName.length > 0) {
    return input.packageName;
  }
  return undefined;
}

/**
 * Factory: build an `ExtensionPolicy` from the supplied option set.
 * The returned function is total (no throw on missing fields) and
 * deterministic — same input + options = same decision.
 */
export function createExtensionPolicy(
  options: ExtensionPolicyOptions = {},
): ExtensionPolicy {
  const allowBuiltins = options.allowBuiltins !== false; // default true
  const allowlist = asStringArray(options.allowlistPackageNames);
  const denylist = asStringArray(options.denylistPackageNames);
  const needsReviewIds = asStringArray(options.needsReviewIds);
  const needsReviewPackages = asStringArray(options.needsReviewPackageNames);

  return {
    decide(input) {
      if (!input || typeof input !== "object" || typeof input.id !== "string" || input.id.length === 0) {
        return { action: "deny", reason: "missing id" };
      }
      const id = input.id;
      const packageName = asPackageName(input);

      // 1. Denylist always wins — overrides allowlist / builtins so a
      //    misconfiguration cannot accidentally re-enable a blocked
      //    package via the allowlist side-channel.
      if (packageName && denylist.includes(packageName)) {
        return { action: "deny", reason: `package "${packageName}" is in denylist` };
      }

      // 2. needs-review takes precedence over allowlist so a package
      //    that is both vetted AND requires sign-off lands in the
      //    sign-off bucket.
      if (needsReviewIds.includes(id)) {
        return { action: "needs-review", reason: `id "${id}" requires manual review` };
      }
      if (packageName && needsReviewPackages.includes(packageName)) {
        return { action: "needs-review", reason: `package "${packageName}" requires manual review` };
      }

      // 3. Built-ins are always allowed when the default is enabled.
      if (allowBuiltins && input.builtIn === true) {
        return { action: "allow", reason: "OpenBuddy builtin extension" };
      }

      // 4. Package-name allowlist.
      if (packageName && allowlist.includes(packageName)) {
        return { action: "allow", reason: `package "${packageName}" is allowlisted` };
      }

      // 5. Default deny — explicit allowlist required for third-party
      //    packages. This is the principle-of-least-privilege default.
      return { action: "deny", reason: "extension is not allowlisted" };
    },
  };
}

export interface ExtensionPolicyReport {
  total: number;
  allowed: number;
  denied: number;
  needsReview: number;
  entries: ReadonlyArray<{
    input: ExtensionPolicyInput;
    decision: ExtensionPolicyDecision;
  }>;
}

/**
 * Summarise a batch of decisions into a single report tile. The
 * returned report is frozen so consumers can't accidentally mutate it
 * after rendering (e.g. a renderer hook that passes the report into
 * React state will not crash on re-render).
 */
export function describeExtensionPolicyReport(
  decisions: ReadonlyArray<{ input: ExtensionPolicyInput; decision: ExtensionPolicyDecision }>,
): ExtensionPolicyReport {
  let allowed = 0;
  let denied = 0;
  let needsReview = 0;
  for (const entry of decisions) {
    if (entry.decision.action === "allow") allowed += 1;
    else if (entry.decision.action === "deny") denied += 1;
    else if (entry.decision.action === "needs-review") needsReview += 1;
  }
  return Object.freeze({
    total: decisions.length,
    allowed,
    denied,
    needsReview,
    entries: decisions,
  });
}