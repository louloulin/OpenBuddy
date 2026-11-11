export const COMMANDS = [
  'agent_init', 'agent_send', 'agent_cancel', 'agent_shutdown', 'agent_auth_status',
  'agent_new_session', 'agent_load_session', 'agent_list_sessions', 'agent_delete_session',
  'agent_rename_session', 'agent_set_session_pinned', 'agent_set_session_archived',
  'agent_session_info', 'agent_session_usage', 'agent_set_model', 'agent_list_workspaces',
  'agent_resolve_permission', 'agent_resolve_question', 'folder_trust_respond',
  'permission_list', 'permission_save', 'permission_mode_get', 'permission_mode_set',
  'providers_list', 'providers_save_provider', 'providers_save_model', 'providers_delete_provider',
  'providers_delete_model', 'providers_fetch_models', 'account_get_api_key', 'account_set_api_key',
  'read_text_file', 'write_text_file', 'read_file_base64', 'export_text_file', 'list_dir',
  'browse_directory', 'path_stat', 'open_path', 'open_url', 'reveal_in_folder',
  'mcp_list', 'mcp_upsert', 'mcp_toggle', 'mcp_delete', 'mcp_config_read', 'mcp_config_save',
  'mcp_config_path', 'mcp_auth_trigger', 'mcp_auth_status', 'skills_list', 'skills_add',
  'skills_remove', 'skills_toggle', 'commands_list', 'notification_list', 'notification_append',
  'notification_mark_read', 'notification_mark_all_read', 'notification_clear',
  'agents_defaults_get', 'agents_defaults_save', 'dialog_open', 'dialog_save', 'dialog_ask',
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized',
] as const;
export const EVENTS = [
  'agent://update', 'agent://tool', 'agent://complete', 'agent://queue', 'agent://compaction',
  'agent://retry', 'agent://session-info', 'agent://permission', 'agent://error',
  'agent://event', 'agent://summary', 'agent://turn-error', 'agent://folder-trust',
  'agent://permission-mode', 'agent://models-update', 'agent://mcp-status', 'window://resized',
] as const;
export type CommandName = typeof COMMANDS[number];
export type EventName = typeof EVENTS[number];
export type Payload = Record<string, unknown>;
export type CommandHandlers = Record<string, (payload: Payload) => unknown | Promise<unknown>>;
export const isCommand = (value: unknown): value is CommandName => typeof value === 'string' && (COMMANDS as readonly string[]).includes(value);
export const isEvent = (value: unknown): value is EventName => typeof value === 'string' && (EVENTS as readonly string[]).includes(value);

/** Bound structured-clone input before dispatch; services validate their domain fields. */
export function validatePayload(input: unknown): Payload {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('invalid_payload: expected object');
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 20) throw new Error('invalid_payload: too complex');
    if (typeof value === 'string' && value.length > 8 * 1024 * 1024) throw new Error('invalid_payload: string too long');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid_payload: forbidden key');
        visit(child, depth + 1);
      }
    } else if (!['undefined', 'string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new Error('invalid_payload: unsupported value');
  };
  visit(input, 0);
  return input as Payload;
}
