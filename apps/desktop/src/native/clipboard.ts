import { clipboard, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandHandlers } from '@openbuddy/protocol/contract';
import type { NativeContext } from './context.js';

/** Native `clipboard` commands (20261115-md §5.3). Clipboard text writes and pasted screenshots. */
export function clipboardCommands(ctx: NativeContext): CommandHandlers {
  const { fileAccess, options } = ctx;
  const commands: CommandHandlers = {
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
    clipboard_write_text: payload => {
      if (typeof payload.text !== 'string' || payload.text.length > 8 * 1024 * 1024) throw new Error('invalid_payload: text');
      return clipboard.writeText(payload.text);
    },
  };
  return commands;
}
