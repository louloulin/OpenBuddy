/**
 * Which IPC commands a phone may reach, and how each maps onto the gateway's
 * device scopes (20261115-mobile.md §3.1).
 *
 * The desktop holds the full command surface; the phone is a remote viewer and
 * driver of sessions. Window management, native dialogs, the clipboard and
 * file-writing commands are desktop-only and are refused here before they ever
 * reach a handler — the same screen the FeatureRegistry hides on the web side.
 */

export type Scope = 'sessions:read' | 'sessions:write' | 'approve'

/** Commands excluded from the mobile surface. Everything else in COMMANDS is allowed. */
const DENIED_COMMANDS = new Set([
  // Desktop-native capabilities: a phone has its own shell for these.
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized',
  'window_edit', 'dialog_open', 'dialog_save', 'dialog_ask', 'open_path', 'open_url',
  // Pairing management belongs to the desktop window, not to a paired phone.
  'mobile_pair_start', 'mobile_devices_list', 'mobile_device_revoke',
  'reveal_in_folder', 'clipboard_write_text', 'clipboard_save_image',
  // Management surfaces the admin console or desktop settings own.
  'mcp_config_path', 'mcp_auth_trigger',
  // Filesystem writes stay on the machine that owns the disk. v1 is read-only
  // for content (read_text_file / list_dir / browse_directory are allowed).
  'write_text_file', 'export_text_file', 'artifact_save',
  'agent_extensions_add', 'agent_extensions_remove', 'agents_delete',
  'agents_save', 'experts_set_roots', 'skills_add', 'skills_remove',
  'mcp_upsert', 'mcp_delete', 'mcp_config_save',
])

/**
 * The scope a command needs. Read-shaped commands only need `sessions:read`;
 * anything that drives a session or mutates state needs `sessions:write`;
 * resolving a permission prompt needs `approve`. Default is write: an unknown
 * command fails closed rather than silently read-only.
 */
const READ_COMMANDS = new Set([
  'host_capabilities', 'agent_list_sessions', 'agent_session_info', 'agent_session_usage',
  'agent_get_model_state', 'agent_get_queue', 'agent_tree', 'providers_list',
  'account_get_api_key', 'read_text_file', 'read_file_base64', 'list_dir', 'browse_directory',
  'path_stat', 'mcp_list', 'mcp_config_read', 'mcp_auth_status', 'skills_list', 'commands_list',
  'notification_list', 'agents_defaults_get', 'agents_list', 'agents_get', 'agents_template',
  'experts_default_root', 'experts_list_roots', 'experts_load', 'experts_read_agent_prompt',
  'experts_thumbnail', 'experts_image_bytes', 'experts_link_agents', 'memory_list', 'memory_get',
  'settings_agent_get', 'permission_list', 'permission_mode_get', 'tasks_list', 'rewind_points',
  'checkpoint_list', 'checkpoint_read', 'artifacts_list', 'files_search', 'session_search',
  'notification_prefs_get', 'agent_extensions_list', 'agent_export_html',
  'automations_snapshot',
])

export const APPROVE_COMMANDS = new Set(['agent_resolve_permission', 'agent_resolve_ui', 'agent_resolve_question', 'folder_trust_respond'])

export function isAllowedCommand(command: string): boolean {
  return !DENIED_COMMANDS.has(command)
}

/** Reads only need sessions:read; writes need sessions:write; a bare token with neither passes nothing. */
export function scopeForCommand(command: string): Scope {
  if (APPROVE_COMMANDS.has(command)) return 'approve'
  if (READ_COMMANDS.has(command)) return 'sessions:read'
  return 'sessions:write'
}

/** The `host_capabilities` answer a mobile host reports (20261115-mobile.md §3.1). */
export function mobileCapabilities(allowedCommands: readonly string[], allowedEvents: readonly string[]): {
  platform: string
  commands: string[]
  events: string[]
} {
  return {
    platform: 'mobile-host',
    commands: [...allowedCommands],
    events: [...allowedEvents],
  }
}
