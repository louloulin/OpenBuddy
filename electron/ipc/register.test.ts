// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn(), save: vi.fn(), write: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler }, dialog: { showSaveDialog: mocks.save } }));
vi.mock('node:fs/promises', () => ({ writeFile: mocks.write }));
import { registerIpc } from './register.js';
import type { BrowserWindow } from 'electron';

const url = 'file:///app/dist/index.html';
function setup() {
  const mainFrame = { url };
  const webContents = { mainFrame };
  const window = { webContents } as unknown as BrowserWindow;
  const send = vi.fn(() => 'ok');
  const unregister = registerIpc(window, { agent_send: send }, url);
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
