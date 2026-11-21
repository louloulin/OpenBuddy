export const EVENTS = [
  'agent://update', 'agent://tool', 'agent://complete', 'agent://queue', 'agent://compaction',
  'agent://retry', 'agent://session-info', 'agent://permission', 'agent://error',
  'agent://event', 'agent://summary', 'agent://turn-error', 'agent://folder-trust',
  'agent://permission-mode', 'agent://models-update', 'agent://mcp-status', 'agent://mcp-auth', 'window://resized',
  'agent://model-state', 'agent://ui-request', 'agent://ui-dismiss', 'agent://ui-notification', 'agent://ui-state',
  'agent://session-status', 'agent://permission-dismiss', 'agent://artifacts', 'app://focus-session',
  'agent://plan', 'agent://connector-needed', 'agent://subagent', 'agent://automation',
  // 通知渠道 (pii W4.6): a turn finished that is not the session on screen — notify even in the foreground.
  'agent://background-notice',
  // 扩展包安装进度 (pii W2.6 P2): npm / git install / update progress.
  'agent://extension-progress',
] as const;
export type EventName = typeof EVENTS[number];
export const isEvent = (value: unknown): value is EventName => typeof value === 'string' && (EVENTS as readonly string[]).includes(value);
