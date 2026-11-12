// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, truncate, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'openbuddy-file-grant-')); dirs.push(dir); return dir; }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
it('requires native grants, checks file identity and allows a genuine file to be resent', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(), dir = await fixture(), path = join(dir, 'pixel.png');
  await writeFile(path, png);
  await expect(access.attach([{ path }])).rejects.toThrow('file_not_authorized');
  await access.grant(path);
  const first = await access.attach([{ path }]);
  expect(first.images).toEqual([{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }]);
  expect((await access.attach([{ path }])).images).toHaveLength(1);
  await unlink(path); await writeFile(path, png);
  await expect(access.attach([{ path }])).rejects.toThrow('file_changed');
  access.clear();
  await expect(access.attach([{ path }])).rejects.toThrow('file_not_authorized');
});
it('uses bytes rather than an image extension and enforces bounded text and total size', async () => {
  const { FileAccess } = await import('./file-access.js');
  const access = new FileAccess(), dir = await fixture();
  const fake = join(dir, 'fake.png'), text = join(dir, 'note.txt'), huge = join(dir, 'huge.png');
  await writeFile(fake, Buffer.from([0, 255, 1, 2])); await writeFile(text, 'hello workspace'); await writeFile(huge, png); await truncate(huge, 10 * 1024 * 1024 + 1);
  await access.grant(fake); await access.grant(text); await access.grant(huge);
  await expect(access.attach([{ path: fake }])).rejects.toThrow('unsupported_attachment');
  expect((await access.attach([{ path: text }])).text).toContain('hello workspace');
  await expect(access.attach([{ path: huge }])).rejects.toThrow('attachment_too_large');
  const alias = join(dir, 'alias'); await symlink(text, alias);
  await expect(access.attach([{ path: alias }])).rejects.toThrow('file_not_authorized');
});
