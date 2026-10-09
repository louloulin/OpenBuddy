import { createHash, timingSafeEqual } from "node:crypto";

export const pluginPermissions = [
  "filesystem.read", "filesystem.write", "shell", "network", "credentials", "ui.interaction",
] as const;
export type PluginPermission = (typeof pluginPermissions)[number];

export interface PluginSecurityDescriptor {
  pluginId: string;
  source: "builtin" | "local" | "registry" | "unknown";
  permissions: readonly PluginPermission[];
  contentHash?: string;
  /**
   * The bytes the hash was taken over. Supplying it is what turns
   * `contentHash` from a self-attestation into a checked claim — see
   * `assertContentHashMatches`. Required for sources listed in
   * `requireHashForSources`.
   */
  content?: string | Uint8Array;
}

export interface PluginSecurityPolicy {
  allowedSources?: readonly PluginSecurityDescriptor["source"][];
  allowedPermissions?: readonly PluginPermission[];
  requireHashForSources?: readonly PluginSecurityDescriptor["source"][];
}

export class PluginSecurityError extends Error {
  readonly code = "plugin-security-rejected" as const;
  constructor(readonly reason: string) {
    super(`plugin security rejected: ${reason}`);
    this.name = "PluginSecurityError";
  }
}

export function hashPluginContent(content: string | Uint8Array): string {
  return `sha256-${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * Recompute the digest over the actual bytes and compare it with the
 * declared `contentHash`.
 *
 * Without this, `contentHash` only proved that somebody typed 64 hex
 * characters — a tampered plugin re-declared its own (well-formed) hash
 * and sailed through. Comparison is length-guarded because
 * `timingSafeEqual` throws on mismatched buffer lengths, and done over
 * raw digest bytes rather than the hex strings.
 */
export function assertContentHashMatches(descriptor: PluginSecurityDescriptor): void {
  const { contentHash, content } = descriptor;
  if (contentHash === undefined || content === undefined) return;
  const declared = Buffer.from(contentHash, "utf-8");
  const actual = Buffer.from(hashPluginContent(content), "utf-8");
  if (declared.length !== actual.length || !timingSafeEqual(declared, actual)) {
    throw new PluginSecurityError("contentHash does not match plugin content");
  }
}

export function validatePluginSecurity(
  descriptor: PluginSecurityDescriptor,
  policy: PluginSecurityPolicy = {},
): PluginSecurityDescriptor {
  if (!descriptor.pluginId.trim()) throw new PluginSecurityError("pluginId is required");
  if (policy.allowedSources !== undefined && !policy.allowedSources.includes(descriptor.source)) {
    throw new PluginSecurityError(`source ${descriptor.source} is not allowed`);
  }
  const allowed = policy.allowedPermissions ?? pluginPermissions;
  const denied = descriptor.permissions.filter((permission) => !allowed.includes(permission));
  if (denied.length > 0) throw new PluginSecurityError(`permissions denied: ${denied.join(", ")}`);
  const hashRequired = policy.requireHashForSources?.includes(descriptor.source) === true;
  if (hashRequired && (!descriptor.contentHash || descriptor.content === undefined)) {
    throw new PluginSecurityError(`content and hash required for ${descriptor.source} plugins`);
  }
  if (descriptor.contentHash !== undefined && !/^sha256-[0-9a-f]{64}$/.test(descriptor.contentHash)) {
    throw new PluginSecurityError("contentHash must be a sha256 digest");
  }
  assertContentHashMatches(descriptor);
  return {
    ...descriptor,
    permissions: [...new Set(descriptor.permissions)],
  };
}
