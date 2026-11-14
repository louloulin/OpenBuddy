export const EVENTS = [
  'agent://update', 'agent://tool', 'agent://complete', 'agent://queue', 'agent://compaction',
  'agent://retry', 'agent://session-info', 'agent://permission', 'agent://error',
  'agent://event', 'agent://summary', 'agent://turn-error', 'agent://folder-trust',
  'agent://permission-mode', 'agent://models-update', 'agent://mcp-status', 'window://resized',
  'agent://model-state', 'agent://ui-request', 'agent://ui-dismiss', 'agent://ui-notification', 'agent://ui-state',
  'agent://session-status', 'agent://permission-dismiss', 'agent://artifacts', 'app://focus-session',
] as const;
export type EventName = typeof EVENTS[number];
export const isEvent = (value: unknown): value is EventName => typeof value === 'string' && (EVENTS as readonly string[]).includes(value);
