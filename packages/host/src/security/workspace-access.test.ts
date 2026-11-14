// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceAccess } from './workspace-access.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it('allows only native granted roots, persists them and resolves symlink identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openbuddy-grants-test-')); roots.push(root);
  const workspace = join(root, 'workspace'), alias = join(root, 'alias');
  await mkdir(workspace);
  await symlink(workspace, alias, 'dir');
  const access = await WorkspaceAccess.create(root);
  expect(await access.allows('/')).toBe(false);
  expect(await access.allows(workspace)).toBe(false);
  expect(await access.allows(join(root, 'pi', 'inbox'))).toBe(true);
  await access.grant(workspace);
  expect(await access.allows(alias)).toBe(true);
  const restored = await WorkspaceAccess.create(root);
  expect(await restored.allows(workspace)).toBe(true);
});
