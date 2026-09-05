import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function isPathWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

async function existingFileCandidates(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if ((await stat(candidate, { throwIfNoEntry: false }))?.isFile()) return candidate;  }
  return undefined;
}

/** Resolve a profile-owned module when Node exports metadata is absent. */
export async function resolveProfileModuleFallback(specifier: string, packageJsonPath: string): Promise<string | undefined> {
  let manifest: { name?: unknown; main?: unknown };
  try {
    manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name?: unknown; main?: unknown };  } catch {
    return undefined;
  }
  const packageName = typeof manifest.name === "string" ? manifest.name : undefined;
  if (!packageName || (specifier !== packageName && !specifier.startsWith(`${packageName}/`))) return undefined;

  const packageRoot = dirname(packageJsonPath);
  const subpath = specifier === packageName ? undefined : specifier.slice(packageName.length + 1);
  const requested = subpath ? resolve(packageRoot, subpath) : undefined;
  if (requested && !isPathWithin(packageRoot, requested)) return undefined;

  const candidates = requested
    ? [requested, `${requested}.js`, `${requested}.mjs`, `${requested}.cjs`, join(requested, "index.js"), join(requested, "index.mjs"), join(requested, "index.cjs")]
    : [
        ...(typeof manifest.main === "string" ? [resolve(packageRoot, manifest.main)] : []),
        join(packageRoot, "index.js"),
        join(packageRoot, "index.mjs"),
        join(packageRoot, "index.cjs"),
      ];
  return existingFileCandidates(candidates.filter((candidate) => isPathWithin(packageRoot, candidate)));
}
