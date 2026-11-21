// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm, truncate, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dirs: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'openbuddy-file-grant-')); dirs.push(dir); return dir; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
it('requires native grants, checks file identity and allows a genuine file to be resent', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(() => true), dir = await fixture(), path = join(dir, 'pixel.png');
  await writeFile(path, png);
  await expect(access.attach([{ path }])).rejects.toThrow('file_not_authorized');
  await access.grant(path);
  const first = await access.attach([{ path }]);
  expect(first.images).toEqual([{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }]);
  expect((await access.attach([{ path }])).images).toHaveLength(1);
  // Same-size replacement with different bytes: caught even when the new file reuses the inode and timestamps.
  const tampered = Buffer.from(png); tampered[tampered.length - 5] ^= 0xff;
  await unlink(path); await writeFile(path, tampered);
  await expect(access.attach([{ path }])).rejects.toThrow('file_changed');
  access.clear();
  await expect(access.attach([{ path }])).rejects.toThrow('file_not_authorized');
});
it('pins the selected bytes: an in-place rewrite with restored timestamps is still rejected', async () => {
  const { FileAccess } = await import('./file-access.js');
  const { utimes, stat: statFile } = await import('node:fs/promises');
  const access = new FileAccess(() => true), dir = await fixture(), path = join(dir, 'note.txt');
  await writeFile(path, 'hello workspace'); await access.grant(path);
  const before = await statFile(path);
  await writeFile(path, 'HELLO workspace'); await utimes(path, before.atime, before.mtime);
  await expect(access.attach([{ path }])).rejects.toThrow('file_changed');
});
it('rejects magic-valid image bytes when the actual image decoder fails', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(() => false), dir = await fixture(), path = join(dir, 'bad-crc.png');
  await writeFile(path, png); await access.grant(path);
  await expect(access.attach([{ path }])).rejects.toThrow('invalid_image');
});
it('expires native grants after the window-scoped authorization lifetime', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(() => true), dir = await fixture(), path = join(dir, 'pixel.png');
  await writeFile(path, png); await access.grant(path);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 31 * 60 * 1000);
  await expect(access.attach([{ path }])).rejects.toThrow('file_not_authorized');
  expect(await access.allowsNativePath(path)).toBe(false);
});
it('never inlines more than 20 MiB: files past the budget become path references', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(() => true), dir = await fixture(), refs = [];
  for (let n = 0; n < 3; n++) {
    const path = join(dir, `${n}.png`);
    await writeFile(path, png); await truncate(path, 8 * 1024 * 1024); await access.grant(path); refs.push({ path });
  }
  const result = await access.attach(refs);
  expect(result.images).toHaveLength(2);
  expect(result.text).toContain('2.png');
  expect(result.text).toContain('未内联');
});
it('uses bytes rather than an image extension and enforces bounded text and total size', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(() => true), dir = await fixture();
  const fake = join(dir, 'fake.png'), text = join(dir, 'note.txt'), huge = join(dir, 'huge.png');
  await writeFile(fake, Buffer.from([0, 255, 1, 2])); await writeFile(text, 'hello workspace'); await writeFile(huge, png); await truncate(huge, 10 * 1024 * 1024 + 1);
  await access.grant(fake); await access.grant(text); await access.grant(huge);
  // Bytes decide: a fake .png is not inlined as an image, it is referenced as a binary file.
  const fakeResult = await access.attach([{ path: fake }]);
  expect(fakeResult.images).toHaveLength(0);
  expect(fakeResult.text).toMatch(/二进制文件，未内联/);
  expect((await access.attach([{ path: text }])).text).toContain('hello workspace');
  // Too large to read: referenced by path without reading its bytes.
  const hugeResult = await access.attach([{ path: huge }]);
  expect(hugeResult.images).toHaveLength(0);
  expect(hugeResult.text).toMatch(/文件较大，未内联/);
  const alias = join(dir, 'alias'); await symlink(text, alias);
  await expect(access.attach([{ path: alias }])).rejects.toThrow('file_not_authorized');
});
