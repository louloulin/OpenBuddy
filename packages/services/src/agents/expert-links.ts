/**
 * 专家链接 (B3b): a source is an https URL or a local package path. The same source + same bytes
 * imports once; the registry records the digest so a second open can go straight to the detail.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fetchRemoteBytes, type RemoteFetchOptions } from "./remote-fetch.js";

export interface ExpertLinkRecord {
  source: string;
  sha256: string;
  package: string;
  experts: string[];
  at: string;
}

export interface ExpertLinkSource {
  source: string;
  /** `https`/`http` source, or `false` for a local path. */
  remote: boolean;
  /** File name for parsers; for a local directory this is the directory name. */
  name: string;
  /** Present for files and remote downloads; absent for a local directory. */
  bytes?: Buffer;
  /** Present for a local path (file or directory). */
  path?: string;
  sha256: string;
  size: number;
}

const MAX_FILES = 500;
const MAX_DIR_BYTES = 20 * 1024 * 1024;

export class ExpertLinkRegistry {
  private file: string;
  constructor(private dir: string) {
    this.file = join(dir, "expert-links.json");
  }
  private read(): ExpertLinkRecord[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { links?: unknown };
      return Array.isArray(parsed?.links) ? (parsed.links as ExpertLinkRecord[]) : [];
    } catch {
      return [];
    }
  }
  private write(links: ExpertLinkRecord[]) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(this.file, `${JSON.stringify({ schemaVersion: 1, links: links.slice(0, 200) }, null, 2)}\n`, { mode: 0o600 });
  }
  get(source: string): ExpertLinkRecord | undefined {
    return this.read().find((entry) => entry.source === source);
  }
  record(entry: ExpertLinkRecord) {
    const next = this.read().filter((item) => item.source !== entry.source);
    next.unshift(entry);
    this.write(next);
  }
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Hash a package directory deterministically (sorted paths + content) with the same caps. */
function hashDirectory(root: string): { sha256: string; size: number } {
  const hash = createHash("sha256");
  let size = 0;
  let files = 0;
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (files > MAX_FILES) throw Error(`remote_too_large: 包内文件超过 ${MAX_FILES} 个`);
      const bytes = readFileSync(path);
      size += bytes.length;
      if (size > MAX_DIR_BYTES) throw Error(`remote_too_large: 包体超过 ${MAX_DIR_BYTES} 字节`);
      hash.update(relative(root, path).split("\\").join("/"));
      hash.update("\0");
      hash.update(bytes);
    }
  };
  walk(root);
  return { sha256: hash.digest("hex"), size };
}

/** Read a link source into bytes (remote/file) or a directory descriptor (local folder). */
export async function readExpertLink(source: string, options: RemoteFetchOptions = {}): Promise<ExpertLinkSource> {
  const value = source.trim();
  if (/^https?:\/\//i.test(value)) {
    const result = await fetchRemoteBytes(value, options);
    return {
      source: value,
      remote: true,
      name: basename(new URL(result.finalUrl).pathname) || "package.zip",
      bytes: result.bytes,
      sha256: digest(result.bytes),
      size: result.bytes.length,
    };
  }
  let stat;
  let real: string;
  try {
    real = realpathSync(value);
    stat = statSync(real);
  } catch {
    throw Error("remote_invalid_source: 链接或路径不存在");
  }
  if (stat.isDirectory()) {
    const hashed = hashDirectory(real);
    return { source: value, remote: false, name: basename(real), path: real, ...hashed };
  }
  if (!stat.isFile()) throw Error("remote_invalid_source: 不是文件或目录");
  const bytes = readFileSync(real);
  if (bytes.length > MAX_DIR_BYTES) throw Error(`remote_too_large: 文件超过 ${MAX_DIR_BYTES} 字节`);
  return { source: value, remote: false, name: basename(real), path: real, bytes, sha256: digest(bytes), size: bytes.length };
}
