import { protocolError } from "@openbuddy/protocol/errors";
import {
  EXTENSION_CATEGORIES,
  validPackageName,
  validRegistryQuery,
  type ExtensionCategory,
  type ExtensionPackageDetails,
  type ExtensionRegistryPackage,
  type ExtensionRegistrySearch,
} from "@openbuddy/protocol/extensions";

/**
 * Pi 包市场搜索 (S15): the public npm registry, filtered by Pi's own `pi-package` keyword.
 *
 * The registry is the honest source of truth — every row is an installable package, and
 * installation still goes through Pi's `DefaultPackageManager`, so nothing here claims a
 * feature the package does not ship. Results are cached per query (60 s) so typing in the
 * search box does not hammer the registry. Network errors become protocol codes; response
 * bodies are never echoed back to the renderer.
 *
 * E1 adds two honest extensions: package details from the packument (`dist.integrity`,
 * maintainers, publish time, git commit) and capability categories derived from the package's
 * own npm keywords — never a hand-written marketplace list.
 */

const DEFAULT_ENDPOINT = "https://registry.npmjs.org/-/v1/search";
const DEFAULT_PACKUMENT_BASE = "https://registry.npmjs.org";
const DEFAULT_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 20;
const PAGE_SIZE = 25;
/** npm caps `from` at 1000; beyond that the API repeats or rejects. */
const MAX_FROM = 1000;
const MAX_TEXT = 500;
/** A packument for one package is small; 1 MB is a generous cap. */
const MAX_PACKUMENT_BYTES = 1024 * 1024;

/**
 * 能力分类派生：把包自己的 npm keywords 映射到固定分类。
 * 关键词来自 npm，映射规则是公开的常量，不随产品臆造分类。
 */
const CATEGORY_KEYWORDS: Array<[ExtensionCategory, string[]]> = [
  ["web", ["web", "browser", "crawl", "scrape", "fetch", "url", "http", "playwright", "puppeteer"]],
  ["search", ["search", "search-engine", "query", "retrieval", "rag", "vector", "index"]],
  ["memory", ["memory", "knowledge", "notes", "notion", "obsidian", "wiki", "database", "sql", "kv"]],
  ["mcp", ["mcp", "model-context-protocol", "connector", "server", "tool-server"]],
  ["docs", ["doc", "docs", "pdf", "office", "word", "excel", "ppt", "markdown", "spreadsheet", "report"]],
  ["dev", ["code", "coding", "git", "github", "gitlab", "lint", "test", "typescript", "python", "ide", "lsp"]],
  ["media", ["image", "video", "audio", "tts", "stt", "vision", "diffusion", "render", "screenshot"]],
  ["automation", ["automation", "workflow", "cron", "schedule", "task", "pipeline", "trigger"]],
];

/** 分类：包的 keywords 命中哪几类；命中不了才是 `other`。 */
export function deriveCategories(keywords: readonly string[], description = ""): ExtensionCategory[] {
  const haystack = [...keywords.map((k) => k.toLowerCase()), description.toLowerCase()];
  const found = new Set<ExtensionCategory>();
  for (const [category, needles] of CATEGORY_KEYWORDS) {
    if (haystack.some((word) => needles.some((needle) => word.includes(needle)))) found.add(category);
  }
  if (found.size === 0) found.add("other");
  // Keep the fixed order so the UI never reshuffles between renders.
  return EXTENSION_CATEGORIES.filter((category) => found.has(category));
}

export interface ExtensionRegistryOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  /** Base URL for single-package packuments (default: the public npm registry). */
  packumentBase?: string;
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

/** npm scores are fractions except `final`, which npm does not normalise (e.g. 202.6). */
const fraction = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round(value * 1000) / 1000 : undefined;
const rawScore = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;

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
  const scoreRow = (row.score && typeof row.score === "object" ? row.score : {}) as Record<string, unknown>;
  const detail = (scoreRow.detail && typeof scoreRow.detail === "object" ? scoreRow.detail : {}) as Record<string, unknown>;
  const final = rawScore(scoreRow.final);
  const quality = fraction(detail.quality);
  const popularity = fraction(detail.popularity);
  const maintenance = fraction(detail.maintenance);
  const score =
    final !== undefined && quality !== undefined && popularity !== undefined && maintenance !== undefined
      ? { final, quality, popularity, maintenance }
      : undefined;
  const categories = deriveCategories(keywords, typeof data.description === "string" ? data.description : "");
  return {
    name,
    version: text(data.version, 64) ?? "",
    description: text(data.description) ?? "",
    ...(text(publisher.username, 80) ? { publisher: text(publisher.username, 80) } : {}),
    ...(text(data.license, 40) ? { license: text(data.license, 40) } : {}),
    ...(text(row.updated, 40) ? { updated: text(row.updated, 40) } : {}),
    ...(count(downloads.weekly) !== undefined ? { weeklyDownloads: count(downloads.weekly) } : {}),
    ...(count(downloads.monthly) !== undefined ? { monthlyDownloads: count(downloads.monthly) } : {}),
    ...(score ? { score } : {}),
    keywords,
    ...(categories.length ? { categories } : {}),
    ...(text(links.homepage, 2048) ? { homepage: text(links.homepage, 2048) } : {}),
    ...(text(links.repository, 2048) ? { repository: text(links.repository, 2048) } : {}),
    ...(text(links.npm, 2048) ? { npmUrl: text(links.npm, 2048) } : {}),
  };
}

export class ExtensionRegistryService {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly packumentBase: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, ExtensionRegistrySearch>();

  constructor(private readonly options: ExtensionRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.packumentBase = options.packumentBase ?? DEFAULT_PACKUMENT_BASE;
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

  /**
   * 一个包的完整信息 (E1)：npm packument 里的 `dist.integrity`、维护者、发布时间与 git commit。
   *
   * 这是审查一个包「是否可信」的真实依据：integrity 是安装时用来校验 tarball 的 SRI 值，
   * maintainers 是真正发布它的人，`gitHead` 是 git 包对应的 commit。不臆造「官方签名」。
   */
  async details(name: string): Promise<ExtensionPackageDetails> {
    if (!validPackageName(name)) throw protocolError("invalid_payload", "name");
    const fetchImpl = this.fetchImpl;
    const base = this.packumentBase;
    const url = `${base.replace(/\/$/, "")}/${encodeURIComponent(name)}`;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: "application/json" },
      });
    } catch {
      throw protocolError("registry_unreachable");
    }
    if (!response.ok) throw protocolError("registry_unreachable", `HTTP ${response.status}`);
    const declared = Number(response.headers?.get?.("content-length") ?? 0);
    if (declared > MAX_PACKUMENT_BYTES) throw protocolError("registry_invalid_response");
    let body: unknown;
    try {
      const raw = await response.text();
      if (raw.length > MAX_PACKUMENT_BYTES) throw protocolError("registry_invalid_response");
      body = JSON.parse(raw);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("registry_")) throw error;
      throw protocolError("registry_invalid_response");
    }
    if (!body || typeof body !== "object") throw protocolError("registry_invalid_response");
    const doc = body as Record<string, unknown>;
    const versions = (doc.versions && typeof doc.versions === "object" ? doc.versions : {}) as Record<string, unknown>;
    const latest = text(doc["dist-tags"] && (doc["dist-tags"] as Record<string, unknown>).latest, 64);
    const version = latest && versions[latest] ? latest : text(doc.version, 64);
    const manifest = (version && versions[version] ? versions[version] : doc) as Record<string, unknown>;
    const dist = (manifest.dist && typeof manifest.dist === "object" ? manifest.dist : {}) as Record<string, unknown>;
    const time = (doc.time && typeof doc.time === "object" ? doc.time : {}) as Record<string, unknown>;
    const maintainers = Array.isArray(manifest.maintainers)
      ? manifest.maintainers
          .map((entry) => (entry && typeof entry === "object" ? text((entry as Record<string, unknown>).name, 80) : text(entry, 80)))
          .filter((entry): entry is string => !!entry)
          .slice(0, 20)
      : [];
    const keywords = Array.isArray(manifest.keywords)
      ? manifest.keywords.map((item) => text(item, 40)).filter((item): item is string => !!item)
      : [];
    const repository = manifest.repository;
    const repositoryUrl =
      typeof repository === "string"
        ? text(repository, 512)
        : repository && typeof repository === "object"
          ? text((repository as Record<string, unknown>).url, 512)
          : undefined;
    return {
      name: text(doc.name, 214) ?? name,
      version: version ?? "",
      ...(text(dist.integrity, 200) ? { integrity: text(dist.integrity, 200) } : {}),
      ...(text(dist.shasum, 200) ? { shasum: text(dist.shasum, 200) } : {}),
      maintainers,
      ...(text(time[version ?? ""], 64) ? { publishedAt: text(time[version ?? ""], 64) } : {}),
      ...(repositoryUrl ? { repository: repositoryUrl } : {}),
      ...(text(manifest.gitHead, 80) ? { gitHead: text(manifest.gitHead, 80) } : {}),
      ...(text(manifest.license, 64) ? { license: text(manifest.license, 64) } : {}),
      ...(typeof manifest.unpackedSize === "number" && Number.isFinite(manifest.unpackedSize)
        ? { unpackedSize: Math.round(manifest.unpackedSize) }
        : {}),
      categories: deriveCategories(keywords, typeof manifest.description === "string" ? manifest.description : ""),
    };
  }
}
