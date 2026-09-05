export interface CapabilityEventContext {
  on(event: string, listener: (payload: unknown) => void): () => unknown;
}

export interface CapabilityEventBridgeOptions {
  context: CapabilityEventContext;
  getSessionId: () => string | undefined;
  emitPluginEvent: (type: string, payload: unknown) => unknown;
  emitRendererEvent: (channel: string, payload: unknown) => void;
}

type CapabilityBridge = {
  source: string;
  channel: string;
  eventType: string;
};

const bridges: readonly CapabilityBridge[] = [
  { source: "folder-trust/changed", channel: "pi://folder-trust", eventType: "folder-trust/changed" },
  { source: "plan/toggled", channel: "pi://plan-mode", eventType: "plan/toggled" },
  { source: "plan/pending", channel: "pi://plan-mode", eventType: "plan/pending" },
  { source: "plan/review-declined", channel: "pi://plan-mode", eventType: "plan/review-declined" },
  { source: "permission/mode-set", channel: "pi://permission-mode", eventType: "permission/mode-set" },
  { source: "mcp/ready", channel: "pi://mcp-status", eventType: "mcp/ready" },
  { source: "mcp/failed", channel: "pi://mcp-status", eventType: "mcp/failed" },
  { source: "mcp/close-failed", channel: "pi://mcp-status", eventType: "mcp/close-failed" },
  { source: "mcp/tool-start", channel: "pi://mcp-status", eventType: "mcp/tool-start" },
  { source: "mcp/tool-end", channel: "pi://mcp-status", eventType: "mcp/tool-end" },
  { source: "task/added", channel: "pi://task-update", eventType: "task/added" },
  { source: "task/updated", channel: "pi://task-update", eventType: "task/updated" },
  { source: "task/completed", channel: "pi://task-update", eventType: "task/completed" },
  { source: "task/removed", channel: "pi://task-update", eventType: "task/removed" },
  { source: "task/cleared", channel: "pi://task-update", eventType: "task/cleared" },
];

function clonePayload(payload: unknown): unknown {
  try {
    return structuredClone(payload);
  } catch {
    try {
      return JSON.parse(JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? Number(value) : value));
    } catch {
      return payload;
    }
  }
}

function withSessionId(payload: unknown, sessionId: string | undefined): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    return { ...record, ...(sessionId && typeof record.sessionId !== "string" ? { sessionId } : {}) };
  }
  return { value: payload, ...(sessionId ? { sessionId } : {}) };
}

function normalizeCapabilityPayload(bridge: CapabilityBridge, payload: unknown): unknown {
  // Renderer-side now uses Pi-native 5档 directly; no lossy 3档 (ask/auto/always-approve) re-projection needed.
  // IPC layer (electron/main/ipc.ts `toPiPermissionMode` / `fromPiPermissionMode`) already does 1:1 mapping.
  if (bridge.eventType !== "permission/mode-set" || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return payload;
}

export function bindCapabilityEventBridge(options: CapabilityEventBridgeOptions): () => void {
  const unsubs = bridges.map((bridge) => options.context.on(bridge.source, (payload) => {
    const safePayload = normalizeCapabilityPayload(bridge, clonePayload(payload));
    const payloadSessionId = safePayload && typeof safePayload === "object" && !Array.isArray(safePayload)
      ? (safePayload as { sessionId?: unknown }).sessionId
      : undefined;
    const sessionId = typeof payloadSessionId === "string" ? payloadSessionId : options.getSessionId();
    const eventPayload = withSessionId(safePayload, sessionId);
    options.emitPluginEvent(`capability/${bridge.eventType}`, eventPayload);
    options.emitRendererEvent(bridge.channel, eventPayload);
  }));

  return () => {
    for (const unsubscribe of unsubs) unsubscribe();
  };
}
