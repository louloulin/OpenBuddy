import { constants, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { AttachmentReference } from './contract.js';

export interface AuthorizedImage { type: 'image'; data: string; mimeType: string }
/**
 * `digest` pins the selected bytes: inode numbers are reused immediately and file
 * timestamps come from a coarse clock, so a same-size replacement can produce an
 * identical stat. Only files small enough to be attached are hashed.
 */
interface Grant { canonical: string; dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number; expires: number; directory: boolean; digest?: string }
const IMAGE_LIMIT = 10 * 1024 * 1024, TEXT_LIMIT = 256 * 1024, TOTAL_LIMIT = 20 * 1024 * 1024;
function identity(s: Stats, grant: Grant): boolean {
  return s.dev === grant.dev && s.ino === grant.ino && s.size === grant.size && s.mtimeMs === grant.mtimeMs && s.ctimeMs === grant.ctimeMs;
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function digestOf(path: string, size: number): Promise<string | undefined> {
  if (size > IMAGE_LIMIT) return undefined;
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const hash = createHash('sha256'), chunk = Buffer.alloc(Math.min(Math.max(size, 1), 1024 * 1024));
    let position = 0;
    for (;;) {
      const { bytesRead } = await fd.read(chunk, 0, chunk.length, position);
      if (!bytesRead) break;
      hash.update(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally { await fd.close(); }
}
function imageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
}
/** Per-window native grants. Renderer references cannot create or broaden them. */
export class FileAccess {
  private grants = new Map<string, Grant>();
  constructor(private readonly decodableImage: (bytes: Buffer) => boolean) {}
  async grant(path: string): Promise<void> {
    if (!isAbsolute(path) || path.length > 4096 || path.includes('\0')) throw new Error('invalid_native_file_path');
    const canonical = await realpath(path), s = await stat(canonical);
    if (!s.isFile() && !s.isDirectory()) throw new Error('unsupported_native_file');
    const digest = s.isFile() ? await digestOf(canonical, s.size) : undefined;
    if (this.grants.size >= 256) this.grants.delete(this.grants.keys().next().value!);
    this.grants.set(path, { canonical, dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, expires: Date.now() + 30 * 60 * 1000, directory: s.isDirectory(), digest });
  }
  async allowsNativePath(path: string): Promise<boolean> {
    const grant = this.grants.get(path);
    if (!grant || grant.expires < Date.now()) return false;
    try { return await realpath(path) === grant.canonical && identity(await stat(grant.canonical), grant); } catch { return false; }
  }
  clear(): void { this.grants.clear(); }
  async attach(references: AttachmentReference[]): Promise<{ text: string; images: AuthorizedImage[] }> {
    if (references.length > 8) throw new Error('too_many_attachments');
    const images: AuthorizedImage[] = [], text: string[] = [];
    let total = 0;
    for (const { path } of references) {
      const grant = this.grants.get(path);
      if (!grant || grant.expires < Date.now()) throw new Error('file_not_authorized: select or drop the file again');
      if (grant.directory) throw new Error('unsupported_attachment: directory');
      if (await realpath(path) !== grant.canonical) throw new Error('file_changed: select the file again');
      const fd = await open(grant.canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await fd.stat();
        if (!identity(before, grant)) throw new Error('file_changed: select the file again');
        if (before.size > IMAGE_LIMIT || (total += before.size) > TOTAL_LIMIT) throw new Error('attachment_too_large');
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await fd.read(buffer, length, buffer.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length !== before.size || !identity(await fd.stat(), grant)) throw new Error('file_changed: select the file again');
        const bytes = buffer.subarray(0, length);
        if (grant.digest && sha256(bytes) !== grant.digest) throw new Error('file_changed: select the file again');
        const mimeType = imageMime(bytes);
        if (mimeType) {
          if (!this.decodableImage(bytes)) throw new Error('invalid_image: file cannot be decoded or exceeds pixel limits');
          images.push({ type: 'image', data: bytes.toString('base64'), mimeType });
        }
        else {
          if (bytes.length > TEXT_LIMIT) throw new Error('attachment_too_large: text maximum 256 KiB');
          let decoded: string;
          try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('unsupported_attachment: expected image or UTF-8 text'); }
          if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) throw new Error('unsupported_attachment: binary data');
          // Quoted context is data, not an instruction supplied by the shell.
          text.push(`<attachment name=${JSON.stringify(basename(path))}>\n${decoded}\n</attachment>`);
        }
      } finally { await fd.close(); }
    }
    return { text: text.join('\n\n'), images };
  }
}
