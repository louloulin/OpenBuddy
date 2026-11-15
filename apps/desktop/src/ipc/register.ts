import { ipcMain, nativeImage, type BrowserWindow } from 'electron';
import { isCommand, validateCommandPayload, type CommandHandlers, type AttachmentReference } from '@openbuddy/protocol/contract';
import { FileAccess } from '@openbuddy/host/security/file-access';
import type { NativeContext, NativeOptions, WorkspaceGrants } from '../native/context.js';
import { exportCommands } from '../native/export.js';
import { clipboardCommands } from '../native/clipboard.js';
import { windowCommands } from '../native/window.js';
import { dialogCommands } from '../native/dialog.js';

export function registerIpc(window: BrowserWindow, handlers: CommandHandlers, trustedURL: string, workspaces?: WorkspaceGrants, options: NativeOptions = {}): () => void {
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
  // Native commands (dialog / window / clipboard / export) live in ../native; they win over host handlers.
  const native: NativeContext = { window, fileAccess, exportGrants, workspaces, options };
  const local: CommandHandlers = { ...exportCommands(native), ...clipboardCommands(native), ...windowCommands(native), ...dialogCommands(native) };
  ipcMain.handle('openbuddy:invoke', async (event, command: unknown, input: unknown) => {
    assertSender(event);
    if (!isCommand(command)) throw new Error(`not_implemented: ${String(command).slice(0, 128)}`);
    const payload = validateCommandPayload(command, input);
    // files_search (`@` mention, W1.3) lists a workspace: the same native grant as opening one.
    if (workspaces && ['agent_init', 'agent_new_session', 'files_search'].includes(command) && payload.cwd != null) {
      if (typeof payload.cwd !== 'string' || !await workspaces.allows(payload.cwd)) throw new Error('workspace_not_authorized: select a folder using the native dialog');
    }
    if (command === 'agent_extensions_add' && !await fileAccess.allowsNativePath(payload.path as string)) throw new Error('extension_path_not_authorized: select the extension using the native dialog');
    // Expert library roots (W2.3) feed experts_load / experts_image_bytes: a root being added needs the
    // same native folder grant as a workspace. Roots already configured stay; removing one needs none.
    if (workspaces && command === 'experts_set_roots') {
      const configured = new Set(((await handlers.experts_list_roots?.({}) ?? []) as Array<{ path: string }>).map(root => root.path));
      for (const root of payload.roots as string[]) {
        if (!configured.has(root) && !await workspaces.allows(root)) throw new Error('expert_root_not_authorized: select the folder using the native dialog');
      }
    }
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
