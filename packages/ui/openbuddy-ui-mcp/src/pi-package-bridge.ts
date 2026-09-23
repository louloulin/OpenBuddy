/**
 * pi-package-bridge — 把 Pi-market bridge 拉到的 `PiMarketEntryView`
 * 适配成 ui-modules 的 `MarketplaceEntry`,并补齐 pi.dev 风格卡片需要的
 * pi-market 字段(npmName / downloadsLastMonth / searchBlob / sourceLabel /
 * npmUrl / repoUrl / reportUrl / installCommand / primaryKind)。
 *
 * 为什么不直接放进 pi-extensions-model.ts:那个文件只覆盖旧 MarketplaceTab
 * 字段(忽略 npm/repo 等新字段),保持它小而稳;新字段集中在这里,R83 之后
 * 旧 `toMarketplaceEntry` 仍然可用,新 `toPiPackageEntry` 是叠加的。
 */
import type {
  PiMarketEntryView,
  PiMarketRegistrySource,
} from "@/lib/pi-market/pi-market-client";
import type { MarketplaceEntry, MarketplaceKind } from "@openbuddy/ui-modules/components";
import { buildInstallCommand, buildSearchBlob } from "@openbuddy/ui-modules/components/pi-market";

/** 把 Pi 官方 / 第三方 / 本地源压缩成"official / community / local"三档。 */
export function piSourceKind(source: PiMarketRegistrySource | undefined): "official" | "community" | "local" {
  if (!source) return "community";
  const url = (source.url ?? "").toLowerCase();
  if (source.kind === "local" || url.startsWith("file:") || url.includes("localhost")) {
    return "local";
  }
  if (
    url.includes("registry.npmjs.org") ||
    url.includes("earendil-works") ||
    source.kind === "official"
  ) {
    return "official";
  }
  return "community";
}

const KIND_FROM_PI_NAMESPACE: Record<string, MarketplaceKind> = {
  "openbuddy-plugin": "plugin",
  "pi-extension": "extension",
  "pi-skill": "skill",
  "pi-theme": "theme",
  "pi-prompt": "prompt",
  "pi-mcp": "mcp",
};

/** 从 Pi-market manifest 推断主类型徽章。 */
export function inferPrimaryKind(view: PiMarketEntryView): MarketplaceKind {
  const ns = (view.manifest?.namespace ?? "").toLowerCase();
  if (ns && KIND_FROM_PI_NAMESPACE[ns]) return KIND_FROM_PI_NAMESPACE[ns];
  const kinds = (view.manifest?.surfaces ?? []).map((s) => String(s).toLowerCase());
  if (kinds.some((k) => k.includes("mcp"))) return "mcp";
  if (kinds.some((k) => k.includes("theme"))) return "theme";
  if (kinds.some((k) => k.includes("skill"))) return "skill";
  if (kinds.some((k) => k.includes("prompt"))) return "prompt";
  if (kinds.some((k) => k.includes("extension") || k.includes("agent"))) return "extension";
  return "plugin";
}

/** 取该条目被多少源提供,作为搜索命中权重(简单代理)。 */
export function downloadsFromMirrors(view: PiMarketEntryView): number | undefined {
  const mirrors = (view.alsoOfferedBy ?? []).length;
  const base = view.versionCount ?? 0;
  if (mirrors === 0 && base === 0) return undefined;
  return mirrors * 10 + base;
}

/**
 * 关键适配器:PiMarketEntryView -> MarketplaceEntry(pi.dev 风格卡片可消费)。
 * 不抛错;字段缺失时回落到合理默认值。
 */
export function toPiPackageEntry(
  view: PiMarketEntryView,
  source: PiMarketRegistrySource | undefined,
): MarketplaceEntry {
  const name = view.name ?? view.id;
  const id = view.id;
  const npmName = view.npmName ?? view.manifest?.npmName ?? id;
  const primaryKind = inferPrimaryKind(view);
  const sourceKind = piSourceKind(source);
  const sourceLabel = source?.name ?? view.sourceName ?? view.sourceId;
  const versions = view.versions ?? [];
  const version = view.recommendedVersion ?? versions[versions.length - 1] ?? view.installedVersion ?? "0.0.0";
  return {
    id,
    name,
    publisher: view.manifest?.author ?? view.publisher ?? "—",
    description: view.manifest?.description ?? view.description ?? "",
    version,
    kinds: [primaryKind],
    primaryKind,
    npmName,
    downloadsLastMonth: downloadsFromMirrors(view),
    updatedAt: view.updatedAt ?? view.manifest?.updatedAt,
    searchBlob: buildSearchBlob([
      name,
      view.manifest?.author,
      view.manifest?.description,
      view.description,
      ...(view.manifest?.tags ?? []),
    ]),
    sourceLabel,
    sourceKind,
    npmUrl: view.npmUrl ?? `https://www.npmjs.com/package/${npmName}`,
    repoUrl: view.repoUrl ?? view.manifest?.repository,
    reportUrl: view.reportUrl,
    installCommand: view.installCommand ?? buildInstallCommand(npmName, id),
    installedVersion: view.installedVersion,
    blockedReason: view.blockedReason,
    incompatible: view.incompatible,
    homepage: view.homepage ?? view.npmUrl,
    capabilities: view.capabilities ?? view.manifest?.capabilities,
  };
}

/** 批量适配 + 按 source 分组。 */
export function toPiPackageEntries(
  views: readonly PiMarketEntryView[],
  sources: readonly PiMarketRegistrySource[],
): MarketplaceEntry[] {
  const sourceById = new Map(sources.map((s) => [s.id, s] as const));
  return views.map((view) => toPiPackageEntry(view, sourceById.get(view.sourceId)));
}
