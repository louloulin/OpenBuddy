import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { writeFile } from 'node:fs/promises';
import { isCommand, validatePayload, type CommandHandlers, type Payload } from '../shared/contract.js';

function dialogOptions(payload: Payload): OpenDialogOptions & SaveDialogOptions {
  const result: OpenDialogOptions & SaveDialogOptions = {};
  for (const field of ['title', 'defaultPath', 'buttonLabel'] as const) {
    if (payload[field] !== undefined) {
      if (typeof payload[field] !== 'string' || payload[field].length > 4096) throw new Error(`invalid_payload: ${field}`);
      result[field] = payload[field];
    }
  }
  if (payload.filters !== undefined) {
    if (!Array.isArray(payload.filters) || payload.filters.length > 32) throw new Error('invalid_payload: filters');
    result.filters = payload.filters.map((filter: unknown) => {
      if (!filter || typeof filter !== 'object') throw new Error('invalid_payload: filter');
      const { name, extensions } = filter as Record<string, unknown>;
      if (typeof name !== 'string' || !Array.isArray(extensions) || !extensions.every(e => typeof e === 'string' && /^(\*|[a-zA-Z0-9]+)$/.test(e))) throw new Error('invalid_payload: filter');
      return { name, extensions };
    });
  }
  return result;
}

export function registerIpc(window: BrowserWindow, handlers: CommandHandlers, trustedURL: string): () => void {
  const exportGrants = new Set<string>();
  const local: CommandHandlers = {
    export_text_file: async payload => {
      if (typeof payload.path !== 'string' || typeof payload.content !== 'string' || !exportGrants.delete(payload.path)) throw new Error('export_path_not_authorized');
      await writeFile(payload.path, payload.content, 'utf8');
      return payload.path;
    },
    window_minimize: () => window.minimize(),
    window_toggle_maximize: () => window.isMaximized() ? window.unmaximize() : window.maximize(),
    window_close: () => window.close(),
    window_is_maximized: () => window.isMaximized(),
    dialog_open: async payload => {
      for (const key of ['directory', 'multiple'] as const) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error(`invalid_payload: ${key}`);
      const result = await dialog.showOpenDialog(window, { ...dialogOptions(payload), properties: [payload.directory ? 'openDirectory' : 'openFile', ...(payload.multiple ? ['multiSelections' as const] : [])] });
      return result.canceled ? null : payload.multiple ? result.filePaths : result.filePaths[0] ?? null;
    },
    dialog_save: async payload => { const result = await dialog.showSaveDialog(window, dialogOptions(payload)); if (result.canceled || !result.filePath) return null; exportGrants.add(result.filePath); return result.filePath; },
    dialog_ask: async payload => {
      if (typeof payload.message !== 'string' || payload.message.length > 16384) throw new Error('invalid_payload: message');
      const result = await dialog.showMessageBox(window, { type: 'question', message: payload.message, title: typeof payload.title === 'string' ? payload.title.slice(0, 512) : 'OpenBuddy', buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
      return result.response === 1;
    },
  };
  ipcMain.handle('openbuddy:invoke', async (event, command: unknown, input: unknown) => {
    const frame = event.senderFrame;
    if (event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame || frame.url.split('#')[0] !== trustedURL) throw new Error('untrusted_sender');
    if (!isCommand(command)) throw new Error(`not_implemented: ${String(command).slice(0, 128)}`);
    const payload = validatePayload(input);
    const handler = local[command] ?? handlers[command];
    if (!handler) throw new Error(`not_implemented: ${command}`);
    return handler(payload);
  });
  return () => ipcMain.removeHandler('openbuddy:invoke');
}
