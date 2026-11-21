import { join } from "node:path";
import { JsonStore, type Settings } from "../settings/settings.js";
import type { ProjectRecord } from "@openbuddy/protocol/projects";

/**
 * 项目后端 (20261116-pii W5.4 / md-R9, A2 versioning).
 *
 * Replaces the renderer's localStorage-only projects with `projects.json` in the app data dir.
 * The renderer keeps the rich detail object; the host only interprets `id`, `name`, `cwd` and
 * `instructions` (appended to the system prompt of sessions opened in that cwd).
 * Import is an idempotent upsert by id, so re-running it never duplicates a project.
 *
 * v1 wraps the legacy bare array as `{ schemaVersion, projects }`; the v0→v1 migration accepts
 * either shape, so an old file upgrades in place.
 */
const MAX_PROJECTS = 500;
const MAX_INSTRUCTIONS = 20_000;

interface ProjectFile {
  projects: ProjectRecord[];
}

function normalize(value: unknown): ProjectRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim() || o.id.length > 200) return null;
  if (typeof o.name !== "string" || !o.name.trim() || o.name.length > 200) return null;
  const cwd = typeof o.cwd === "string" && o.cwd.trim() ? o.cwd : undefined;
  const instructions = typeof o.instructions === "string" ? o.instructions.slice(0, MAX_INSTRUCTIONS) : undefined;
  return {
    ...o,
    id: o.id,
    name: o.name,
    cwd,
    instructions,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
  } as ProjectRecord;
}

export class ProjectsService {
  private readonly store: JsonStore<ProjectFile>;
  private cache?: ProjectRecord[];

  constructor(settings: Settings) {
    this.store = new JsonStore<ProjectFile>(
      join(settings.dir, "projects.json"),
      () => ({ projects: [] }),
      {
        versioned: true,
        snapshots: settings.snapshots,
        migrations: {
          0: (raw) => {
            if (Array.isArray(raw)) return { projects: raw };
            if (raw && typeof raw === "object" && !Array.isArray(raw)) {
              const file = raw as Record<string, unknown>;
              return { ...file, projects: Array.isArray(file.projects) ? file.projects : [] };
            }
            throw new Error("invalid_projects");
          },
        },
      },
    );
  }

  list(): ProjectRecord[] {
    if (this.cache) return this.cache;
    const items = this.store.read().projects;
    this.cache = (Array.isArray(items) ? items : []).map(normalize).filter(Boolean).slice(0, MAX_PROJECTS) as ProjectRecord[];
    return this.cache;
  }

  /** Upsert one project; the renderer owns the rest of the record. */
  save(project: ProjectRecord): ProjectRecord[] {
    const next = normalize(project);
    if (!next) throw new Error("invalid_project");
    const list = this.list();
    const index = list.findIndex((item) => item.id === next.id);
    const merged = index >= 0 ? list.map((item, i) => (i === index ? next : item)) : [next, ...list];
    this.write(merged.slice(0, MAX_PROJECTS));
    return this.list();
  }

  remove(id: string): ProjectRecord[] {
    this.write(this.list().filter((item) => item.id !== id));
    return this.list();
  }

  /** One-time migration from the renderer's localStorage; idempotent by id. */
  import(records: unknown[]): { projects: ProjectRecord[]; imported: number; skipped: number } {
    const list = this.list();
    const byId = new Map(list.map((item) => [item.id, item]));
    let imported = 0;
    let skipped = 0;
    for (const raw of records.slice(0, MAX_PROJECTS)) {
      const project = normalize(raw);
      if (!project) { skipped++; continue; }
      if (byId.has(project.id)) { skipped++; continue; }
      byId.set(project.id, project);
      imported++;
    }
    this.write([...byId.values()].slice(0, MAX_PROJECTS));
    return { projects: this.list(), imported, skipped };
  }

  /** Project instructions are appended to the system prompt for sessions opened in this cwd. */
  instructionsFor(cwd: string): string | undefined {
    const project = this.list().find((item) => item.cwd && item.cwd === cwd && item.instructions?.trim());
    if (!project?.instructions) return undefined;
    return `## 项目说明 · ${project.name}\n${project.instructions.trim()}`;
  }

  private write(list: ProjectRecord[]): void {
    this.cache = list;
    this.store.write({ projects: list });
  }
}
