// Lifecycle event primitives shared by agent-host, deepseek-runtime, and harness-server. Encodes the durable revisions that the canonical Pi JSONL session writes as `custom` entries under the `openbuddy/lifecycle` customType.
import { createHash } from "node:crypto";

export const OPENBUDDY_LIFECYCLE_CUSTOM_TYPE = "openbuddy/lifecycle";

export type OpenBuddyLifecycleOperation = "agent-setup" | "agent-lease" | "rpc";
export type OpenBuddyLifecyclePhase =
  | "begin"
  | "commit"
  | "rollback"
  | "renew"
  | "release"
  | "intent"
  | "claim"
  | "resolve"
  | "uncertain";

export type OpenBuddyLifecycleEvent = {
  version: 1;
  operation: OpenBuddyLifecycleOperation;
  phase: OpenBuddyLifecyclePhase;
  revision: number;
  timestamp: number;
  agentId?: string;
  sessionId?: string;
  caller?: string;
  authority?: "trusted-host" | "loopback";
  owner?: string;
  leaseTokenHash?: string;
  rpcId?: string;
  fingerprint?: string;
  claimHash?: string;
  method?: string;
  status?: string;
  reason?: string;
  recoveredRevision?: number;
};

export function hashLifecycleSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function lifecycleEvent(
  event: Omit<OpenBuddyLifecycleEvent, "version" | "timestamp"> & { timestamp?: number },
): OpenBuddyLifecycleEvent {
  return {
    version: 1,
    timestamp: event.timestamp ?? Date.now(),
    ...event,
  };
}

export function lifecycleEntry(event: OpenBuddyLifecycleEvent): { version: 1; event: OpenBuddyLifecycleEvent } {
  return { version: 1, event };
}

export function lifecycleRevisionFromEntries(entries: readonly unknown[]): number {
  let revision = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || (entry as { type?: unknown }).type !== "custom") continue;
    const custom = entry as { customType?: unknown; data?: unknown };
    if (custom.customType !== OPENBUDDY_LIFECYCLE_CUSTOM_TYPE || !custom.data || typeof custom.data !== "object") continue;
    const event = (custom.data as { event?: unknown }).event;
    if (!event || typeof event !== "object") continue;
    const candidate = (event as { revision?: unknown }).revision;
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > revision) revision = candidate;
  }
  return revision;
}