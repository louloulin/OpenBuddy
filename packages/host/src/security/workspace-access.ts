import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Native picker grants, persisted separately from renderer-editable Pi settings. */
export class WorkspaceAccess {
  private readonly roots = new Set<string>();
  private constructor(private readonly path: string) {}
  static async create(userData: string): Promise<WorkspaceAccess> {
    const access = new WorkspaceAccess(join(userData, 'workspace-grants.json'));
    const inbox = join(userData, 'pi', 'inbox');
    await mkdir(inbox, { recursive: true, mode: 0o700 });
    access.roots.add(await realpath(inbox));
    try {
      const saved: unknown = JSON.parse(await readFile(access.path, 'utf8'));
      if (Array.isArray(saved)) for (const value of saved) if (typeof value === 'string') access.roots.add(value);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return access;
  }
  async grant(path: string): Promise<void> {
    this.roots.add(await realpath(path));
    await writeFile(this.path, JSON.stringify([...this.roots]), { mode: 0o600 });
  }
  async allows(path: string): Promise<boolean> {
    try { return this.roots.has(await realpath(path)); } catch { return false; }
  }
}
