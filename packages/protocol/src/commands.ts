export const COMMANDS = [
  'agent_init', 'agent_send', 'agent_cancel', 'agent_shutdown', 'agent_auth_status',
  'agent_new_session', 'agent_load_session', 'agent_list_sessions', 'agent_delete_session',
  'agent_rename_session', 'agent_set_session_pinned', 'agent_set_session_archived',
  'agent_session_info', 'agent_session_usage', 'agent_set_model', 'agent_list_workspaces',
  'agent_resolve_permission', 'agent_resolve_question', 'folder_trust_respond',
  'permission_list', 'permission_save', 'permission_mode_get', 'permission_mode_set',
  // 待决审批补齐 (20261117-mobile.md §2.4): permission/question cards still waiting, for a client reconnecting.
  'permission_pending', 'question_pending', 'trust_pending',
  // 受保护路径 (20261116-pii W6.2): 安全中心编辑，权限门强制执行。
  'permission_protected_get', 'permission_protected_set',
  // 沙箱与网络策略 + 安全审计 (G2-3 / G2-5).
  'security_policy_get', 'security_policy_set', 'security_audit_list',
  'providers_list', 'providers_save_provider', 'providers_save_model', 'providers_delete_provider',
  'providers_delete_model', 'providers_fetch_models', 'providers_test', 'account_get_api_key', 'account_set_api_key',
  // 本地模型 (pii W8): llama.cpp / OpenAI-compatible local server.
  'providers_local_get', 'providers_local_probe', 'providers_local_set',
  'read_text_file', 'write_text_file', 'read_file_base64', 'export_text_file', 'list_dir',
  'browse_directory', 'path_stat', 'open_path', 'open_url', 'reveal_in_folder',
  // G3-7 产物重命名: workspace-scoped, never overwrites.
  'rename_path',
  // 默认打开方式 (G1-6): 按文件类型选择应用内预览或系统应用。
  'default_open_get', 'default_open_set',
  // Git worktree (G4-5): 为代码任务创建隔离工作树。
  'worktree_list', 'worktree_create', 'worktree_remove',
  // 应用平台 (20261126-upup): UpUp 插件开关 + 会话工具清单（健康检查）。
  'apps_list', 'apps_icon', 'apps_set_enabled', 'apps_update', 'apps_uninstall', 'upup_plugins_get', 'upup_plugins_set', 'agent_session_tools', 'agent_check_tool', 'apps_tool_policy_get', 'apps_tool_policy_set',
  'mcp_list', 'mcp_upsert', 'mcp_toggle', 'mcp_delete', 'mcp_config_read', 'mcp_config_save',
  'mcp_config_path', 'mcp_test', 'mcp_auth_trigger', 'mcp_auth_status', 'mcp_deferred_get', 'mcp_deferred_set',
  // 授权尝试 (B3a): begin returns an attempt id/expiry; attempt/attempts read it; cancel aborts.
  'mcp_auth_begin', 'mcp_auth_attempt', 'mcp_auth_attempts', 'mcp_auth_cancel',
  // 连接器目录 (pii W2.4 P2): real MCP config templates; CLI auth commands stay unimplemented.
  'connectors_default_root', 'connectors_list_roots', 'connectors_load', 'connectors_read_mcp_config', 'connectors_icon',
  // 本任务连接器开关 (pii W2.4 P2): session-scoped enable list.
  'session_mcp_get', 'session_mcp_set',
  'skills_list', 'skills_add',
  'skills_remove', 'skills_toggle', 'commands_list', 'notification_list', 'notification_append',
  'notification_mark_read', 'notification_mark_all_read', 'notification_clear',
  // 通知渠道 (20261116-pii W4.6): configured in the renderer, sent by the host.
  'notify_channels_list', 'notify_channels_save', 'notify_channels_delete', 'notify_channels_test',
  'agents_defaults_get', 'agents_defaults_save', 'usage_snapshot', 'usage_provider_quota', 'usage_budgets', 'usage_budget_save', 'dialog_open', 'dialog_save', 'dialog_ask',
  'window_minimize', 'window_toggle_maximize', 'window_close', 'window_is_maximized', 'window_edit', 'clipboard_write_text',
  // 窗口与唤起 (20261116-pii W7): independent session windows + global quick input.
  'window_open_session', 'window_open_quick', 'quick_shortcut_get', 'quick_shortcut_set',
  // G3-3 产物独立窗口: 双屏阅读，关闭不影响主窗口。
  'window_open_artifact',
  // 托盘常驻 (20261116-pii W4.4): desktop native, persisted in tray.json.
  'tray_get', 'tray_set',
  // 手机接入 (20261115-mobile.md §4.4): desktop-only pairing management.
  'mobile_pair_start', 'mobile_devices_list', 'mobile_device_revoke',
  'agent_get_model_state', 'agent_set_thinking_level', 'agent_resolve_ui',
  'agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue',
  'agent_fork_session', 'agent_extensions_list', 'agent_extensions_inspect', 'agent_extensions_add',
  'agent_extensions_remove', 'agent_extensions_set_enabled', 'agent_extensions_set_path_enabled', 'tasks_list', 'task_kill',
  // 扩展包 (pii W2.6 P2 / S14): Pi DefaultPackageManager — npm / git install, remove, update.
  'agent_extensions_packages', 'agent_extensions_install_package', 'agent_extensions_remove_package', 'agent_extensions_update_packages',
  'agent_extensions_preview_package', 'agent_extensions_check_updates',
  // Pi 包市场与包资源 (S15): npm registry search + what each configured package contributes.
  'agent_extensions_search_registry', 'agent_extensions_resources', 'agent_extensions_package_details',
  // 包资源开关 (S17): Pi object-form package filters (`[]` = load none of that type).
  'agent_extensions_set_package_resources',
  'rewind_points', 'rewind_execute', 'agent_regenerate', 'agent_compact',
  // G1-27 消息级操作: 删除该消息 / 继续生成。
  'agent_delete_message', 'agent_continue',
  // G1-30 会话快捷操作: 清空上下文并新开。
  'agent_clear_context',
  // G1-31 快速问答: 一次性会话，不动当前任务的上下文。
  'agent_quick_answer',
  // G2-7 工具内容注入审查: 用户明确放行被拦下的工具输出。
  'agent_allow_tool_content',
  'artifacts_list', 'checkpoint_list', 'checkpoint_read', 'checkpoint_restore', 'turn_revert', 'artifact_save',
  // G3-5 任务成果聚合: 跨会话汇总磁盘上的产物（不要求会话已加载）。
  'artifacts_workspace_list',
  'agent_export_html', 'agent_export_jsonl', 'agent_import_jsonl', 'agent_set_mode', 'agent_abort_retry', 'clipboard_save_image',
  'notification_prefs_get', 'notification_prefs_set', 'agent_set_queue',
  // G4-3 外部会话导入 (WorkBuddy / ChatGPT / Claude → 工作区 Markdown).
  'data_import_scan', 'data_import_apply',
  'host_capabilities', 'session_search',
  // 反馈诊断 (20261116-pii W6.5): local preview only, never uploaded.
  'agent_diagnose',
  // 20261116-pii W1.1 branch switcher, W1.2 `!command`, W1.3 `@` file mention.
  'agent_tree', 'agent_navigate', 'agent_bash', 'agent_bash_abort', 'files_search',
  // 20261116-pii W1.7 交接到新任务: builds a self-contained draft, never auto-sends.
  'agent_handoff',
  // 20261116-pii W0.4 / W1.6 (host module `model`).
  'settings_agent_get', 'settings_agent_set', 'agent_cycle_model',
  // 专家 (20261116-pii W2.1–W2.3): the experts host module.
  'agents_list', 'agents_get', 'agents_save', 'agents_delete', 'agents_template',
  'agent_set_session_expert', 'agent_clear_session_expert',
  'experts_default_root', 'experts_list_roots', 'experts_set_roots', 'experts_load', 'experts_read_agent_prompt',
  'experts_thumbnail', 'experts_image_bytes', 'experts_link_agents', 'experts_import_workbuddy', 'teams_list', 'teams_install',
  // 专家链接 (B3b): preview + idempotent import from an https URL or a local package path.
  'experts_link_preview', 'experts_link_import',
  // 能力包 (B1a): list / 整体启停 / 逐项开关 / 移除 WorkBuddy 包贡献的资源.
  'capability_packs_list', 'capability_packs_set_enabled', 'capability_packs_set_contribution', 'capability_packs_remove',
  // 自动化 (20261116-pii W4.1–W4.3): the automation host module.
  'automations_snapshot', 'automations_save', 'automations_delete', 'automations_set_status', 'automations_run',
  'automation_retry', 'automation_tick', 'automation_records_archive', 'automation_records_delete',
  // 记忆 (20261116-pii W5.1–W5.3): the memory host module.
  'memory_list', 'memory_get', 'memory_save', 'memory_delete', 'memory_rewrite',
  // 资料库知识源 (pii W5.5): the library host module.
  'library_list', 'library_add', 'library_remove',
  // 项目 (pii W5.4 / md-R9): host-persisted projects + project instructions.
  'projects_snapshot', 'projects_save', 'projects_delete', 'projects_import',
  // 数据导出 / 恢复与快照 (A2): versioned bundle, pre-restore snapshot, snapshot rollback.
  'data_export', 'data_restore', 'data_snapshots', 'data_snapshot_restore',
  // 更新检查 (A3): fetch the release manifest; installing stays a user action.
  'update_check', 'update_download',
  // 运行日志 (O1): list and read the host's own JSONL log files for the in-app viewer.
  'logs_list', 'logs_read',
  // 技能目录 + 我的指令 (20261116-pii W2.7): the skills host module.
  'skills_catalog_default_root', 'skills_catalog_list_roots', 'skills_catalog_load', 'skills_catalog_read_skill',
  // 技能市场安装与导出 (B1c): copy into <pi>/skills, export a portable ZIP.
  'skills_install_from_catalog', 'skills_export_zip',
  'prompts_list', 'prompts_get', 'prompts_save', 'prompts_delete',
] as const;
export type CommandName = typeof COMMANDS[number];
export const isCommand = (value: unknown): value is CommandName => typeof value === 'string' && (COMMANDS as readonly string[]).includes(value);
