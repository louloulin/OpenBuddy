import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { statIfExists } from "@openbuddy/storage";

import { isPathWithin } from "./host-modules/_host-paths";

/**
 * 探测候选路径时，除了"不存在"(ENOENT/ENOTDIR，已由 statIfExists 处理)，
 * 还有这些错误码也应当等同于"这个候选不可用"，而不是让整个解析失败：
 * 超长路径、路径中某段不可穿越、符号链接成环、参数不合法。
 */
const UNUSABLE_CANDIDATE_CODES = new Set(["ENAMETOOLONG", "EACCES", "EPERM", "ELOOP", "EINVAL"]);

async function existingFileCandidates(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    // 别直接写 `stat(p, { throwIfNoEntry: false })` —— Node 22 会忽略这个
    // 选项仍然抛 ENOENT。CI 与 Electron 44 都跑 Node 22，本地 Node 24 测不出来。
    let entry;
    try {
      entry = await statIfExists(candidate);
    } catch (err) {
      if (UNUSABLE_CANDIDATE_CODES.has((err as NodeJS.ErrnoException)?.code ?? "")) continue;
      throw err;
    }
    if (entry?.isFile()) return candidate;
  }
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
