import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import type { CommandHandlers, Payload } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

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

/** Native `dialog` commands (20261115-md §5.3). Native open/save/message dialogs; picked paths are granted here. */
export function dialogCommands(ctx: NativeContext): CommandHandlers {
  const { window, workspaces, fileAccess, exportGrants } = ctx;
  const commands: CommandHandlers = {
    dialog_open: async payload => {
      for (const key of ['directory', 'multiple'] as const) if (payload[key] !== undefined && typeof payload[key] !== 'boolean') throw new Error(`invalid_payload: ${key}`);
      const result = await dialog.showOpenDialog(window, { ...dialogOptions(payload), properties: [payload.directory ? 'openDirectory' : 'openFile', ...(payload.multiple ? ['multiSelections' as const] : [])] });
      if (result.canceled) return null;
      for (const path of result.filePaths) {
        if (payload.directory && workspaces) await workspaces.grant(path);
        await fileAccess.grant(path);
      }
      return payload.multiple ? result.filePaths : result.filePaths[0] ?? null;
    },
    dialog_save: async payload => { const result = await dialog.showSaveDialog(window, dialogOptions(payload)); if (result.canceled || !result.filePath) return null; exportGrants.add(result.filePath); return result.filePath; },
    dialog_ask: async payload => {
      if (typeof payload.message !== 'string' || payload.message.length > 16384) throw new Error('invalid_payload: message');
      const result = await dialog.showMessageBox(window, { type: 'question', message: payload.message, title: typeof payload.title === 'string' ? payload.title.slice(0, 512) : 'OpenBuddy', buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
      return result.response === 1;
    },
  };
  return commands;
}
