// Moved verbatim from apps/web/src/shared/lib/files/drop-utils.ts (20261115-md R7); drop-utils re-exports it.

/** 取后缀(小写,含点)。无后缀返回空串。 */
export function extOf(path: string): string {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}
