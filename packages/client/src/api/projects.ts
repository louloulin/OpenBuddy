// 项目 (20261116-pii W5.4 / md-R9): host-persisted projects + project instructions.
import { invoke } from "../ipc";
import type { ProjectRecord } from "@openbuddy/protocol/projects";

export const projectsSnapshot = () => invoke<{ projects: ProjectRecord[] }>("projects_snapshot", {});

export const projectsSave = (project: ProjectRecord) => invoke<{ projects: ProjectRecord[] }>("projects_save", { project });

export const projectsDelete = (id: string) => invoke<{ projects: ProjectRecord[] }>("projects_delete", { id });

/** One-time idempotent migration from the old renderer localStorage list. */
export const projectsImport = (projects: ProjectRecord[]) =>
  invoke<{ projects: ProjectRecord[]; imported: number; skipped: number }>("projects_import", { projects });
