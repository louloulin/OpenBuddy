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
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized', 'window_edit', 'clipboard_write_text',
  'agent_get_model_state', 'agent_set_thinking_level', 'agent_resolve_ui',
  'agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue',
  'agent_fork_session', 'agent_extensions_list', 'agent_extensions_add',
  'agent_extensions_remove', 'agent_extensions_set_enabled', 'tasks_list', 'task_kill',
  'rewind_points', 'rewind_execute', 'agent_regenerate', 'agent_compact',
] as const;
export const EVENTS = [
  'agent://update', 'agent://tool', 'agent://complete', 'agent://queue', 'agent://compaction',
  'agent://retry', 'agent://session-info', 'agent://permission', 'agent://error',
  'agent://event', 'agent://summary', 'agent://turn-error', 'agent://folder-trust',
  'agent://permission-mode', 'agent://models-update', 'agent://mcp-status', 'window://resized',
  'agent://model-state', 'agent://ui-request', 'agent://ui-dismiss', 'agent://ui-notification', 'agent://ui-state',
  'agent://session-status', 'agent://permission-dismiss',
] as const;
export type CommandName = typeof COMMANDS[number];
export type EventName = typeof EVENTS[number];
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export interface ModelIdentity { providerId: string; modelId: string; modelKey: string }
export interface ModelState extends ModelIdentity { sessionId: string; thinkingLevel: ThinkingLevel; availableThinkingLevels: ThinkingLevel[] }
export interface UiRequest { sessionId: string; requestId: string; kind: 'select' | 'confirm' | 'input' | 'editor'; title: string; options?: string[]; message?: string; placeholder?: string; initialValue?: string; timeoutMs?: number }
export interface UiResolution { sessionId: string; requestId: string; value?: string | boolean; cancelled?: boolean }
export interface AttachmentReference { path: string }
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

/** Validate the renderer's new capability requests before trusted data is injected. */
export function validateCommandPayload(command: CommandName, input: unknown): Payload {
  const payload = validatePayload(input);
  const string = (key: string, max = 4096, optional = false) => {
    const value = payload[key];
    if (optional && (value === undefined || value === null)) return;
    if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw new Error(`invalid_payload: ${key}`);
  };
  const thinking = (key: string, optional = false) => {
    const value = payload[key];
    if (optional && (value === undefined || value === null)) return;
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(String(value))) throw new Error(`invalid_payload: ${key}`);
  };
  if (command === 'agent_compact') string('instructions', 4000, true);
  if (['rewind_points', 'rewind_execute', 'agent_regenerate', 'agent_compact', 'agent_get_model_state', 'agent_set_model', 'agent_set_thinking_level', 'agent_resolve_ui', 'agent_resolve_question', 'agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue', 'agent_fork_session'].includes(command)) string('sessionId', 256);
  if (command === 'agent_set_model' || command === 'agent_new_session') {
    string('modelId', 4096, command === 'agent_new_session');
    string('providerId', 512, true);
    if (command === 'agent_new_session') thinking('thinkingLevel', true);
  }
  if (command === 'providers_delete_model') { string('modelId'); string('providerId', 512, true); }
  if (command === 'agent_set_thinking_level') thinking('level');
  if (command === 'agent_resolve_ui' || command === 'agent_resolve_question') {
    string('requestId', 256);
    if (payload.cancelled !== undefined && typeof payload.cancelled !== 'boolean') throw new Error('invalid_payload: cancelled');
    if (payload.value !== undefined && typeof payload.value !== 'string' && typeof payload.value !== 'boolean') throw new Error('invalid_payload: value');
    if (typeof payload.value === 'string' && payload.value.length > 1024 * 1024) throw new Error('invalid_payload: value too long');
    if (!payload.cancelled && payload.value === undefined) throw new Error('invalid_payload: missing UI response');
  }
  if (['agent_send', 'agent_steer', 'agent_follow_up'].includes(command)) {
    if ('images' in payload) throw new Error('invalid_payload: renderer image bytes are forbidden');
    if (payload.text !== undefined && typeof payload.text !== 'string') throw new Error('invalid_payload: text');
    if (payload.attachments !== undefined) {
      if (!Array.isArray(payload.attachments) || payload.attachments.length > 8) throw new Error('invalid_payload: attachments');
      for (const value of payload.attachments) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.path !== 'string' || !value.path || value.path.length > 4096 || value.path.includes('\0') || Object.keys(value).some(key => key !== 'path')) throw new Error('invalid_payload: attachment path');
      }
    }
  }
  if (command === 'agent_extensions_add' || command === 'agent_extensions_remove') string('path');
  if (command === 'task_kill') string('taskId', 256);
  if (command === 'rewind_execute') string('entryId', 256);
  if (command === 'agent_list_sessions' && payload.includeArchived !== undefined && typeof payload.includeArchived !== 'boolean') throw new Error('invalid_payload: includeArchived');
  if (command === 'agent_extensions_set_enabled' && typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
  return payload;
}
