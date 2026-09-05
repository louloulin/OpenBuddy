export type ExportCondition = "browser" | "node" | "import" | "require" | "default";

export const RUNTIME_EXPORT_CONDITIONS: Record<"browser" | "node" | "generic", readonly ExportCondition[]> = {
  browser: ["browser", "import", "default"],
  node: ["node", "import", "default"],
  generic: ["import", "node", "default", "require"],
};

/** Resolve a Node package export target without ever selecting the `types` condition. */
export function resolveExportTarget(
  value: unknown,
  conditions: readonly ExportCondition[],
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = resolveExportTarget(candidate, conditions);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const condition of conditions) {
    const target = resolveExportTarget(record[condition], conditions);
    if (target !== undefined) return target;
  }
  return undefined;
}

export function packageExportValue(exportsField: unknown, subpath?: string): unknown {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return subpath === undefined ? exportsField : undefined;
  }
  if (!exportsField || typeof exportsField !== "object") return undefined;
  return (exportsField as Record<string, unknown>)[subpath ?? "."];
}

export function hasRuntimePackageExport(
  exportsField: unknown,
  subpath: string,
  conditions: readonly ExportCondition[],
): boolean {
  return resolveExportTarget(packageExportValue(exportsField, subpath), conditions) !== undefined;
}
