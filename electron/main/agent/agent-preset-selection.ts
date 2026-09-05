export interface AgentPresetSessionEntry {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
  message?: { role?: unknown };
}

export function resolveAgentPresetSelection(entries: readonly AgentPresetSessionEntry[]): string | null | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom") continue;
    if (entry.customType !== "openbuddy/agent-preset" && entry.customType !== "agent-preset/selected") continue;
    if (!entry.data || typeof entry.data !== "object") return null;
    const data = entry.data as { id?: unknown; agentPreset?: unknown };
    const value = data.agentPreset ?? data.id;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return undefined;
}

export function sessionHasConversation(entries: readonly AgentPresetSessionEntry[]): boolean {
  return entries.some((entry) => entry?.type === "message" && (entry.message?.role === "user" || entry.message?.role === "assistant"));
}
