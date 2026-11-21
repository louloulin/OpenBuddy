import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * 更新检查 (A3, 本地可验证部分).
 *
 * The app never installs an update silently. It fetches a small signed-release manifest from the
 * configured feed, compares versions, and hands the user the release notes + download link. The
 * feed must be HTTPS; plain HTTP is accepted only for loopback so tests and a local release
 * mirror work without weakening the production path.
 *
 * Manifest (`latest.json`):
 *   { "version": "1.1.0", "channel": "stable", "publishedAt": "…", "notes": "…",
 *     "download": { "url": "https://…", "sha256": "…", "size": 123 } }
 */
export type UpdateChannel = "stable" | "beta";

export interface UpdateManifest {
  version: string;
  channel: UpdateChannel;
  notes?: string;
  publishedAt?: string;
  download: { url: string; sha256?: string; size?: number };
}

export interface UpdateResult {
  status: "available" | "up-to-date";
  currentVersion: string;
  version: string;
  channel: UpdateChannel;
  notes?: string;
  publishedAt?: string;
  download: UpdateManifest["download"];
}

export interface UpdateOptions {
  currentVersion: string;
  feedUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Max manifest bytes; keeps a hostile feed from allocating without bound. */
  maxBytes?: number;
  /** Max installer bytes for `download` (default 512 MB). */
  maxDownloadBytes?: number;
  /** Download timeout (default 10 min). */
  downloadTimeoutMs?: number;
}

/** One verified installer download. */
export interface UpdateDownloadRequest {
  url: string;
  sha256?: string;
  size?: number;
  /** Directory the app owns (desktop: `<userData>/updates`). */
  dir: string;
}

export interface UpdateDownloadResult {
  path: string;
  bytes: number;
  sha256: string;
}

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

const isLoopback = (url: URL) => LOOPBACK.test(url.hostname) || url.hostname === "0.0.0.0";

/** Feed and download URLs: HTTPS anywhere, plain HTTP only on loopback. Never with credentials. */
export function assertFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_feed_url");
  }
  if (url.username || url.password) throw new Error("invalid_feed_url");
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && isLoopback(url)) return url;
  throw new Error("insecure_feed_url");
}

const numeric = (value: string) => value.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));

/** Semver-ish comparison; a missing prerelease sorts above any prerelease. */
export function compareVersions(a: string, b: string): number {
  const clean = (value: string) => value.trim().replace(/^v/i, "");
  const [leftCore, leftPre] = clean(a).split("-", 2);
  const [rightCore, rightPre] = clean(b).split("-", 2);
  const left = numeric(leftCore);
  const right = numeric(rightCore);
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) throw new Error("invalid_version");
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  const leftParts = leftPre.split(".");
  const rightParts = rightPre.split(".");
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i += 1) {
    const l = leftParts[i];
    const r = rightParts[i];
    if (l === r) continue;
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn) return Number(l) > Number(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

export function parseManifest(raw: unknown): UpdateManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_manifest");
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "string" || !o.version.trim()) throw new Error("invalid_manifest_version");
  // Fail early on a version we could not compare later.
  compareVersions(o.version, "0.0.0");
  const channel = o.channel === "beta" ? "beta" : o.channel === "stable" || o.channel === undefined ? "stable" : undefined;
  if (!channel) throw new Error("invalid_manifest_channel");
  const download = o.download as Record<string, unknown> | undefined;
  if (!download || typeof download !== "object" || Array.isArray(download)) throw new Error("invalid_manifest_download");
  if (typeof download.url !== "string") throw new Error("invalid_manifest_download");
  assertFeedUrl(download.url);
  if (download.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(String(download.sha256))) throw new Error("invalid_manifest_sha256");
  if (download.size !== undefined && (typeof download.size !== "number" || !Number.isFinite(download.size) || download.size < 0)) throw new Error("invalid_manifest_size");
  return {
    version: o.version.trim(),
    channel,
    ...(typeof o.notes === "string" ? { notes: o.notes.slice(0, 8000) } : {}),
    ...(typeof o.publishedAt === "string" ? { publishedAt: o.publishedAt } : {}),
    download: {
      url: download.url,
      ...(download.sha256 !== undefined ? { sha256: String(download.sha256).toLowerCase() } : {}),
      ...(download.size !== undefined ? { size: download.size as number } : {}),
    },
  };
}

export class UpdateService {
  constructor(private readonly options: UpdateOptions) {}

  async check(input: { feedUrl?: string; channel?: UpdateChannel } = {}): Promise<UpdateResult> {
    const feed = input.feedUrl ?? this.options.feedUrl;
    if (!feed) throw new Error("update_feed_unconfigured");
    const url = assertFeedUrl(feed);
    const channel = input.channel ?? "stable";
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const maxBytes = this.options.maxBytes ?? MAX_BYTES;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? TIMEOUT_MS);
    let text: string;
    try {
      const response = await fetchImpl(url.toString(), { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`update_feed_http_${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new Error("update_manifest_too_large");
      text = await response.text();
      if (text.length > maxBytes) throw new Error("update_manifest_too_large");
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new Error("update_feed_timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("invalid_manifest_json");
    }
    const manifest = parseManifest(parsed);
    if (manifest.channel !== channel) throw new Error("update_channel_mismatch");
    const status = compareVersions(manifest.version, this.options.currentVersion) > 0 ? "available" : "up-to-date";
    return {
      status,
      currentVersion: this.options.currentVersion,
      version: manifest.version,
      channel: manifest.channel,
      download: manifest.download,
      ...(manifest.notes ? { notes: manifest.notes } : {}),
      ...(manifest.publishedAt ? { publishedAt: manifest.publishedAt } : {}),
    };
  }

  /**
   * Download the installer into the app's own directory and verify it before returning.
   *
   * Nothing is executed or installed: the caller reveals the file and the user runs it. The URL is
   * held to the same HTTPS/loopback rule as the feed; a size or checksum mismatch deletes the file
   * and fails loudly instead of leaving a half-trusted artifact behind.
   */
  async download(request: UpdateDownloadRequest): Promise<UpdateDownloadResult> {
    const url = assertFeedUrl(request.url);
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const maxBytes = this.options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
    const dir = request.dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = safeFileName(url);
    const target = join(dir, name);
    const temp = join(dir, `.${name}.part`);
    rmSync(temp, { force: true });

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        signal: AbortSignal.timeout(this.options.downloadTimeoutMs ?? DOWNLOAD_TIMEOUT_MS),
        headers: { accept: "application/octet-stream" },
      });
    } catch (error) {
      if ((error as Error).name === "TimeoutError" || (error as Error).name === "AbortError") throw new Error("update_download_timeout");
      throw new Error("update_download_failed");
    }
    if (!response.ok) throw new Error(`update_download_http_${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("update_download_too_large");

    const hash = createHash("sha256");
    let bytes = 0;
    const sink = createWriteStream(temp, { mode: 0o600 });
    try {
      const body = response.body;
      if (!body) throw new Error("update_download_empty");
      for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maxBytes) throw new Error("update_download_too_large");
        hash.update(buffer);
        if (!sink.write(buffer)) await new Promise<void>((resolve) => sink.once("drain", () => resolve()));
      }
      await new Promise<void>((resolve, reject) => {
        sink.end(() => resolve());
        sink.once("error", reject);
      });
    } catch (error) {
      sink.destroy();
      rmSync(temp, { force: true });
      throw error instanceof Error && /^update_/.test(error.message) ? error : new Error("update_download_failed");
    }

    const actual = hash.digest("hex");
    const cleanup = (message: string): never => {
      rmSync(temp, { force: true });
      throw new Error(message);
    };
    if (request.size !== undefined && bytes !== request.size) cleanup("update_size_mismatch");
    if (request.sha256 && actual !== request.sha256.toLowerCase()) cleanup("update_checksum_mismatch");
    if (statSync(temp).size !== bytes) cleanup("update_size_mismatch");
    rmSync(target, { force: true });
    renameSync(temp, target);
    return { path: target, bytes, sha256: actual };
  }
}

/** A conservative file name from the URL path; never a path fragment the feed controls. */
function safeFileName(url: URL): string {
  const raw = basename(decodeURIComponent(url.pathname)).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
  return raw && raw !== "." && raw !== ".." ? raw : "openbuddy-update.bin";
}
