import type { CommandName } from './commands.js';
import type { Payload } from './types.js';
import { EXPERT_LIMITS, isExpertId } from './experts.js';

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
  if (/^(agents_(list|get|save|delete|template)|experts_[a-z_]+|agent_(set|clear)_session_expert)$/.test(command)) expertPayload(command, payload);
  return payload;
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
    case 'experts_thumbnail': case 'experts_image_bytes':
      text(payload.path, 4096, 'path', false);
      break;
    case 'experts_link_agents':
      text(payload.root, 4096, 'root', false);
      if (payload.ids !== undefined && payload.ids !== null && (!Array.isArray(payload.ids) || payload.ids.length > 200 || !payload.ids.every(isExpertId))) fail('ids');
      break;
  }
}
