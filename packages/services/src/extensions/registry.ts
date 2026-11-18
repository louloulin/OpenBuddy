import { protocolError } from "@openbuddy/protocol/errors";
import { validRegistryQuery, type ExtensionRegistryPackage, type ExtensionRegistrySearch } from "@openbuddy/protocol/extensions";

/**
 * Pi 包市场搜索 (S15): the public npm registry, filtered by Pi's own `pi-package` keyword.
 *
 * The registry is the honest source of truth — every row is an installable package, and
 * installation still goes through Pi's `DefaultPackageManager`, so nothing here claims a
 * feature the package does not ship. Results are cached per query (60 s) so typing in the
 * search box does not hammer the registry. Network errors become protocol codes; response
 * bodies are never echoed back to the renderer.
 */

const DEFAULT_ENDPOINT = "https://registry.npmjs.org/-/v1/search";
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 20;
const PAGE_SIZE = 25;
/** npm caps `from` at 1000; beyond that the API repeats or rejects. */
const MAX_FROM = 1000;
const MAX_TEXT = 500;

export interface ExtensionRegistryOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
  now?: () => number;
}

const text = (value: unknown, max = MAX_TEXT): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

/** Map one npm search row; anything malformed is skipped instead of leaking partial rows. */
function toPackage(entry: unknown): ExtensionRegistryPackage | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const row = entry as Record<string, unknown>;
  const pkg = row.package;
  if (!pkg || typeof pkg !== "object") return undefined;
  const data = pkg as Record<string, unknown>;
  const name = text(data.name, 214);
  if (!name) return undefined;
  const links = (data.links && typeof data.links === "object" ? data.links : {}) as Record<string, unknown>;
  const downloads = (row.downloads && typeof row.downloads === "object" ? row.downloads : {}) as Record<string, unknown>;
  const publisher = (data.publisher && typeof data.publisher === "object" ? data.publisher : {}) as Record<string, unknown>;
  const keywords = Array.isArray(data.keywords)
    ? data.keywords.map((item) => text(item, 40)).filter((item): item is string => !!item).slice(0, 20)
    : [];
  return {
    name,
    version: text(data.version, 64) ?? "",
    description: text(data.description) ?? "",
    ...(text(publisher.username, 80) ? { publisher: text(publisher.username, 80) } : {}),
    ...(text(data.license, 40) ? { license: text(data.license, 40) } : {}),
    ...(text(row.updated, 40) ? { updated: text(row.updated, 40) } : {}),
    ...(count(downloads.weekly) !== undefined ? { weeklyDownloads: count(downloads.weekly) } : {}),
    ...(count(downloads.monthly) !== undefined ? { monthlyDownloads: count(downloads.monthly) } : {}),
    keywords,
    ...(text(links.homepage, 2048) ? { homepage: text(links.homepage, 2048) } : {}),
    ...(text(links.repository, 2048) ? { repository: text(links.repository, 2048) } : {}),
    ...(text(links.npm, 2048) ? { npmUrl: text(links.npm, 2048) } : {}),
  };
}

export class ExtensionRegistryService {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, ExtensionRegistrySearch>();

  constructor(options: ExtensionRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async search(query = "", options: { from?: number } = {}): Promise<ExtensionRegistrySearch> {
    if (!validRegistryQuery(query)) throw protocolError("invalid_payload", "query");
    const from = options.from ?? 0;
    if (!Number.isInteger(from) || from < 0 || from > MAX_FROM) throw protocolError("invalid_payload", "from");
    const trimmed = query.trim();
    const key = `${trimmed.toLowerCase()}|${from}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

    const searchText = trimmed ? `keywords:pi-package ${trimmed}` : "keywords:pi-package";
    const url = `${this.endpoint}?text=${encodeURIComponent(searchText)}&size=${PAGE_SIZE}&from=${from}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch {
      throw protocolError("registry_unreachable");
    }
    if (!response.ok) throw protocolError("registry_unreachable", `HTTP ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw protocolError("registry_invalid_response");
    }
    if (!body || typeof body !== "object") throw protocolError("registry_invalid_response");
    const objects = (body as { objects?: unknown }).objects;
    if (!Array.isArray(objects)) throw protocolError("registry_invalid_response");
    const packages = objects.map(toPackage).filter((item): item is ExtensionRegistryPackage => !!item);
    const total = count((body as { total?: unknown }).total) ?? packages.length;
    const result: ExtensionRegistrySearch = {
      query: trimmed,
      source: "npm",
      total,
      from,
      packages,
      fetchedAt: this.now(),
    };
    this.cache.set(key, result);
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = [...this.cache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    return result;
  }
}
