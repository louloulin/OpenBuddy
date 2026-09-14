import { lstat, readlink, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

export type MarketplaceLinkErrorCode = "EEXIST" | "ENOENT" | "EACCES" | "EPERM" | "ENOTDIR" | "ENOSYS";

export class MarketplaceLinkError extends Error {
  readonly code: MarketplaceLinkErrorCode;
  readonly path: string;
  constructor(code: MarketplaceLinkErrorCode, path: string, cause?: unknown) {
    super(`marketplace link ${code} at ${path}${code === "ENOSYS" ? ": Windows junction unavailable; requires administrator privileges or symlink fallback" : ""}`);
    this.name = "MarketplaceLinkError";
    this.code = code;
    this.path = path;
    if (cause !== undefined) this.cause = cause;
  }
}

function errorCode(error: unknown): MarketplaceLinkErrorCode {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EEXIST" || code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR" || code === "ENOSYS") return code;
  return "ENOSYS";
}
function linkPath(parent: string, name: string): string {
  if (!parent || !name) throw new MarketplaceLinkError("ENOTDIR", join(parent, name));
  return join(parent, name);
}

/** Windows uses junction semantics where supported; Node's symlink API avoids a
 * shell/tool dependency. Unsupported junction creation retries as a symlink. */
export async function ensureLink(parent: string, name: string, target: string): Promise<string> {
  const path = linkPath(parent, name);
  try {
    await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
    return path;
  } catch (error) {
    if (process.platform === "win32" && errorCode(error) === "ENOSYS") {
      try { await symlink(target, path, "dir"); return path; }
      catch (fallbackError) { throw new MarketplaceLinkError("ENOSYS", path, fallbackError); }
    }
    throw new MarketplaceLinkError(errorCode(error), path, error);
  }
}

export async function removeLink(parent: string, name: string): Promise<boolean> {
  const path = linkPath(parent, name);
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) throw new MarketplaceLinkError("EPERM", path);
    await unlink(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    if (error instanceof MarketplaceLinkError) throw error;
    throw new MarketplaceLinkError(errorCode(error), path, error);
  }
}

export async function resolveLinkTarget(parent: string, name: string): Promise<string> {
  const path = linkPath(parent, name);
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) throw new MarketplaceLinkError("EPERM", path);
    return await readlink(path);
  } catch (error) {
    if (error instanceof MarketplaceLinkError) throw error;
    throw new MarketplaceLinkError(errorCode(error), path, error);
  }
}
