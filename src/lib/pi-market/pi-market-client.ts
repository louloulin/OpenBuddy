/**
 * @openbuddy/pi-market-client — Pi 扩展市场的 renderer 侧 IPC wrapper。
 *
 * R18 / Phase D — Expert Marketplace Bridge(OpenBuddy 相对 WorkBuddy 的
 * 开源差异化能力之一:任何 Pi 扩展都能从市场装进来,带版本化、原子提交与回滚)。
 *
 * R32 修复(这个 bug 之前一直没被类型检查抓到,因为 R18 之后没有 UI 消费)
 * ----------------------------------------------------------------------
 * 本文件此前手写了一份和 main 侧漂移的类型:
 *   - install / upgrade / rollback 写成 `{ ok: true, lock }`,而 bridge 实际返回
 *     `PiMarketInstallResult` → **每次安装 UI 都会读到 `undefined.ok`**;
 *   - audit 一边叫 `events`(wrapper)一边叫 `entries`(bridge);
 *   - 版本条目类型缺 `manifest` / `installedVersion` 等 UI 真正要读的字段。
 *
 * 现在类型全部从 `@openbuddy/shared-types/pi-market` re-export —— 那是 main 与
 * renderer 共用的**唯一**线契约,漂移会直接变成编译错误。
 *
 * 错误语义:`invoke()` 在失败时 **reject**(bridge 的 `PiMarketBridgeError`),
 * 不是返回 `{ ok: false }`。Electron 只透传 message,所以错误码被编码在 message
 * 里,用 `piMarketErrorInfo()` 取回。
 */
import { invoke } from "@/lib/platform/electron-api";
import { parsePiMarketError, type PiMarketErrorInfo } from "@openbuddy/shared-types";

export type {
  PiMarketAction,
  PiMarketAuditEntry,
  PiMarketCapability,
  PiMarketCapabilityRisk,
  PiMarketEntryView,
  PiMarketErrorCode,
  PiMarketErrorInfo,
  PiMarketInstallOptions,
  PiMarketInstallResult,
  PiMarketKind,
  PiMarketLockEntry,
  PiMarketLockfile,
  PiMarketManifestView,
  PiMarketRefreshReport,
  PiMarketRegistrySource,
  PiMarketSourceProbeResult,
  PiMarketSourceState,
  PiMarketSourceStatus,
  PiMarketSourcesView,
  PiMarketUninstallResult,
} from "@openbuddy/shared-types";

import type {
  PiMarketAuditEntry,
  PiMarketEntryView,
  PiMarketInstallResult,
  PiMarketLockfile,
  PiMarketRefreshReport,
  PiMarketRegistrySource,
  PiMarketSourceProbeResult,
  PiMarketSourcesView,
  PiMarketUninstallResult,
} from "@openbuddy/shared-types";

/** channel 名与 main 侧 `PI_MARKET_IPC_CHANNELS` 一一对应(单一来源在 main)。 */
export const PI_MARKET_CHANNELS = {
  list: "agent:pi-market-list",
  refresh: "agent:pi-market-refresh",
  install: "agent:pi-market-install",
  upgrade: "agent:pi-market-upgrade",
  rollback: "agent:pi-market-rollback",
  uninstall: "agent:pi-market-uninstall",
  lockfile: "agent:pi-market-lockfile",
  audit: "agent:pi-market-audit",
  // R35 —— 源管理:读 / 写 / 探活。
  sourcesGet: "agent:pi-market-sources-get",
  sourcesSet: "agent:pi-market-sources-set",
  sourceProbe: "agent:pi-market-source-probe",
} as const;

export interface PiMarketListResult {
  entries: readonly PiMarketEntryView[];
}

export interface PiMarketAuditResult {
  entries: readonly PiMarketAuditEntry[];
}

/**
 * 列出市场条目(**已按源权重合并**;查询/过滤在渲染端做 —— 市场是
 * profile 级资源,数量在千级,`MarketplaceTab` 已有过滤/排序模型)。
 */
export function listPiMarket(): Promise<PiMarketListResult> {
  return invoke(PI_MARKET_CHANNELS.list) as Promise<PiMarketListResult>;
}

/** 重新拉取所有源并写回本地合并索引;返回值带每源状态(fresh/cached/failed/skipped)。 */
export function refreshPiMarket(): Promise<PiMarketRefreshReport> {
  return invoke(PI_MARKET_CHANNELS.refresh) as Promise<PiMarketRefreshReport>;
}

export interface PiMarketInstallArgs {
  id: string;
  /** 省略 = 装索引里的推荐版本。 */
  version?: string;
  /** 高风险能力需要显式同意(InstallDialog 勾选后传入)。 */
  allowHighRisk?: boolean;
  /** 已存在的版本目录被外部改写时,强制重新物化。 */
  force?: boolean;
}

export function installPiMarket(args: PiMarketInstallArgs): Promise<PiMarketInstallResult> {
  return invoke(PI_MARKET_CHANNELS.install, args) as Promise<PiMarketInstallResult>;
}

/** 升级到索引推荐版本;已是目标版本时返回 `changed: false`(不是错误)。 */
export function upgradePiMarket(args: {
  id: string;
  allowHighRisk?: boolean;
}): Promise<PiMarketInstallResult> {
  return invoke(PI_MARKET_CHANNELS.upgrade, args) as Promise<PiMarketInstallResult>;
}

export function rollbackPiMarket(args: { id: string }): Promise<PiMarketInstallResult> {
  return invoke(PI_MARKET_CHANNELS.rollback, args) as Promise<PiMarketInstallResult>;
}

/**
 * R33 — 卸载。默认连版本目录一起删;`keepPayload: true` 只摘掉 lockfile 记录
 * (加载器跟着 lockfile 走,等价于"停用但留着回滚")。
 */
export function uninstallPiMarket(args: {
  id: string;
  keepPayload?: boolean;
}): Promise<PiMarketUninstallResult> {
  return invoke(PI_MARKET_CHANNELS.uninstall, args) as Promise<PiMarketUninstallResult>;
}

export function lockfilePiMarket(): Promise<PiMarketLockfile> {
  return invoke(PI_MARKET_CHANNELS.lockfile) as Promise<PiMarketLockfile>;
}

export function auditPiMarket(args?: { limit?: number }): Promise<PiMarketAuditResult> {
  return invoke(PI_MARKET_CHANNELS.audit, args) as Promise<PiMarketAuditResult>;
}

/**
 * R35 —— 读源清单。`file` 是可编辑的那一份,`effective` 是合并去重后的最终列表,
 * `readonlySourceIds` 标出改不动的源(环境变量 / 宿主注入)。
 */
export function getPiMarketSources(): Promise<PiMarketSourcesView> {
  return invoke(PI_MARKET_CHANNELS.sourcesGet) as Promise<PiMarketSourcesView>;
}

/**
 * R35 —— 覆盖写 `sources.json` 并**立即**替换内存里的源清单,所以调用方紧接着
 * `refreshPiMarket()` 就是按新源跑(不需要重启)。
 *
 * 失败时 reject:坏条目会被指出是第几行的哪个字段(而不是静默丢弃),
 * 用 `piMarketErrorInfo()` 取回码与明细。
 */
export function setPiMarketSources(
  sources: readonly PiMarketRegistrySource[],
): Promise<PiMarketSourcesView> {
  return invoke(PI_MARKET_CHANNELS.sourcesSet, { sources }) as Promise<PiMarketSourcesView>;
}

/**
 * R35 —— 探一个源此刻是否可达(不落盘)。给"保存前先测一下"用:
 * 地址写错时,用户不必先保存再刷新才发现。
 */
export function probePiMarketSource(
  source: PiMarketRegistrySource,
): Promise<PiMarketSourceProbeResult> {
  return invoke(PI_MARKET_CHANNELS.sourceProbe, { source }) as Promise<PiMarketSourceProbeResult>;
}

/**
 * 把 IPC 抛回来的错误解析成 `{ code, detail }`。
 *
 * 已知码(`consent-required` / `incompatible` / `corrupt-install` …)让 UI 显示
 * 对应的补救动作;未知错误回落 `unknown` + 原始文案,不吞信息。
 */
export function piMarketErrorInfo(error: unknown): PiMarketErrorInfo {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return parsePiMarketError(message);
}
