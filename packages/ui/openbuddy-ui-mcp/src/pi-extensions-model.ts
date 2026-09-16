/**
 * pi-extensions-model — 「Pi 扩展」区块的纯函数模型层。
 *
 * 与 `marketplace-model`(ui-modules)同一套路:这里**不 import React / IPC**,
 * 只做数据整形,因此每条规则都能被单测直接覆盖;组件
 * (`PiExtensionsSection.tsx`)只负责渲染与调用动作,不重复实现业务判断。
 *
 * 为什么单独一层而不是塞进组件:UI 需要把**同一份市场数据**呈现成三种语义
 * (已安装 / 可升级 / 可安装),还要把桥接层的错误码翻译成补救动作。这两件事
 * 都是纯逻辑,放在组件里就只能靠渲染测试间接覆盖。
 */
import type {
  InstallState,
  MarketplaceCapability,
  MarketplaceEntry,
  MarketplaceKind,
} from "@openbuddy/ui-modules/components/marketplace-model";
import type {
  PiMarketEntryView,
  PiMarketErrorInfo,
  PiMarketSourceState,
  PiMarketSourceStatus,
} from "@openbuddy/shared-types";

/**
 * 把桥接层的条目投影成市场 UI 的条目。
 *
 * 只搬 UI 真的会读的字段:`manifest` 不搬(渲染端只关心版本与能力),
 * `sourceId` / `alsoOfferedBy` 搬成卡片上的来源标注。
 */
export function toMarketplaceEntry(entry: PiMarketEntryView): MarketplaceEntry {
  return {
    id: entry.id,
    name: entry.name,
    publisher: entry.publisher,
    description: entry.description,
    version: entry.version,
    kinds: entry.kinds as readonly MarketplaceKind[],
    capabilities: entry.capabilities as readonly MarketplaceCapability[],
    ...(entry.installedVersion ? { installedVersion: entry.installedVersion } : {}),
    ...(entry.incompatible ? { incompatible: true } : {}),
    ...(entry.homepage ? { homepage: entry.homepage } : {}),
    ...(entry.dependencies ? { dependencies: entry.dependencies } : {}),
    ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
    ...(typeof entry.installedBytes === "number" ? { installedBytes: entry.installedBytes } : {}),
  };
}

/**
 * 安装状态(`MarketplaceTab` 用它把卡片切到 installed / update-available 等外观)。
 *
 * 与 `marketplace-model.resolveInstallState` 的区别:这里的输入是桥接层的
 * 权威结论(`installedVersion` / `updateAvailable` / `incompatible` 由 main 判定),
 * 渲染端不再自己比较 semver —— 版本语义只有一处实现(main)。
 */
export function installStateOf(entry: PiMarketEntryView): InstallState {
  if (entry.incompatible) return "blocked";
  if (!entry.installedVersion) return "available";
  if (entry.updateAvailable) return "update-available";
  return "installed";
}

/** 「亦有镜像」标注:同 id 还被哪些低权重源提供。 */
export function mirrorLabel(entry: PiMarketEntryView): string | undefined {
  const mirrors = entry.alsoOfferedBy ?? [];
  return mirrors.length > 0 ? `亦有镜像:${mirrors.join(" / ")}` : undefined;
}

/** 来源标注:`local` 是本地索引,其余是配置的源 id。 */
export function sourceLabel(entry: PiMarketEntryView): string | undefined {
  if (!entry.sourceId) return undefined;
  return entry.sourceId === "local" ? "本地索引" : entry.sourceId;
}

export interface PiExtensionsGroups {
  readonly installed: readonly PiMarketEntryView[];
  readonly updatable: readonly PiMarketEntryView[];
  readonly available: readonly PiMarketEntryView[];
  readonly blocked: readonly PiMarketEntryView[];
}

/** 按「需要用户注意的程度」分组:可升级 → 已安装 → 可安装 → 被阻止。 */
export function groupPiMarketEntries(
  entries: readonly PiMarketEntryView[],
): PiExtensionsGroups {
  const installed: PiMarketEntryView[] = [];
  const updatable: PiMarketEntryView[] = [];
  const available: PiMarketEntryView[] = [];
  const blocked: PiMarketEntryView[] = [];
  for (const entry of entries) {
    switch (installStateOf(entry)) {
      case "update-available":
        updatable.push(entry);
        break;
      case "installed":
        installed.push(entry);
        break;
      case "blocked":
        blocked.push(entry);
        break;
      default:
        available.push(entry);
    }
  }
  return { installed, updatable, available, blocked };
}

export interface PiMarketSourceSummary {
  readonly fresh: number;
  readonly cached: number;
  readonly failed: number;
  readonly skipped: number;
  /** 「N 个源不可达,已用缓存」这类提示;没有需要注意的源时为 undefined。 */
  readonly warning?: string;
}

/**
 * 汇总每源状态。
 *
 * `cached` 与 `failed` 都会产生提示,但文案不同:前者「正在用上次的缓存」是可用
 * 状态,后者「没有缓存」需要用户去修源地址 —— 把两者混成一句会让用户以为市场坏了。
 */
export function summarizeSources(
  sources: readonly PiMarketSourceStatus[] | undefined,
): PiMarketSourceSummary {
  const list = sources ?? [];
  const fresh = list.filter((s) => s.state === "fresh").length;
  const cached = list.filter((s) => s.state === "cached").length;
  const failed = list.filter((s) => s.state === "failed").length;
  const skipped = list.filter((s) => s.state === "skipped").length;
  const parts: string[] = [];
  if (cached > 0) parts.push(`${cached} 个源不可达,已用上次缓存`);
  if (failed > 0) parts.push(`${failed} 个源不可达且没有缓存`);
  return {
    fresh,
    cached,
    failed,
    skipped,
    ...(parts.length > 0 ? { warning: parts.join("；") } : {}),
  };
}

export interface PiSourceChip {
  readonly id: string;
  readonly label: string;
  readonly state?: PiMarketSourceState;
  readonly entryCount: number;
  readonly error?: string;
}

/**
 * 顶部的来源 chips。
 *
 * 优先用一次刷新拿到的**权威**每源状态(`fresh` / `cached` / `failed` / `skipped`);
 * 没有刷新过时退回**从条目反推**(按 `sourceId` 分组计数)—— 这样打开市场就有
 * 来源信息,不需要为了画几个 chip 去强制联网。
 */
export function sourceChips(
  entries: readonly PiMarketEntryView[],
  statuses?: readonly PiMarketSourceStatus[],
): PiSourceChip[] {
  if (statuses && statuses.length > 0) {
    return statuses.map((status) => ({
      id: status.id,
      label: status.label ?? status.id,
      state: status.state,
      entryCount: status.entryCount,
      ...(status.error ? { error: status.error } : {}),
    }));
  }
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.sourceId ?? "local";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, entryCount]) => ({
    id,
    label: id === "local" ? "本地索引" : id,
    entryCount,
  }));
}

export interface PiMarketErrorAction {
  /** 一句话说明发生了什么。 */
  readonly title: string;
  /** 用户下一步该做什么。 */
  readonly hint: string;
  /** 是否值得重试(网络/源问题),false 表示重试同样的动作也不会成功。 */
  readonly retryable: boolean;
}

/**
 * 把错误码翻译成补救动作。
 *
 * 这张表是 UI 里**唯一**读错误码的地方 —— 桥接层新增错误码时只需要在这里补一行,
 * 不会被散落在各处的 `if (code === ...)` 漏掉。
 */
export function describePiMarketError(info: PiMarketErrorInfo): PiMarketErrorAction {
  switch (info.code) {
    case "consent-required":
      return {
        title: "该扩展申请高风险能力",
        hint: "在安装对话框里勾选「同意高风险能力」后重试。",
        retryable: false,
      };
    case "incompatible":
      return {
        title: "宿主版本不兼容",
        hint: "该扩展要求的 OpenBuddy 版本区间与当前宿主不匹配,先升级宿主或换一个版本。",
        retryable: false,
      };
    case "corrupt-install":
      return {
        title: "已安装载荷被外部改写",
        hint: "勾选「强制重新物化」后重试,会用索引里的内容覆盖本地目录。",
        retryable: false,
      };
    case "version-not-found":
      return {
        title: "索引里没有这个版本",
        hint: "换成索引提供的版本,或先刷新索引。",
        retryable: true,
      };
    case "not-found":
      return {
        title: "索引里没有这个扩展",
        hint: "源可能已经更新,刷新索引后重试。",
        retryable: true,
      };
    case "payload-unavailable":
      return {
        title: "取不到安装载荷",
        hint: "该源没有提供可用的载荷(内联 files / 本地目录 / 远端下载),联系源维护者。",
        retryable: false,
      };
    case "payload-rejected":
      return {
        title: "写入失败",
        hint: "载荷写入或提交被拒绝,检查数据目录权限后重试。",
        retryable: true,
      };
    case "unsafe-target":
      return {
        title: "安装目录不安全",
        hint: "目标版本目录是一个符号链接,请先手动清理该目录。",
        retryable: false,
      };
    case "no-previous-version":
      return {
        title: "没有可回滚的版本",
        hint: "该扩展只有一个版本被安装过,回滚栈是空的。",
        retryable: false,
      };
    case "invalid-id":
      return { title: "扩展 id 不合法", hint: "刷新索引后重试。", retryable: true };
    case "invalid-registry":
      return {
        title: "索引不可用",
        hint: "没有配置任何索引源,或所有源都拉不到且没有缓存。检查 sources.json / 环境变量。",
        retryable: true,
      };
    case "invalid-descriptor":
      return {
        title: "扩展描述不合法",
        hint: "该条目的 manifest 没有通过校验,联系源维护者。",
        retryable: false,
      };
    default:
      return { title: "操作失败", hint: info.detail || "未知错误。", retryable: true };
  }
}
