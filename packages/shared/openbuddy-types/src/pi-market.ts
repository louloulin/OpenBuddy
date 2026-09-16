/**
 * pi-market.ts — Pi 扩展市场的 **main ↔ renderer 线契约**。
 *
 * 为什么单独抽一份:这套形状过去被手写了三遍 ——
 *   - main(生产者):`electron/main/agent/pi-market-bridge.ts`
 *   - renderer IPC wrapper:`src/lib/pi-market/pi-market-client.ts`
 *   - UI 消费方:`@openbuddy/ui-mcp` 的市场区块
 *
 * 三份定义已经漂移:wrapper 把 install 的返回值写成 `{ ok, lock }`,而 bridge
 * 返回的是 `PiMarketInstallResult`;audit 的字段一边叫 `entries`(bridge)一边叫
 * `events`(wrapper)。因为 R18 之后一直没有 UI 消费这些 wrapper,这个错在
 * 类型检查里活了很久,R32 接 UI 时才暴露 —— 如果 UI 直接信任 wrapper 的 `ok`,
 * 每次安装都会读到 `undefined`。
 *
 * 约定:这里只放**跨进程可传的纯数据**。归一化后的完整
 * `openbuddy.plugin.v1` manifest 由 `@openbuddy/plugin-host` 定义,本文件只用
 * `PiMarketManifestView` 描述渲染端真正会读的那几个字段(避免 shared-types
 * 反向依赖 main 侧包)。
 */

export type PiMarketKind = "plugin" | "skill" | "extension" | "mcp" | "theme";

export type PiMarketCapabilityRisk = "low" | "medium" | "high";

export interface PiMarketCapability {
  id: string;
  label?: string;
  risk?: PiMarketCapabilityRisk;
  detail?: string;
}

/** 渲染端读得到的 manifest 面;完整 schema 见 plugin-host。 */
export interface PiMarketManifestView {
  readonly schema?: string;
  readonly id?: string;
  readonly version?: string;
}

/** 市场列表里的一条(归一化后的展示形态)。 */
export interface PiMarketEntryView {
  id: string;
  name: string;
  publisher: string;
  description: string;
  version: string;
  versions: readonly string[];
  kinds: readonly PiMarketKind[];
  capabilities: readonly PiMarketCapability[];
  manifest: PiMarketManifestView;
  installedVersion?: string;
  updateAvailable?: boolean;
  incompatible?: boolean;
  dependencies?: readonly string[];
  packageName?: string;
  homepage?: string;
  updatedAt?: string;
  installedBytes?: number;
  /**
   * R32 — 这条条目最终由哪个索引源提供(权重最高者胜)。
   * 传统本地 `registry.json` 提供时是 `"local"`。
   */
  sourceId?: string;
  /** R32 — 同一 id 还被哪些(权重更低的)源提供,UI 用它标注「亦有镜像」。 */
  alsoOfferedBy?: readonly string[];
}

export interface PiMarketInstallResult {
  id: string;
  version: string;
  path: string;
  previousVersion?: string;
  /** false = 已经是目标版本,未发生变更(upgrade 的常见结果)。 */
  changed: boolean;
  installedAt: string;
  capabilities: readonly string[];
}

export interface PiMarketInstallOptions {
  /** 高风险能力需要显式同意(InstallDialog 勾选后传入)。 */
  allowHighRisk?: boolean;
  /** 已存在的版本目录被改写 / integrity 不匹配时,强制重新物化。 */
  force?: boolean;
}

export interface PiMarketLockEntry {
  version: string;
  path: string;
  installedAt: string;
  /** 载荷目录的 sha256(路径+内容),用于检测被外部改写。 */
  integrity: string;
  /** 回滚栈:末尾元素 = 上一个版本。 */
  history: readonly string[];
  capabilities: readonly string[];
}

export interface PiMarketLockfile {
  version: number;
  extensions: Record<string, PiMarketLockEntry>;
}

/**
 * 审计里出现的动作。
 *
 * `uninstall` 是 R33 补的:在此之前装了 Pi 扩展**没有任何卸载入口** ——
 * 审计里也不会有卸载记录,于是"装过又删了"在本地也查不出来。
 */
export type PiMarketAction = "install" | "upgrade" | "rollback" | "uninstall" | "refresh";

export interface PiMarketAuditEntry {
  id: string;
  at: string;
  action: PiMarketAction;
  extensionId: string;
  version?: string;
  from?: string;
  outcome: "success" | "failure";
  reason?: string;
}

export interface PiMarketUninstallResult {
  id: string;
  /** 卸载前处于激活状态的版本;lockfile 里没有记录时为 `undefined`。 */
  version?: string;
  /** 从磁盘上真正删掉的版本目录(降序无关,按目录名排序)。 */
  removedVersions: readonly string[];
  /** 被删除的扩展目录(`<root>/<id>`)。 */
  removedPath: string;
  at: string;
  /**
   * `keepPayload: true` 时保留版本目录、只摘掉 lockfile 里的激活记录
   * (用于"停用但想留着回滚"的场景)。此时 `removedVersions` 为空。
   */
  payloadKept: boolean;
}

/**
 * R32 — 一个索引源。权重大的先赢(默认 0);`trusted` 只用于 UI 标注,
 * **不做安全判定**(安全性来自 manifest 校验 + 高风险能力显式同意)。
 */
export interface PiMarketRegistrySource {
  id: string;
  url: string;
  label?: string;
  weight?: number;
  trusted?: boolean;
  /** 单源超时(ms),缺省 8000。多源下必须有,否则一个卡死的源会拖住整次刷新。 */
  timeoutMs?: number;
}

/**
 * 一次读取 / 刷新中某个源的结果。
 *
 * `fresh` = 本次真的拉到了;`cached` = 拉取失败(或未配置网络)但用了上次成功的缓存;
 * `failed` = 拉取失败且没有缓存;`skipped` = 该源被显式跳过(例如本地索引优先)。
 */
export type PiMarketSourceState = "fresh" | "cached" | "failed" | "skipped";

export interface PiMarketSourceStatus {
  id: string;
  label?: string;
  url?: string;
  weight: number;
  trusted?: boolean;
  state: PiMarketSourceState;
  entryCount: number;
  /** 缓存/拉取的时间戳(ISO)。 */
  fetchedAt?: string;
  /** 失败原因(仅 state=failed/cached 时有值)。 */
  error?: string;
}

/** `refreshRegistry()` 的返回值(旧字段 count/updatedAt/source 保持不变)。 */
export interface PiMarketRefreshReport {
  count: number;
  updatedAt: string;
  source: "remote" | "local";
  /** 每个源的明细;未配置多源时不出现。 */
  sources?: readonly PiMarketSourceStatus[];
  /**
   * 本次**没有拿到新鲜数据**的源(`cached` + `failed`,不只是 `failed`)——
   * 缓存能用不阻断刷新,但用户该知道「这些源是旧的」,所以两者都进这里由 UI 提示。
   */
  failed?: readonly PiMarketSourceStatus[];
}

// ---------------------------------------------------------------------------
// R32 — 错误码(线契约的一部分)
// ---------------------------------------------------------------------------

/**
 * 桥接层可能抛出的错误码。
 *
 * 为什么错误码必须进线契约:Electron 的 `ipcRenderer.invoke` 只把错误的
 * **message** 传回渲染进程,挂在 Error 上的自定义属性(`err.code`)会被丢掉。
 * 而 UI 需要区分三种完全不同补救动作的失败 ——
 * 「需要显式同意高风险能力」「宿主版本区间不兼容」「已安装载荷被外部改写」,
 * 所以码必须能穿过 IPC。做法是把码写进 message(`formatPiMarketError`),
 * 渲染端用 `parsePiMarketError` 取回。
 */
export type PiMarketErrorCode =
  | "invalid-id"
  | "invalid-registry"
  | "invalid-descriptor"
  | "not-found"
  | "version-not-found"
  | "payload-unavailable"
  | "payload-rejected"
  | "consent-required"
  | "incompatible"
  | "no-previous-version"
  | "corrupt-install"
  | "unsafe-target";

export const PI_MARKET_ERROR_CODES: readonly PiMarketErrorCode[] = [
  "invalid-id",
  "invalid-registry",
  "invalid-descriptor",
  "not-found",
  "version-not-found",
  "payload-unavailable",
  "payload-rejected",
  "consent-required",
  "incompatible",
  "no-previous-version",
  "corrupt-install",
  "unsafe-target",
];

export interface PiMarketErrorInfo {
  /** 已知码;无法识别时为 `unknown`。 */
  code: PiMarketErrorCode | "unknown";
  /** 去掉码前缀后的文案,可以直接展示给用户。 */
  detail: string;
}

const PI_MARKET_ERROR_RE = /^pi-market\[([a-z-]+)\]:\s*/;
const PI_MARKET_ERROR_CODE_SET = new Set<string>(PI_MARKET_ERROR_CODES);

/** 把一个错误码 + 文案序列化成可穿过 IPC 的单条 message。 */
export function formatPiMarketError(code: PiMarketErrorCode, detail: string): string {
  return `pi-market[${code}]: ${detail}`;
}

/**
 * `formatPiMarketError` 的逆运算。
 *
 * 不认识的前缀(例如宿主自定义的中间层报错)不会丢信息:原样进 `detail`,
 * 只在 `code` 上回落 `unknown` —— UI 对未知码的策略是「展示原始文案 + 允许重试」。
 */
export function parsePiMarketError(message: string): PiMarketErrorInfo {
  const text = typeof message === "string" ? message : String(message ?? "");
  const matched = PI_MARKET_ERROR_RE.exec(text);
  if (!matched) return { code: "unknown", detail: text.trim() };
  const code = matched[1];
  return {
    code: PI_MARKET_ERROR_CODE_SET.has(code) ? (code as PiMarketErrorCode) : "unknown",
    detail: text.slice(matched[0].length).trim(),
  };
}
