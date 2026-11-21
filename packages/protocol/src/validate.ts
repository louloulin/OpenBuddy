import type { CommandName } from './commands.js';
import type { Payload } from './types.js';

// Re-exported so a transport package can type its handler payload without
// reaching into the shared types module.
export type { Payload };
import { validateAgentSettingsPatch } from './agent-settings.js';
import { EXPERT_LIMITS, isExpertId } from './experts.js';
import { validExtensionSource, validPackageFilters, validPackageName, validRegistryQuery } from './extensions.js';
import { MAX_LOG_LINES, validLogLevel, validLogSource } from './logs.js';

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
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(value))) throw new Error(`invalid_payload: ${key}`);
  };
  if (command === 'agent_compact') string('instructions', 4000, true);
  if (['artifacts_list', 'checkpoint_list', 'checkpoint_read', 'checkpoint_restore', 'turn_revert', 'artifact_save', 'agent_export_html', 'agent_set_mode', 'agent_abort_retry'].includes(command)) string('sessionId', 256);
  if (command === 'checkpoint_list') string('path', 4096, true);
  if (command === 'checkpoint_read') { string('hash', 64); if (!/^[a-f0-9]{64}$/.test(String(payload.hash))) throw new Error('invalid_payload: hash'); }
  if (command === 'checkpoint_restore') {
    string('path', 4096);
    if (payload.hash !== null && !/^[a-f0-9]{64}$/.test(String(payload.hash))) throw new Error('invalid_payload: hash');
  }
  if (command === 'turn_revert') {
    const ids = payload.toolCallIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || ids.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('invalid_payload: toolCallIds');
    if (payload.skip !== undefined && (!Array.isArray(payload.skip) || payload.skip.some(p => typeof p !== 'string'))) throw new Error('invalid_payload: skip');
    if (payload.force !== undefined && typeof payload.force !== 'boolean') throw new Error('invalid_payload: force');
  }
  if (command === 'artifact_save') {
    string('path', 4096);
    if (typeof payload.content !== 'string' || payload.content.length > 8 * 1024 * 1024) throw new Error('invalid_payload: content');
    if (payload.origin !== undefined && payload.origin !== 'apply' && payload.origin !== 'user') throw new Error('invalid_payload: origin');
  }
  if (command === 'agent_export_html') string('outputPath', 4096);
  // 会话 JSONL 导出 / 导入 (W6.5).
  if (command === 'agent_export_jsonl') {
    string('sessionId', 256);
    if (payload.outputPath !== undefined && payload.outputPath !== null) string('outputPath', 4096);
  }
  if (command === 'agent_import_jsonl') string('path', 4096);
  // 交接到新任务 (W1.7): a short goal for the next thread.
  if (command === 'agent_handoff') {
    string('sessionId', 256);
    if (typeof payload.goal !== 'string' || !payload.goal.trim() || payload.goal.length > 4000) throw new Error('invalid_payload: goal');
  }
  // 反馈诊断 (W6.5): bounded free text; the renderer never sends keys.
  if (command === 'agent_diagnose') {
    if (payload.sessionId !== undefined && payload.sessionId !== null) string('sessionId', 256);
    if (payload.includeSummary !== undefined && typeof payload.includeSummary !== 'boolean') throw new Error('invalid_payload: includeSummary');
    if (payload.hint !== undefined && (typeof payload.hint !== 'string' || payload.hint.length > 2000)) throw new Error('invalid_payload: hint');
    if (payload.feedback !== undefined && (typeof payload.feedback !== 'string' || payload.feedback.length > 4000)) throw new Error('invalid_payload: feedback');
    if (payload.app !== undefined && (typeof payload.app !== 'string' || payload.app.length > 100)) throw new Error('invalid_payload: app');
  }
  if (command === 'notification_prefs_set' && typeof payload.system !== 'boolean') throw new Error('invalid_payload: system');
  // 托盘常驻 (W4.4).
  if (command === 'tray_set' && typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
  // 窗口与唤起 (W7).
  if (command === 'window_open_session') string('sessionId', 256);
  if (command === 'quick_shortcut_set') {
    if (typeof payload.accelerator !== 'string' || !payload.accelerator.trim() || payload.accelerator.length > 100) throw new Error('invalid_payload: accelerator');
  }
  // 连接器目录 (W2.4 P2).
  if (command === 'connectors_load') {
    if (payload.root !== undefined && payload.root !== null) string('root', 4096);
  }
  if (command === 'connectors_list_roots') string('root', 4096);
  if (command === 'connectors_icon') string('path', 4096);
  if (command === 'connectors_read_mcp_config') {
    string('root', 4096);
    string('source', 128);
  }
  if (command === 'session_mcp_get') string('sessionId', 256);
  if (command === 'session_mcp_set') {
    string('sessionId', 256);
    string('name', 128);
    if (typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
  }
  // MCP 延迟暴露 (W2.4 P2).
  if (command === 'mcp_deferred_set' && typeof payload.deferred !== 'boolean') throw new Error('invalid_payload: deferred');
  if (command === 'mobile_pair_start' && payload.scopes !== undefined) {
    if (!Array.isArray(payload.scopes) || payload.scopes.length > 8) throw new Error('invalid_payload: scopes');
    for (const scope of payload.scopes) {
      if (typeof scope !== 'string' || !/^[a-z]+:[a-z]+$/.test(scope)) throw new Error('invalid_payload: scope');
    }
  }
  if (command === 'mobile_device_revoke') string('id', 128);
  // 项目 (W5.4): a bounded list of renderer-owned records; the service re-checks id / name.
  if (command === 'projects_save') {
    const project = payload.project as Record<string, unknown> | undefined;
    if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('invalid_payload: project');
    if (typeof project.id !== 'string' || !project.id.trim() || project.id.length > 200) throw new Error('invalid_payload: project.id');
    if (typeof project.name !== 'string' || !project.name.trim() || project.name.length > 200) throw new Error('invalid_payload: project.name');
    if (project.instructions !== undefined && typeof project.instructions !== 'string') throw new Error('invalid_payload: instructions');
  }
  if (command === 'projects_delete') string('id', 200);
  if (command === 'projects_import') {
    if (!Array.isArray(payload.projects) || payload.projects.length > 500) throw new Error('invalid_payload: projects');
  }
  // 数据恢复 (A2): the bundle is opaque here; DataBackupService re-validates kind/version/files/size.
  if (command === 'data_restore') {
    if (!payload.bundle || typeof payload.bundle !== 'object' || Array.isArray(payload.bundle)) throw new Error('invalid_payload: bundle');
  }
  if (command === 'data_snapshot_restore') string('id', 200);
  // 更新检查 (A3): feed URL is re-validated (https or loopback http) in UpdateService.
  if (command === 'update_check') {
    string('feedUrl', 4096, true);
    if (payload.channel !== undefined && !['stable', 'beta'].includes(String(payload.channel))) throw new Error('invalid_payload: channel');
  }
  // 更新下载 (A3): the service re-checks the URL; hashes/sizes stay optional but bounded here.
  if (command === 'update_download') {
    string('url', 4096);
    if (payload.sha256 !== undefined && (typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.sha256))) throw new Error('invalid_payload: sha256');
    if (payload.size !== undefined && (typeof payload.size !== 'number' || !Number.isFinite(payload.size) || payload.size < 0 || payload.size > 1024 * 1024 * 1024)) throw new Error('invalid_payload: size');
  }
  // 运行日志 (O1): only the logger's own file names; never a path.
  if (command === 'logs_read') {
    if (!validLogSource(payload.name)) throw new Error('invalid_payload: name');
    if (payload.level !== undefined && payload.level !== 'all' && !validLogLevel(payload.level)) throw new Error('invalid_payload: level');
    if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 200 || payload.query.includes('\0'))) throw new Error('invalid_payload: query');
    if (payload.limit !== undefined && (typeof payload.limit !== 'number' || !Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > MAX_LOG_LINES)) throw new Error('invalid_payload: limit');
  }
  // 包详情 (E1): only a real npm package name reaches the registry.
  if (command === 'agent_extensions_package_details') {
    if (!validPackageName(payload.name)) throw new Error('invalid_payload: name');
  }
  // 受保护路径 (W6.2): a bounded list of short patterns.
  if (command === 'permission_protected_set') {
    if (!Array.isArray(payload.paths) || payload.paths.length > 64) throw new Error('invalid_payload: paths');
    for (const path of payload.paths) {
      if (typeof path !== 'string' || !path.trim() || path.length > 200 || path.includes('\0')) throw new Error('invalid_payload: path');
    }
  }
  if (command === 'agent_set_queue') {
    string('sessionId', 256);
    // Items are strings, or `{ text, attachments }` so queued images survive reordering (pii W1.8).
    for (const key of ['steering', 'followUp']) {
      const list = payload[key];
      if (!Array.isArray(list) || list.length > 50) throw new Error(`invalid_payload: ${key}`);
      for (const item of list) {
        if (typeof item === 'string') {
          if (!item.trim() || item.length > 200_000) throw new Error(`invalid_payload: ${key}`);
          continue;
        }
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`invalid_payload: ${key}`);
        const entry = item as Record<string, unknown>;
        if (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 200_000) throw new Error(`invalid_payload: ${key}`);
        if (entry.attachments !== undefined) {
          if (!Array.isArray(entry.attachments) || entry.attachments.length > 8) throw new Error(`invalid_payload: ${key}.attachments`);
          for (const reference of entry.attachments) {
            if (!reference || typeof reference !== 'object' || typeof (reference as { path?: unknown }).path !== 'string' || !(reference as { path: string }).path) throw new Error(`invalid_payload: ${key}.attachments`);
          }
        }
      }
    }
  }
  if (command === 'agent_set_mode' && !['craft', 'plan', 'ask'].includes(String(payload.mode))) throw new Error('invalid_payload: mode');
  if ((command === 'permission_pending' || command === 'question_pending' || command === 'trust_pending') && payload.sessionId !== undefined) string('sessionId', 256);
  if (command === 'agent_resolve_permission') string('reason', 500, true);
  if (['rewind_points', 'rewind_execute', 'agent_regenerate', 'agent_compact', 'agent_get_model_state', 'agent_set_model', 'agent_set_thinking_level', 'agent_resolve_ui', 'agent_resolve_question', 'agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue', 'agent_fork_session'].includes(command)) string('sessionId', 256);
  if (command === 'agent_set_model' || command === 'agent_new_session') {
    string('modelId', 4096, command === 'agent_new_session');
    string('providerId', 512, true);
    if (command === 'agent_new_session') thinking('thinkingLevel', true);
  }
  if (command === 'providers_delete_model') { string('modelId'); string('providerId', 512, true); }
  if (command === 'providers_test' || command === 'providers_fetch_models') {
    string('providerId', 64, true); string('modelId', 512, true); string('providerKind', 64, true);
    string('apiBackend', 64, true); string('baseUrl', 2048, true); string('apiKey', 4096, true);
  }
  // 本地模型 (W8).
  if (command === 'providers_local_probe' || command === 'providers_local_set') {
    if (command === 'providers_local_probe') string('baseUrl', 2048);
    if (command === 'providers_local_set') {
      if (typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
      string('baseUrl', 2048);
      if (typeof payload.model !== 'string' || payload.model.length > 512) throw new Error('invalid_payload: model');
      for (const key of ['contextWindow', 'maxTokens']) {
        const value = payload[key];
        if (value !== undefined && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2_000_000)) throw new Error(`invalid_payload: ${key}`);
      }
      if (payload.setDefault !== undefined && typeof payload.setDefault !== 'boolean') throw new Error('invalid_payload: setDefault');
      try {
        const url = new URL(payload.baseUrl as string);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid');
      } catch { throw new Error('invalid_payload: baseUrl'); }
    }
  }
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
  // 扩展包 (W2.6 P2): npm / git sources only; local paths go through agent_extensions_add.
  if (command === 'agent_extensions_install_package' && !validExtensionSource(payload.source)) throw new Error('invalid_payload: source');
  if (command === 'agent_extensions_preview_package' && !validExtensionSource(payload.source)) throw new Error('invalid_payload: source');
  if (command === 'agent_extensions_remove_package' && !validExtensionSource(payload.source)) throw new Error('invalid_payload: source');
  if (command === 'agent_extensions_update_packages' && payload.source !== undefined && !validExtensionSource(payload.source)) throw new Error('invalid_payload: source');
  // Pi 包市场 (S15): an optional bounded query; empty browses the keyword.
  if (command === 'agent_extensions_search_registry') {
    const query = payload.query ?? '';
    if (!validRegistryQuery(query)) throw new Error('invalid_payload: query');
    if (payload.offset !== undefined && payload.offset !== null && (typeof payload.offset !== 'number' || !Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 1000)) throw new Error('invalid_payload: offset');
    if (payload.cwd !== undefined && payload.cwd !== null) string('cwd', 4096, true);
  }
  if (command === 'agent_extensions_resources' && payload.cwd !== undefined && payload.cwd !== null) string('cwd', 4096, true);
  // 包资源开关 (S17): Pi object-form filters; only known resource kinds and booleans.
  if (command === 'agent_extensions_set_package_resources') {
    if (!validExtensionSource(payload.source)) throw new Error('invalid_payload: source');
    if (!validPackageFilters(payload.resources)) throw new Error('invalid_payload: resources');
    if (payload.cwd !== undefined && payload.cwd !== null) string('cwd', 4096, true);
  }
  // 测试连接 (W2.4): the server name in mcp.json.
  if (command === 'mcp_test') string('name', 256);
  // 授权尝试 (B3a): bounded ids and server names.
  if (command === 'mcp_auth_begin') { string('sessionId', 128, true); string('serverName', 256); }
  if (command === 'mcp_auth_attempt' || command === 'mcp_auth_cancel') string('id', 128);
  if (command === 'mcp_auth_attempts') string('sessionId', 128, true);
  // 专家团 (W3.5): install a preset by id.
  if (command === 'teams_install') string('id', 128);
  // 专家链接 (B3b): an https URL or local package path; the service does the SSRF checks.
  if (/^experts_link_(preview|import)$/.test(command)) string('source', 4096);
  // 资料库知识源 (W5.5): absolute folder paths.
  if (command === 'library_add') string('path');
  if (command === 'library_remove') string('id');
  // 自动化 (W4): ids are opaque strings; the payload itself is validated by AutomationService.save.
  if (/^(automations_delete|automations_set_status|automations_run|automation_records_archive|automation_records_delete)$/.test(command)) string('id', 128);
  // 重试失败记录 (B3c): the record id, not the automation id.
  if (command === 'automation_retry') string('recordId', 128);
  // 通知渠道 (W4.6): the service validates kind / endpoint; ids stay bounded here.
  if (/^(notify_channels_delete|notify_channels_test)$/.test(command)) string('id', 128);
  // 扩展中心 (W2.6): preview one path in an isolated loader; cwd scopes project extensions.
  if (command === 'agent_extensions_inspect') {
    string('path');
    if (payload.cwd !== undefined && payload.cwd !== null) string('cwd', 4096, true);
  }
  if (command === 'agent_extensions_list' && payload.cwd !== undefined && payload.cwd !== null) string('cwd', 4096, true);
  if (command === 'task_kill') string('taskId', 256);
  if (command === 'rewind_execute') string('entryId', 256);
  if (command === 'agent_list_sessions' && payload.includeArchived !== undefined && typeof payload.includeArchived !== 'boolean') throw new Error('invalid_payload: includeArchived');
  if (command === 'agent_extensions_set_enabled' && typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
  if (command === 'agent_extensions_set_path_enabled') {
    if (typeof payload.path !== 'string' || !payload.path || payload.path.length > 4096 || payload.path.includes('\0')) throw new Error('invalid_payload: path');
    if (typeof payload.enabled !== 'boolean') throw new Error('invalid_payload: enabled');
  }
  validateConversationTools(command, payload, string);
  if (command === 'session_search') {
    string('query', 500);
    string('cwd', 4096, true);
    const limit = payload.limit;
    if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100)) throw new Error('invalid_payload: limit');
  }
  if (command === 'settings_agent_set') validateAgentSettingsPatch(payload.patch);
  if (command === 'agent_cycle_model') {
    string('sessionId', 256);
    if (payload.direction !== undefined && payload.direction !== 'forward' && payload.direction !== 'backward') throw new Error('invalid_payload: direction');
  }
  if (/^(agents_(list|get|save|delete|template)|experts_[a-z_]+|capability_packs_[a-z_]+|agent_(set|clear)_session_expert)$/.test(command)) expertPayload(command, payload);
  if (command.startsWith('memory_')) memoryPayload(command, payload);
  if (command.startsWith('skills_catalog_')) skillsCatalogPayload(command, payload);
  if (command === 'skills_install_from_catalog') {
    const dirs = payload.dirs;
    if (!Array.isArray(dirs) || !dirs.length || dirs.length > 20 || dirs.some((dir) => typeof dir !== 'string' || !dir.trim() || dir.length > 4096 || dir.includes('\0'))) throw new Error('invalid_payload: dirs');
    string('cwd', 4096, true);
  }
  if (command === 'skills_export_zip') {
    string('path', 4096);
    string('target', 4096);
    string('cwd', 4096, true);
  }
  if (command.startsWith('prompts_')) promptsPayload(command, payload);
  return payload;
}

/** 技能目录 (W2.7): roots and dirs are absolute paths picked through the native dialog. */
function skillsCatalogPayload(command: CommandName, payload: Payload) {
  if (command === 'skills_catalog_default_root') return;
  const key = command === 'skills_catalog_list_roots' ? 'root' : command === 'skills_catalog_read_skill' ? 'dir' : 'root';
  const value = payload[key];
  if (command === 'skills_catalog_load' && (value === undefined || value === null)) return;
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error(`invalid_payload: ${key}`);
  if (command === 'skills_catalog_load' && payload.builtinRoot !== undefined && payload.builtinRoot !== null) {
    if (typeof payload.builtinRoot !== 'string' || payload.builtinRoot.length > 4096 || payload.builtinRoot.includes('\0')) throw new Error('invalid_payload: builtinRoot');
  }
}

/** 我的指令 (W2.7 / S8): template names are file stems, content is bounded. */
function promptsPayload(command: CommandName, payload: Payload) {
  if (command === 'prompts_list') {
    if (payload.cwd !== undefined && payload.cwd !== null && (typeof payload.cwd !== 'string' || !payload.cwd || payload.cwd.length > 4096 || payload.cwd.includes('\0'))) throw new Error('invalid_payload: cwd');
    return;
  }
  if (payload.scope !== undefined && payload.scope !== null && payload.scope !== 'global' && payload.scope !== 'workspace') throw new Error('invalid_payload: scope');
  if (payload.cwd !== undefined && payload.cwd !== null && (typeof payload.cwd !== 'string' || !payload.cwd || payload.cwd.length > 4096 || payload.cwd.includes('\0'))) throw new Error('invalid_payload: cwd');
  const name = payload.name;
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) throw new Error('invalid_payload: name');
  if (command === 'prompts_save') {
    if (typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > 512 * 1024) throw new Error('invalid_payload: content');
    for (const key of ['description', 'argumentHint'] as const) {
      const value = payload[key];
      if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 200)) throw new Error(`invalid_payload: ${key}`);
    }
  }
}

/** Memory commands (20261116-pii W5.1–W5.3): a relative `.md` path inside one scope, bounded text. */
function memoryPayload(command: CommandName, payload: Payload) {
  const fail = (key: string): never => { throw new Error(`invalid_payload: ${key}`); };
  if (payload.cwd !== undefined && payload.cwd !== null) {
    if (typeof payload.cwd !== 'string' || !payload.cwd || payload.cwd.length > 4096 || payload.cwd.includes('\0')) fail('cwd');
  }
  if (command === 'memory_list' || command === 'memory_rewrite') return;
  const scope = payload.scope;
  if (scope !== 'global' && scope !== 'workspace') fail('scope');
  const path = payload.path;
  if (typeof path !== 'string' || !path || path.length > 512 || path.includes('\0')) fail('path');
  const parts = (path as string).split(/[\\/]+/);
  if ((path as string).startsWith('/') || /^[A-Za-z]:/.test(path as string) || parts.includes('..') || !/\.md$/i.test(path as string) || parts.some((p) => !/^[A-Za-z0-9._-]+$/.test(p))) fail('path');
  if (command === 'memory_save') {
    if (typeof payload.content !== 'string' || payload.content.length > 512 * 1024) fail('content');
  }
}

/** 20261116-pii W1.1 branches, W1.2 `!command`, W1.3 `@` file search. */
function validateConversationTools(command: CommandName, payload: Payload, string: (key: string, max?: number, optional?: boolean) => void) {
  const fail = (key: string) => { throw new Error(`invalid_payload: ${key}`); };
  const optionalBool = (key: string) => { if (payload[key] !== undefined && typeof payload[key] !== 'boolean') fail(key); };
  if (['agent_tree', 'agent_navigate', 'agent_bash', 'agent_bash_abort'].includes(command)) string('sessionId', 256);
  if (command === 'agent_navigate') {
    string('entryId', 256);
    optionalBool('summarize');
    const restore = payload.restoreFiles;
    if (restore !== undefined && typeof restore !== 'boolean') {
      if (!restore || typeof restore !== 'object' || Array.isArray(restore) || Object.keys(restore).some((key) => key !== 'force' && key !== 'skip')) fail('restoreFiles');
      const { force, skip } = restore as { force?: unknown; skip?: unknown };
      if (force !== undefined && typeof force !== 'boolean') fail('restoreFiles.force');
      if (skip !== undefined && (!Array.isArray(skip) || skip.length > 2000 || skip.some((p) => typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')))) fail('restoreFiles.skip');
    }
  }
  if (command === 'agent_bash') {
    string('command', 64 * 1024);
    optionalBool('excludeFromContext');
    if (payload.risk !== undefined && !['low', 'medium', 'high'].includes(String(payload.risk))) fail('risk');
  }
  if (command === 'files_search') {
    string('cwd', 4096);
    const query = payload.query;
    if (query !== undefined && (typeof query !== 'string' || query.length > 256 || query.includes('\0'))) fail('query');
    const limit = payload.limit;
    if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200)) fail('limit');
  }
}

const THINKING = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const TOOL_NAME = /^[A-Za-z0-9_.*-]+$/;
/** 专家 commands (20261116-pii W2.1–W2.3): ids are never paths, lists and texts are bounded. */
function expertPayload(command: CommandName, payload: Payload) {
  const fail = (key: string): never => { throw new Error(`invalid_payload: ${key}`); };
  const text = (value: unknown, max: number, key: string, optional = true) => {
    if (optional && (value === undefined || value === null)) return;
    if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!optional && !value.trim())) fail(key);
  };
  const list = (value: unknown, maxItems: number, maxItem: number, key: string, pattern?: RegExp) => {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value) || value.length > maxItems || value.some((v) => typeof v !== 'string' || !v.trim() || v.length > maxItem || (pattern && !pattern.test(v)))) fail(key);
  };
  const id = (key: string, optional = false) => {
    const value = payload[key];
    if (optional && (value === undefined || value === null)) return;
    if (!isExpertId(value)) fail(key);
  };
  const L = EXPERT_LIMITS;
  const draft = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expert');
    const d = value as Record<string, unknown>;
    if (d.id !== undefined && d.id !== null && !isExpertId(d.id)) fail('expert.id');
    text(d.name, L.name, 'expert.name', false);
    text(d.prompt, L.prompt, 'expert.prompt', command === 'agents_template');
    text(d.avatar, L.avatar, 'expert.avatar');
    text(d.description, L.description, 'expert.description');
    if (d.category !== undefined && d.category !== null && (typeof d.category !== 'string' || !/^[a-z0-9-]{0,32}$/.test(d.category))) fail('expert.category');
    text(d.model, L.model, 'expert.model');
    if (d.thinking !== undefined && d.thinking !== null && !THINKING.includes(String(d.thinking))) fail('expert.thinking');
    list(d.tools, L.list, L.item, 'expert.tools', TOOL_NAME);
    list(d.skills, L.list, L.item, 'expert.skills');
    list(d.connectors, L.list, L.item, 'expert.connectors');
    list(d.examples, L.examples, L.example, 'expert.examples');
    list(d.tags, L.tags, L.tag, 'expert.tags');
  };
  text(payload.cwd, 4096, 'cwd');
  switch (command) {
    case 'agents_get': case 'experts_read_agent_prompt': case 'agents_delete':
      if (payload.path !== undefined && command !== 'experts_read_agent_prompt') text(payload.path, 4096, 'path', false);
      else id('id');
      break;
    case 'agents_save':
      if (payload.expert !== undefined) {
        draft(payload.expert);
        if (payload.mode !== undefined && payload.mode !== 'create' && payload.mode !== 'update') fail('mode');
      } else { text(payload.name, L.name, 'name', false); text(payload.raw, 256 * 1024, 'raw', false); }
      break;
    case 'agents_template':
      if (payload.expert !== undefined) draft(payload.expert);
      else { text(payload.name, L.name, 'name', false); text(payload.description, L.description, 'description'); text(payload.systemPrompt, L.prompt, 'systemPrompt'); }
      break;
    case 'agent_set_session_expert':
      text(payload.sessionId, 256, 'sessionId', false); id('expertId');
      break;
    case 'agent_clear_session_expert':
      text(payload.sessionId, 256, 'sessionId', false);
      break;
    case 'experts_set_roots':
      list(payload.roots, 20, 4096, 'roots');
      if (!Array.isArray(payload.roots)) fail('roots');
      break;
    case 'experts_import_workbuddy':
      text(payload.path, 4096, 'path', false);
      break;
    case 'experts_thumbnail': case 'experts_image_bytes':
      text(payload.path, 4096, 'path', false);
      break;
    case 'experts_link_agents':
      text(payload.root, 4096, 'root', false);
      if (payload.ids !== undefined && payload.ids !== null && (!Array.isArray(payload.ids) || payload.ids.length > 200 || !payload.ids.every(isExpertId))) fail('ids');
      break;
    case 'capability_packs_list':
      break;
    case 'capability_packs_set_enabled':
    case 'capability_packs_remove':
      if (typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.id)) fail('id');
      if (command === 'capability_packs_set_enabled' && typeof payload.enabled !== 'boolean') fail('enabled');
      break;
    case 'capability_packs_set_contribution':
      if (typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(payload.id)) fail('id');
      if (!['skill', 'prompt', 'mcp'].includes(String(payload.kind))) fail('kind');
      text(payload.name, 128, 'name', false);
      if (typeof payload.enabled !== 'boolean') fail('enabled');
      break;
  }
}
