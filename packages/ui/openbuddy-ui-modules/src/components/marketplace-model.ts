/**
 * marketplace-model — 市场面板的纯函数模型层。
 *
 * 设计取舍:本文件不导入任何 React / IPC,只做数据整形,方便单测覆盖
 * 全部过滤、排序、版本比较与能力摘要规则。组件层(MarketplaceTab /
 * MarketplaceCard / InstallDialog / CapabilityVersionBadge)只消费这里
 * 的类型和函数,不重复实现业务规则(grep 友好、可被宿主二次复用)。
 *
 * 为什么自己实现 semver 比较:OpenBuddy 的 renderer 侧不引入 `semver`
 * 依赖(打包体积 + 供应链),这里只需要子集语义 —— 主/次/修订号 +
 * prerelease 的比较,以及 `update-available` / `downgrade` /
 * `incompatible` 三态判定,足够市场 UI 使用。
 */

/** 市场条目类型。一个条目可以同时属于多个 kind(例如插件内置主题)。 */
export type MarketplaceKind = "plugin" | "skill" | "extension" | "mcp" | "theme" | "prompt";

export const MARKETPLACE_KINDS: readonly MarketplaceKind[] = [
  "plugin",
  "skill",
  "extension",
  "mcp",
  "theme",
  "prompt",
];

export const MARKETPLACE_KIND_LABELS: Record<MarketplaceKind, string> = {
  plugin: "插件",
  skill: "技能",
  extension: "扩展",
  mcp: "MCP",
  theme: "主题",
  prompt: "提示词",
};

/** 安装状态徽标的取值。由宿主计算后传入,组件只负责呈现。 */
export type InstallState =
  "available" | "installing" | "installed" | "update-available" | "blocked";

export const INSTALL_STATE_LABELS: Record<InstallState, string> = {
  available: "可安装",
  installing: "安装中",
  installed: "已安装",
  "update-available": "可更新",
  blocked: "已阻止",
};

/** 版本关系 — 供 CapabilityVersionBadge 呈现升级 / 回滚操作。 */
export type VersionRelation = "same" | "upgrade" | "downgrade" | "incompatible" | "unknown";

export const VERSION_RELATION_LABELS: Record<VersionRelation, string> = {
  same: "已是最新",
  upgrade: "可升级",
  downgrade: "可回滚",
  incompatible: "版本不兼容",
  unknown: "未知版本",
};

export type CapabilityRisk = "low" | "medium" | "high";

export const CAPABILITY_RISK_LABELS: Record<CapabilityRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

export interface MarketplaceCapability {
  /** 稳定标识,例如 `fs.write` / `network.fetch`。 */
  id: string;
  /** 面向用户的可读名;缺省时组件回落展示 `id`。 */
  label?: string;
  /** 风险等级;缺省视为低风险。 */
  risk?: CapabilityRisk;
  /** 可选说明,用于 InstallDialog 的权限清单。 */
  detail?: string;
}

export interface MarketplaceEntry {
  id: string;
  name: string;
  publisher: string;
  description: string;
  /** 市场推荐(最新)版本。 */
  version: string;
  kinds: readonly MarketplaceKind[];
  /** pi.dev 风格:主类型徽章。`kinds` 可保留多 kind,`primaryKind` 用于徽章展示。 */
  primaryKind?: MarketplaceKind;
  /** 同一包的多 kind(向后兼容)。 */
  extraKinds?: readonly MarketplaceKind[];
  capabilities?: readonly MarketplaceCapability[];
  installedVersion?: string;
  /** 宿主标记的兼容性结论(通常是引擎区间不匹配)。 */
  incompatible?: boolean;
  blockedReason?: string;
  /** 单字符 / emoji 图标;缺省时组件回落到名称首字母。 */
  icon?: string;
  homepage?: string;
  dependencies?: readonly string[];
  /** 用于 `sort=recent` 的 ISO 时间戳。 */
  updatedAt?: string;
  installedBytes?: number;

  // ---- R83 pi-market 新增字段(全部可选,向后兼容) ----
  /** pi.dev 风格:每个条目有唯一 npm 名,用于 `pi install npm:<x>`。 */
  npmName?: string;
  /** 最近 30 天 NPM 下载量。 */
  downloadsLastMonth?: number;
  /** 全文检索串(name + description + author + tags),由 host 计算,避免 client 拼。 */
  searchBlob?: string;
  /** 来源 registry 名(由 pi-market-bridge 填)。 */
  sourceLabel?: string;
  sourceKind?: "official" | "community" | "local";
  /** 详情链接(npm / repo / report)。 */
  npmUrl?: string;
  repoUrl?: string;
  reportUrl?: string;
  /** 安装命令模板,默认 `pi install npm:<npmName>`。 */
  installCommand?: string;
}

export type MarketplaceSortKey = "relevance" | "name" | "publisher" | "recent" | "size" | "downloads";

export const MARKETPLACE_SORT_LABELS: Record<MarketplaceSortKey, string> = {
  relevance: "相关度",
  name: "名称",
  publisher: "发布者",
  recent: "最近更新",
  size: "体积",
  downloads: "下载量",
};

export interface MarketplaceFilter {
  query?: string;
  /** 空数组 / 缺省视为「全部」;命中任一 kind 即保留。 */
  kinds?: readonly MarketplaceKind[];
  /** 空数组 / 缺省视为「全部」;条目需声明全部列出的能力。 */
  capabilities?: readonly string[];
  installStates?: readonly InstallState[];
  /** 只保留不含高风险能力的条目。 */
  excludeHighRisk?: boolean;
}

export interface MarketplaceFacet {
  kind: MarketplaceKind;
  count: number;
}

// ---------------------------------------------------------------------------
// semver 子集
// ---------------------------------------------------------------------------

export interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
  build?: string;
}

const SEMVER_RE =
  /^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** 解析宽松 semver(允许 `v` 前缀与缺省的次/修订号)。非法输入返回 null。 */
export function parseSemver(input: string | undefined | null): SemverParts | null {
  if (typeof input !== "string") return null;
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  const prereleaseRaw = match[4];
  const prerelease: (string | number)[] = [];
  if (prereleaseRaw) {
    for (const segment of prereleaseRaw.split(".")) {
      if (/^\d+$/.test(segment)) prerelease.push(Number(segment));
      else prerelease.push(segment);
    }
  }
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease,
    ...(match[5] ? { build: match[5] } : {}),
  };
}

function comparePrereleaseIdentifier(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "number") return -1; // 数字标识符低于字母标识符
  if (typeof b === "number") return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** semver 比较:返回 -1 / 0 / 1;任一版本非法返回 null(调用方自行决定回落)。 */
export function compareSemver(
  a: string | undefined | null,
  b: string | undefined | null,
): number | null {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  // 有 prerelease 的版本低于同号正式版。
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const verdict = comparePrereleaseIdentifier(l, r);
    if (verdict !== 0) return verdict;
  }
  return 0;
}

/**
 * 判定「候选版本相对当前版本」的关系。
 * `candidate` 通常来自市场推荐版本,`current` 来自本地已安装版本。
 */
export function classifyVersion(
  current: string | undefined | null,
  candidate: string | undefined | null,
  options: { incompatible?: boolean } = {},
): VersionRelation {
  if (options.incompatible) return "incompatible";
  if (!current) return candidate ? "upgrade" : "unknown";
  if (!candidate) return "unknown";
  const verdict = compareSemver(candidate, current);
  if (verdict === null) return candidate === current ? "same" : "unknown";
  if (verdict === 0) return "same";
  return verdict > 0 ? "upgrade" : "downgrade";
}

/** 是否「主版本不同」— 用于在 UI 上把升级标成破坏性变更。 */
export function isMajorUpgrade(
  current: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const left = parseSemver(current);
  const right = parseSemver(candidate);
  if (!left || !right) return false;
  return right.major > left.major;
}

/** 稳定排序:按 semver 降序(无法解析的版本排在末尾)。 */
export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => {
    const verdict = compareSemver(b, a);
    if (verdict === null) return 0;
    return verdict;
  });
}

// ---------------------------------------------------------------------------
// 安装状态 / 能力摘要
// ---------------------------------------------------------------------------

export interface ResolveInstallStateInput {
  installedVersion?: string | null;
  version?: string | null;
  incompatible?: boolean;
  installing?: boolean;
  blockedReason?: string | null;
}

/**
 * 由「本地版本 + 推荐版本 + 兼容性」推导徽标状态。
 * 优先级:installing > blocked > update-available > installed > available。
 */
export function resolveInstallState(input: ResolveInstallStateInput): InstallState {
  if (input.installing) return "installing";
  if (input.incompatible || input.blockedReason) return "blocked";
  if (!input.installedVersion) return "available";
  const relation = classifyVersion(input.installedVersion, input.version);
  if (relation === "upgrade") return "update-available";
  return "installed";
}

/** 能力摘要结果 — 供卡片 chip 行与对话框权限清单共用。 */
export interface CapabilitySummary {
  /** 截断后实际展示的能力。 */
  shown: MarketplaceCapability[];
  /** 被截断的数量(卡片上用 `+N` 呈现)。 */
  hiddenCount: number;
  total: number;
  hasHighRisk: boolean;
  hasMediumRisk: boolean;
  /** 风险最高的能力;无能力时为 undefined。 */
  riskiest?: MarketplaceCapability;
}

const RISK_ORDER: Record<CapabilityRisk, number> = { low: 0, medium: 1, high: 2 };

/** 归一化能力风险等级(缺省 low)。 */
export function capabilityRisk(capability: MarketplaceCapability): CapabilityRisk {
  return capability.risk ?? "low";
}

/** 汇总能力清单:截断展示 + 风险统计。 */
export function summarizeCapabilities(
  capabilities: readonly MarketplaceCapability[] | undefined,
  max = 3,
): CapabilitySummary {
  const list = capabilities ?? [];
  const limit = Math.max(0, Math.floor(max));
  const sortedByRisk = [...list].sort(
    (a, b) => RISK_ORDER[capabilityRisk(b)] - RISK_ORDER[capabilityRisk(a)],
  );
  return {
    shown: sortedByRisk.slice(0, limit),
    hiddenCount: Math.max(0, list.length - limit),
    total: list.length,
    hasHighRisk: list.some((capability) => capabilityRisk(capability) === "high"),
    hasMediumRisk: list.some((capability) => capabilityRisk(capability) === "medium"),
    ...(sortedByRisk[0] ? { riskiest: sortedByRisk[0] } : {}),
  };
}

/** 收集一组条目里出现过的能力 id(用于能力过滤器选项)。 */
export function collectCapabilityIds(entries: readonly MarketplaceEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const capability of entry.capabilities ?? []) seen.add(capability.id);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** 统计每种 kind 的条目数(用于过滤器 chip 上的计数)。 */
export function collectKindFacets(entries: readonly MarketplaceEntry[]): MarketplaceFacet[] {
  const counts = new Map<MarketplaceKind, number>();
  for (const entry of entries) {
    for (const kind of entry.kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return MARKETPLACE_KINDS.map((kind) => ({ kind, count: counts.get(kind) ?? 0 }));
}

// ---------------------------------------------------------------------------
// 过滤 / 排序 / 搜索
// ---------------------------------------------------------------------------

function matchesQuery(entry: MarketplaceEntry, needle: string): boolean {
  const haystack = [
    entry.name,
    entry.id,
    entry.publisher,
    entry.description,
    ...(entry.capabilities ?? []).flatMap((capability) => [capability.id, capability.label ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
  // 空格分隔的词必须全部命中(AND),便于「plugin fs」这类组合搜索。
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** 相关度打分:名称前缀 > 名称包含 > 发布者包含 > 描述包含。 */
export function scoreRelevance(entry: MarketplaceEntry, query: string): number {
  const needle = query.trim().toLowerCase();
  let score = 0;
  if (needle) {
    const name = entry.name.toLowerCase();
    const id = entry.id.toLowerCase();
    const publisher = entry.publisher.toLowerCase();
    const description = entry.description.toLowerCase();
    for (const token of needle.split(/\s+/).filter(Boolean)) {
      if (name.startsWith(token) || id.startsWith(token)) score += 6;
      else if (name.includes(token) || id.includes(token)) score += 4;
      if (publisher.includes(token)) score += 2;
      if (description.includes(token)) score += 1;
    }
  }
  // 已安装的条目在同等相关度下稍微靠前(用户更常重复访问)。空查询时
  // 这一权重就是「已安装优先」的默认排序。
  if (entry.installedVersion) score += 0.5;
  return score;
}

function compareNumbersDesc(a: number | undefined, b: number | undefined): number {
  return (b ?? -1) - (a ?? -1);
}

function compareIsoDesc(a: string | undefined, b: string | undefined): number {
  const left = a ?? "";
  const right = b ?? "";
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function compareTextAsc(a: string, b: string): number {
  return a.localeCompare(b, "zh-Hans-CN", { sensitivity: "base" });
}

/** 排序:稳定、不改动入参数组(返回新数组)。 */
export function sortMarketplaceEntries(
  entries: readonly MarketplaceEntry[],
  sort: MarketplaceSortKey = "relevance",
  query = "",
): MarketplaceEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    switch (sort) {
      case "name":
        return compareTextAsc(a.name, b.name);
      case "publisher":
        return compareTextAsc(a.publisher, b.publisher) || compareTextAsc(a.name, b.name);
      case "recent":
        return compareIsoDesc(a.updatedAt, b.updatedAt) || compareTextAsc(a.name, b.name);
      case "size":
        return (
          compareNumbersDesc(a.installedBytes, b.installedBytes) || compareTextAsc(a.name, b.name)
        );
      case "downloads":
        return (
          compareNumbersDesc(a.downloadsLastMonth, b.downloadsLastMonth) ||
          compareTextAsc(a.name, b.name)
        );
      case "relevance":
      default: {
        const delta = scoreRelevance(b, query) - scoreRelevance(a, query);
        if (Math.abs(delta) > 1e-9) return delta;
        return compareTextAsc(a.name, b.name);
      }
    }
  });
  return copy;
}

/** 过滤入口:query + kind + capability + installState + 高风险排除。 */
export function filterMarketplaceEntries(
  entries: readonly MarketplaceEntry[],
  filter: MarketplaceFilter = {},
): MarketplaceEntry[] {
  const needle = (filter.query ?? "").trim().toLowerCase();
  const kinds = filter.kinds ?? [];
  const capabilities = filter.capabilities ?? [];
  const states = filter.installStates ?? [];
  return entries.filter((entry) => {
    if (needle && !matchesQuery(entry, needle)) return false;
    if (kinds.length > 0 && !entry.kinds.some((kind) => kinds.includes(kind))) return false;
    if (capabilities.length > 0) {
      const owned = new Set((entry.capabilities ?? []).map((capability) => capability.id));
      if (!capabilities.every((capability) => owned.has(capability))) return false;
    }
    if (states.length > 0) {
      const state = resolveInstallState({
        installedVersion: entry.installedVersion,
        version: entry.version,
        incompatible: entry.incompatible,
        blockedReason: entry.blockedReason,
      });
      if (!states.includes(state)) return false;
    }
    if (filter.excludeHighRisk && summarizeCapabilities(entry.capabilities).hasHighRisk)
      return false;
    return true;
  });
}

/** 一站式:过滤 → 排序。组件层只用这一个函数,避免两处规则漂移。 */
export function selectMarketplaceEntries(
  entries: readonly MarketplaceEntry[],
  filter: MarketplaceFilter = {},
  sort: MarketplaceSortKey = "relevance",
): MarketplaceEntry[] {
  return sortMarketplaceEntries(
    filterMarketplaceEntries(entries, filter),
    sort,
    filter.query ?? "",
  );
}

/** 高亮搜索命中(返回带 <mark> 语义的分段),避免组件里塞正则。 */
export function highlightSegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [{ text, match: false }];
  const tokens = [...new Set(needle.split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const pattern = new RegExp(
    `(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  const out: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) out.push({ text: text.slice(lastIndex, index), match: false });
    out.push({ text: match[0], match: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) out.push({ text: text.slice(lastIndex), match: false });
  return out.length > 0 ? out : [{ text, match: false }];
}

/** 人类可读体积(1024 进制),用于卡片上的安装体积提示。 */
export function formatBytes(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unitIndex]}`;
}
