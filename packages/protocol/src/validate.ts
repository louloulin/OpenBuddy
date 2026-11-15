import type { CommandName } from './commands.js';
import type { Payload } from './types.js';

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
  if (command === 'notification_prefs_set' && typeof payload.system !== 'boolean') throw new Error('invalid_payload: system');
  if (command === 'agent_set_queue') {
    string('sessionId', 256);
    for (const key of ['steering', 'followUp']) {
      const list = payload[key];
      if (!Array.isArray(list) || list.length > 50 || list.some((t) => typeof t !== 'string' || !t.trim() || t.length > 200_000)) throw new Error(`invalid_payload: ${key}`);
    }
  }
  if (command === 'agent_set_mode' && !['craft', 'plan', 'ask'].includes(String(payload.mode))) throw new Error('invalid_payload: mode');
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
  validateConversationTools(command, payload, string);
  return payload;
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
