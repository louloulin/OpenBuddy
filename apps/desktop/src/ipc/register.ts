import { clipboard, dialog, ipcMain, nativeImage, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isCommand, validateCommandPayload, type CommandHandlers, type Payload, type AttachmentReference } from '@openbuddy/protocol/contract';
import { FileAccess } from '@openbuddy/host/security/file-access';

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

export function registerIpc(window: BrowserWindow, handlers: CommandHandlers, trustedURL: string, workspaces?: { grant(path: string): Promise<void>; allows(path: string): Promise<boolean> }, options: { attachmentsDir?: string; exportHtml?: (sessionId: string, path: string) => Promise<string> } = {}): () => void {
  const exportGrants = new Set<string>();
  const fileAccess = new FileAccess(bytes => {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return false;
    const { width, height } = image.getSize();
    return width > 0 && height > 0 && width * height <= 32 * 1024 * 1024;
  });
  const assertSender = (event: Electron.IpcMainInvokeEvent): void => {
    const frame = event.senderFrame;
    if (event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame || frame.url.split('#')[0] !== trustedURL) throw new Error('untrusted_sender');
  };
  const local: CommandHandlers = {
    export_text_file: async payload => {
      if (typeof payload.path !== 'string' || typeof payload.content !== 'string' || !exportGrants.delete(payload.path)) throw new Error('export_path_not_authorized');
      await writeFile(payload.path, payload.content, 'utf8');
      return payload.path;
    },
    // Pasted screenshot: saved under userData and granted like a file picked in the dialog.
    clipboard_save_image: async () => {
      if (!options.attachmentsDir) return null;
      // Electron 45: async W3C-style clipboard. Any image type is re-encoded to PNG.
      const items = await clipboard.read();
      let bytes: Buffer | null = null;
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type) as Blob;
        if (blob.size > 30 * 1024 * 1024) throw new Error('attachment_too_large');
        const raw = Buffer.from(await blob.arrayBuffer());
        const image = nativeImage.createFromBuffer(raw);
        if (image.isEmpty()) continue;
        bytes = type === 'image/png' ? raw : image.toPNG();
        break;
      }
      if (!bytes) return null;
      // A readable name: it is what the attachment chip and the model see.
      const stamp = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const name = `截图 ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}.${pad(stamp.getMinutes())}.${pad(stamp.getSeconds())}.png`;
      const dir = join(options.attachmentsDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      await mkdir(dir, { recursive: true });
      const path = join(dir, name);
      await writeFile(path, bytes);
      await fileAccess.grant(path);
      return { path, name, size: bytes.length };
    },
    // Real HTML export (Pi's exporter) to a path the user chose in the save dialog.
    agent_export_html: async payload => {
      if (typeof payload.outputPath !== 'string' || !exportGrants.delete(payload.outputPath)) throw new Error('export_path_not_authorized');
      if (!options.exportHtml) throw new Error('not_implemented: agent_export_html');
      return options.exportHtml(String(payload.sessionId), payload.outputPath);
    },
    clipboard_write_text: payload => {
      if (typeof payload.text !== 'string' || payload.text.length > 8 * 1024 * 1024) throw new Error('invalid_payload: text');
      return clipboard.writeText(payload.text);
    },
    window_edit: payload => {
      const action = String(payload.action);
      if (!['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(action)) throw new Error('invalid_payload: action');
      window.webContents[action as 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll']();
    },
    window_minimize: () => window.minimize(),
    window_toggle_maximize: () => window.isMaximized() ? window.unmaximize() : window.maximize(),
    window_close: () => window.close(),
    window_is_maximized: () => window.isMaximized(),
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
  ipcMain.handle('openbuddy:invoke', async (event, command: unknown, input: unknown) => {
    assertSender(event);
    if (!isCommand(command)) throw new Error(`not_implemented: ${String(command).slice(0, 128)}`);
    const payload = validateCommandPayload(command, input);
    if (workspaces && ['agent_init', 'agent_new_session'].includes(command) && payload.cwd != null) {
      if (typeof payload.cwd !== 'string' || !await workspaces.allows(payload.cwd)) throw new Error('workspace_not_authorized: select a folder using the native dialog');
    }
    if (command === 'agent_extensions_add' && !await fileAccess.allowsNativePath(payload.path as string)) throw new Error('extension_path_not_authorized: select the extension using the native dialog');
    if (['agent_send', 'agent_steer', 'agent_follow_up'].includes(command) && payload.attachments !== undefined) {
      const content = await fileAccess.attach(payload.attachments as AttachmentReference[]);
      payload.text = [payload.text, content.text].filter(Boolean).join('\n\n');
      payload.images = content.images;
      delete payload.attachments;
    }
    const handler = local[command] ?? handlers[command];
    if (!handler) throw new Error(`not_implemented: ${command}`);
    return handler(payload);
  });
  // This capability is private to preload, which derives the path from a native File.
  // It is deliberately absent from generic invoke and the exposed bridge object.
  ipcMain.handle('openbuddy:grant-file', async (event, path: unknown) => {
    assertSender(event);
    if (typeof path !== 'string') throw new Error('invalid_native_file_path');
    await fileAccess.grant(path);
  });
  return () => {
    fileAccess.clear(); exportGrants.clear();
    ipcMain.removeHandler('openbuddy:invoke');
    ipcMain.removeHandler('openbuddy:grant-file');
  };
}
