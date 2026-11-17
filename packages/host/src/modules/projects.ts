import type { HostModuleFactory } from "../module.js";
import type { ProjectRecord } from "@openbuddy/protocol/projects";

/**
 * 项目 (20261116-pii W5.4 / md-R9).
 *
 * The renderer keeps the rich detail object; the host persists it in `projects.json` and
 * appends a project's instructions to the system prompt of sessions opened in its `cwd`.
 * `projects_import` is the one-time, idempotent migration from the old localStorage list.
 */
export const projectsModule: HostModuleFactory = (ctx) => ({
  id: "projects",
  commands: {
    projects_snapshot: () => ({ projects: ctx.engine.projects.list() }),
    projects_save: (payload) => {
      const project = payload.project as ProjectRecord;
      if (!project || typeof project !== "object" || Array.isArray(project)) throw new Error("invalid_project");
      return { projects: ctx.engine.projects.save(project) };
    },
    projects_delete: (payload) => {
      const id = payload.id;
      if (typeof id !== "string" || !id.trim()) throw new Error("invalid_project_id");
      return { projects: ctx.engine.projects.remove(id) };
    },
    projects_import: (payload) => {
      const projects = payload.projects;
      if (!Array.isArray(projects)) throw new Error("invalid_projects");
      return ctx.engine.projects.import(projects);
    },
  },
});
