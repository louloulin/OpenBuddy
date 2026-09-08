/**
 * host-modules/profile/contributions-pure.ts — stateless helpers for profile
 * remote/typert contribution assembly.
 *
 * Extracted from agent-host.ts (module split): these two functions are pure
 * (no `state` access, no module-level mutable singletons), so they live in
 * the profile domain and can be unit-tested independently. agent-host.ts
 * imports them so the artifact reconciliation call sites keep working.
 *
 * Direction:
 *   contributions-pure.ts  ←  (only imports /deepseek + /harness types)
 *       ↑
 *   agent-host.ts  (assembles `state` around these pure steps)
 */

import type { RemoteContribution } from "../../../harness/remote-dispatch";
import { deepSeekCapabilityDefinitions } from "../../../deepseek/deepseek-capabilities";
import type { TypertHostContribution } from "@openbuddy/plugin-host";

/**
 * One installed typert host contribution + its disposers (reverse-release
 * ordering guarantees child disposers run before their parent).
 */
export type ProfileTypertRegistration = {
  contribution: TypertHostContribution;
  dispose: () => void;
  remoteDispose?: () => void;
};

/**
 * Canonicalize a published remote contribution against the deepseek
 * capability definitions: rewrite `remoteExportX` exported method names to
 * their canonical `x` form, plus a backward-compatible alias, and pin the
 * descriptor to the canonical service key. Pure — no state, no side effects.
 */
export function normalizePublishedRemoteContribution(contribution: RemoteContribution): RemoteContribution {
  const definition = deepSeekCapabilityDefinitions.find((candidate) => candidate.packageName === contribution.package);
  if (!definition) return contribution;
  const descriptors = [...contribution.descriptors];
  const endpoints = new Set(descriptors.map((descriptor) => `${descriptor.namespace}/${descriptor.method}`));
  for (const descriptor of [...descriptors]) {
    const remoteExportMatch = /^remoteExport([A-Z][A-Za-z0-9_$.-]*)$/.exec(descriptor.method);
    const canonicalMethod = remoteExportMatch
      ? `${remoteExportMatch[1]![0]!.toLowerCase()}${remoteExportMatch[1]!.slice(1)}`
      : descriptor.implementation?.startsWith("remoteExport")
        ? descriptor.implementation.replace(/^remoteExport([A-Z])/, (_, first: string) => first.toLowerCase())
        : undefined;
    if (!canonicalMethod || !definition.methods.includes(canonicalMethod)) continue;
    const canonical = { ...descriptor, method: canonicalMethod, implementation: canonicalMethod, service: definition.serviceKey };
    const canonicalEndpoint = `${canonical.namespace}/${canonical.method}`;
    const existingCanonical = descriptors.find((candidate) => `${candidate.namespace}/${candidate.method}` === canonicalEndpoint);
    if (existingCanonical) {
      Object.assign(existingCanonical, { implementation: canonicalMethod, service: definition.serviceKey });
    } else {
      descriptors.push(canonical);
      endpoints.add(canonicalEndpoint);
    }
    const alias = { ...descriptor, implementation: canonicalMethod, service: definition.serviceKey };
    const aliasEndpoint = `${alias.namespace}/${alias.method}`;
    if (!endpoints.has(aliasEndpoint)) {
      descriptors.push(alias);
      endpoints.add(aliasEndpoint);
    } else {
      const existingAlias = descriptors.find((candidate) => `${candidate.namespace}/${candidate.method}` === aliasEndpoint);
      if (existingAlias) Object.assign(existingAlias, { implementation: canonicalMethod, service: definition.serviceKey });
    }
  }
  return { ...contribution, descriptors };
}

/**
 * Dispose typert host registrations in reverse order so child disposers run
 * before their parent. Pure — only drives the passed-in disposers.
 */
export function disposeProfileTypertRegistrations(registrations: Iterable<ProfileTypertRegistration>): void {
  for (const entry of [...registrations].reverse()) {
    entry.remoteDispose?.();
    entry.dispose();
  }
}
