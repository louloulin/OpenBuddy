/**
 * 项目 (20261116-pii W5.4 / md-R9).
 *
 * The renderer still owns the rich project detail (connectors / plans / tasks / assets …), so the
 * host stores the same JSON object it used to keep in localStorage. Only `id` / `name` /
 * `cwd` / `instructions` are interpreted by the host: `instructions` becomes an appended system
 * prompt for sessions opened in `cwd`.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  cwd?: string;
  templateId?: string;
  instructions?: string;
  createdAt: string;
  /** Renderer-owned detail fields (plans, tasks, …) preserved verbatim. */
  [key: string]: unknown;
}
