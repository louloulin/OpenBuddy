// 用量统计 (pii W5.6): the host aggregates per-session tokens / cost by day, model and expert.
import type { UsageSnapshot } from "@openbuddy/protocol/usage";
import { invoke } from "../ipc";

export type { UsageSnapshot };

export async function usageSnapshot(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("usage_snapshot");
}
