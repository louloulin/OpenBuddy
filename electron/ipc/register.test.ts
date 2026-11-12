// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn(), save: vi.fn(), write: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler }, dialog: { showSaveDialog: mocks.save } }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), writeFile: mocks.write }));
import { registerIpc } from './register.js';
import type { BrowserWindow } from 'electron';

const url = 'file:///app/dist/index.html';
function setup(workspaces?: { grant(path: string): Promise<void>; allows(path: string): Promise<boolean> }) {
  const mainFrame = { url };
  const webContents = { mainFrame };
  const window = { webContents } as unknown as BrowserWindow;
  const send = vi.fn(() => 'ok');
  const capabilities = Object.fromEntries(['agent_get_model_state', 'agent_set_model', 'agent_set_thinking_level', 'agent_resolve_ui', 'agent_resolve_question', 'agent_steer', 'agent_follow_up', 'agent_get_queue', 'agent_clear_queue', 'agent_fork_session', 'agent_extensions_list', 'agent_extensions_add', 'agent_extensions_remove', 'agent_extensions_set_enabled'].map(command => [command, (payload: Record<string, unknown>) => payload]));
  const unregister = registerIpc(window, { ...capabilities, agent_send: send, agent_init: send }, url, workspaces);
  const dispatch = mocks.handle.mock.calls[0][1];
  return { dispatch, send, unregister, event: { sender: webContents, senderFrame: mainFrame } };
}
beforeEach(() => vi.clearAllMocks());
describe('Electron IPC dispatch', () => {
  it('requires the selected window top frame and exact document URL', async () => {
    const { dispatch, event, send } = setup();
    await expect(dispatch(event, 'agent_send', { text: 'hello' })).resolves.toBe('ok');
    await expect(dispatch({ ...event, sender: {} }, 'agent_send', {})).rejects.toThrow('untrusted_sender');
    await expect(dispatch({ ...event, senderFrame: { url } }, 'agent_send', {})).rejects.toThrow('untrusted_sender');
    event.senderFrame.url = 'https://example.test/';
    await expect(dispatch(event, 'agent_send', {})).rejects.toThrow('untrusted_sender');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported commands and invalid payloads before handlers', async () => {
    const { dispatch, event, send, unregister } = setup();
    await expect(dispatch(event, 'exec', {})).rejects.toThrow('not_implemented');
    await expect(dispatch(event, 'agent_send', [])).rejects.toThrow('invalid_payload');
    expect(send).not.toHaveBeenCalled();
    unregister();
    expect(mocks.removeHandler).toHaveBeenCalledWith('openbuddy:invoke');
  });
  it('blocks renderer-selected workspace roots without a native grant', async () => {
    const allows = vi.fn(async (path: string) => path === '/selected');
    const { dispatch, event, send } = setup({ grant: vi.fn(), allows });
    await expect(dispatch(event, 'agent_init', { cwd: '/' })).rejects.toThrow('workspace_not_authorized');
    expect(send).not.toHaveBeenCalled();
    await expect(dispatch(event, 'agent_init', { cwd: '/selected' })).resolves.toBe('ok');
    expect(send).toHaveBeenCalledOnce();
  });
  it('dispatches provider-scoped model state and rejects malformed Pi UI responses', async () => {
    const { dispatch, event } = setup();
    await expect(dispatch(event, 'agent_get_model_state', { sessionId: 's1' })).resolves.toEqual({ sessionId: 's1' });
    await expect(dispatch(event, 'agent_set_model', { sessionId: 's1', providerId: 'custom/a', modelId: 'same/model' })).resolves.toEqual({ sessionId: 's1', providerId: 'custom/a', modelId: 'same/model' });
    await expect(dispatch(event, 'agent_set_thinking_level', { sessionId: 's1', level: 'high' })).resolves.toEqual({ sessionId: 's1', level: 'high' });
    await expect(dispatch(event, 'agent_set_model', { sessionId: 's1', providerId: {}, modelId: 'm' })).rejects.toThrow('invalid_payload');
    await expect(dispatch(event, 'agent_set_thinking_level', { sessionId: 's1', level: 'unbounded' })).rejects.toThrow('invalid_payload');
    await expect(dispatch(event, 'agent_resolve_ui', { sessionId: 's1', requestId: 'r1', value: 'answer' })).resolves.toEqual({ sessionId: 's1', requestId: 'r1', value: 'answer' });
    await expect(dispatch(event, 'agent_resolve_ui', { sessionId: 's1', requestId: 'r1', value: { exec: 'bad' } })).rejects.toThrow('invalid_payload');
    await expect(dispatch(event, 'agent_resolve_ui', { requestId: 'r1', value: true })).rejects.toThrow('invalid_payload');
  });
  it('rejects renderer-supplied image bytes before dispatch', async () => {
    const { dispatch, event, send } = setup();
    await expect(dispatch(event, 'agent_send', { sessionId: 's1', text: 'image', images: [{ data: 'secret' }] })).rejects.toThrow('invalid_payload');
    expect(send).not.toHaveBeenCalled();
  });
  it('keeps native file registration private and verifies its sender', async () => {
    const { dispatch, event } = setup();
    const nativeGrant = mocks.handle.mock.calls.find(call => call[0] === 'openbuddy:grant-file')![1];
    await expect(dispatch(event, 'openbuddy:grant-file', { path: '/private/key' })).rejects.toThrow('not_implemented');
    await expect(nativeGrant({ ...event, sender: {} }, '/private/key')).rejects.toThrow('untrusted_sender');
    await expect(nativeGrant({ ...event, senderFrame: { url } }, '/private/key')).rejects.toThrow('untrusted_sender');
    await expect(dispatch(event, 'agent_send', { text: 'read', attachments: [{ path: '/private/key' }] })).rejects.toThrow('file_not_authorized');
    await expect(dispatch(event, 'agent_extensions_add', { path: '/private/plugin.ts' })).rejects.toThrow('extension_path_not_authorized');
  });
  it('consumes a save dialog grant once before an export can write', async () => {
    const { dispatch, event } = setup();
    await expect(dispatch(event, 'export_text_file', { path: '/tmp/export', content: 'one' })).rejects.toThrow('not_authorized');
    mocks.save.mockResolvedValue({ canceled: false, filePath: '/tmp/export' });
    await dispatch(event, 'dialog_save', {});
    await dispatch(event, 'export_text_file', { path: '/tmp/export', content: 'one' });
    expect(mocks.write).toHaveBeenCalledWith('/tmp/export', 'one', 'utf8');
    await expect(dispatch(event, 'export_text_file', { path: '/tmp/export', content: 'two' })).rejects.toThrow('not_authorized');
  });
});
