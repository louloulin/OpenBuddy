import { createHash } from "node:crypto";

export const pluginPermissions = [
  "filesystem.read", "filesystem.write", "shell", "network", "credentials", "ui.interaction",
] as const;
export type PluginPermission = (typeof pluginPermissions)[number];

export interface PluginSecurityDescriptor {
  pluginId: string;
  source: "builtin" | "local" | "registry" | "unknown";
  permissions: readonly PluginPermission[];
  contentHash?: string;
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
  if (policy.requireHashForSources?.includes(descriptor.source) && !descriptor.contentHash) {
    throw new PluginSecurityError(`content hash required for ${descriptor.source} plugins`);
  }
  if (descriptor.contentHash !== undefined && !/^sha256-[0-9a-f]{64}$/.test(descriptor.contentHash)) {
    throw new PluginSecurityError("contentHash must be a sha256 digest");
  }
  return {
    ...descriptor,
    permissions: [...new Set(descriptor.permissions)],
  };
}
