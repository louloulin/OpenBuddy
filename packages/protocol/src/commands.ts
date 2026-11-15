export const COMMANDS = [
  'agent_init', 'agent_send', 'agent_cancel', 'agent_shutdown', 'agent_auth_status',
  'agent_new_session', 'agent_load_session', 'agent_list_sessions', 'agent_delete_session',
  'agent_rename_session', 'agent_set_session_pinned', 'agent_set_session_archived',
  'agent_session_info', 'agent_session_usage', 'agent_set_model', 'agent_list_workspaces',
  'agent_resolve_permission', 'agent_resolve_question', 'folder_trust_respond',
  'permission_list', 'permission_save', 'permission_mode_get', 'permission_mode_set',
  'providers_list', 'providers_save_provider', 'providers_save_model', 'providers_delete_provider',
  'providers_delete_model', 'providers_fetch_models', 'providers_test', 'account_get_api_key', 'account_set_api_key',
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
  'artifacts_list', 'checkpoint_list', 'checkpoint_read', 'checkpoint_restore', 'turn_revert', 'artifact_save',
  'agent_export_html', 'agent_set_mode', 'agent_abort_retry', 'clipboard_save_image',
  'notification_prefs_get', 'notification_prefs_set', 'agent_set_queue',
  'host_capabilities', 'session_search',
  // 20261116-pii W1.1 branch switcher, W1.2 `!command`, W1.3 `@` file mention.
  'agent_tree', 'agent_navigate', 'agent_bash', 'agent_bash_abort', 'files_search',
  // 20261116-pii W0.4 / W1.6 (host module `model`).
  'settings_agent_get', 'settings_agent_set', 'agent_cycle_model',
  // 专家 (20261116-pii W2.1–W2.3): the experts host module.
  'agents_list', 'agents_get', 'agents_save', 'agents_delete', 'agents_template',
  'agent_set_session_expert', 'agent_clear_session_expert',
  'experts_default_root', 'experts_list_roots', 'experts_set_roots', 'experts_load', 'experts_read_agent_prompt',
  'experts_thumbnail', 'experts_image_bytes', 'experts_link_agents',
  // 记忆 (20261116-pii W5.1–W5.3): the memory host module.
  'memory_list', 'memory_get', 'memory_save', 'memory_delete', 'memory_rewrite',
  // 技能目录 + 我的指令 (20261116-pii W2.7): the skills host module.
  'skills_catalog_default_root', 'skills_catalog_list_roots', 'skills_catalog_load', 'skills_catalog_read_skill',
  'prompts_list', 'prompts_get', 'prompts_save', 'prompts_delete',
] as const;
export type CommandName = typeof COMMANDS[number];
export const isCommand = (value: unknown): value is CommandName => typeof value === 'string' && (COMMANDS as readonly string[]).includes(value);
