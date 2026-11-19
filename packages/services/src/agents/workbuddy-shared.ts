/** Shared path/text helpers for WorkBuddy package parsing (kept small; no runtime state). */

export const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const out = value.trim();
  return out ? out.slice(0, max) : undefined;
};

export const safeEntry = (name: string): boolean =>
  !!name && name.length <= 1024 && !name.includes("\0") && !name.startsWith("/") &&
  !/^[A-Za-z]:/.test(name) && !name.split("/").some((part) => part === "..");

/** Normalise an archive entry name to forward slashes; rejects traversal. */
export const entryName = (raw: string): string => raw.replace(/\\/g, "/").replace(/^\.\//, "");

export const slugName = (raw: string): string =>
  raw.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/** A declaration may be one path or an array of paths. */
export const declaredList = (value: unknown): string[] => {
  const one = text(value, 512);
  if (one) return [one];
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, 512)).filter((item): item is string => !!item);
};

/** Declared roots (inside the package), or the conventional `skills/` / `commands/` directory. */
export const declaredRoots = (value: unknown, prefix: string, fallback: string): string[] => {
  const roots = declaredList(value)
    .map((item) => entryName(item.replace(/^\.\//, "")).replace(/\/$/, ""))
    .filter((item) => safeEntry(item))
    .map((item) => `${prefix}${item}`);
  return roots.length ? [...new Set(roots)] : [`${prefix}${fallback}`];
};
