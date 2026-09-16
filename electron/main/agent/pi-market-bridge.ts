/**
 * pi-market-bridge — Pi 扩展市场桥接(main 进程,additive)。
 *
 * 背景
 * ----
 * 现有的 `pi-resources/marketplace.ts` 走「插件根目录 + profile.piExtensions
 * 镜像」的安装模型(`<agentRoot>/plugins/<name>`),面向 pi.dev / npm tarball。
 * 本模块补的是另一条**版本化安装树**:
 *
 *   <dataDir>/pi-extensions/
 *     registry.json                 本地索引(可被远端索引刷新覆盖)
 *     installed.json                lockfile:版本 + integrity + 回滚历史
 *     audit.jsonl                   追加式审计(demo 可读,机器可解析)
 *     <id>/current                  指针文件:当前激活版本(单行纯文本)
 *     <id>/<version>/               载荷目录(含 openbuddy.plugin.json)
 *     <id>/.staging-<rand>/         安装中临时目录(失败必清理)
 *
 * 设计约束
 * --------
 * 1. **additive**:不改动任何既有 IPC channel / 既有 marketplace 模块。宿主
 *    需要时通过 `registerPiMarketBridgeIpc()` 挂新 channel(默认前缀
 *    `agent:pi-market-*`),不注册也不会影响现有链路。
 * 2. **可注入**:registry 来源(本地文件 / 可选远端 URL / 注入 fetchJson)、
 *    载荷来源(内联 files / 本地目录 / 注入 fetchPayload)、时钟、宿主版本
 *    全部可注入,因此单测不需要网络、不需要 electron。
 * 3. **原子**:先 staging 再 `rename` 提交;lockfile / 指针文件都用
 *    temp + rename 写入;失败路径不留半个版本目录。进程内再用一条 promise
 *    队列把 install/upgrade/rollback 串行化,避免并发写坏 lockfile。
 * 4. **不重造 manifest 校验**:映射结果交给
 *    `@openbuddy/plugin-host` 的 `validateOpenBuddyPluginManifest`(与
 *    `pi-extensions.ts` 同一入口,避免新增子路径 alias)。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  openbuddyPluginManifestSchema,
  validateOpenBuddyPluginManifest,
  type OpenBuddyPluginManifest,
  type OpenBuddyPluginTrack,
} from "@openbuddy/plugin-host";
import type {
  PiMarketAction,
  PiMarketAuditEntry,
  PiMarketCapability,
  PiMarketCapabilityRisk,
  PiMarketInstallOptions,
  PiMarketInstallResult,
  PiMarketKind,
  PiMarketLockEntry,
  PiMarketLockfile,
  PiMarketRefreshReport,
  PiMarketRegistrySource,
  PiMarketSourceState,
  PiMarketSourceProbeResult,
  PiMarketSourceStatus,
  PiMarketSourcesView,
  PiMarketUninstallResult,
} from "@openbuddy/shared-types";
import { formatPiMarketError } from "@openbuddy/shared-types";

/**
 * R32 — 线契约集中在 `@openbuddy/shared-types`(`pi-market.ts`),main 与 renderer
 * 共用同一份定义。
 *
 * 此前两边各写一遍,已经漂移:renderer wrapper 把 install 的返回值写成
 * `{ ok, lock }`(bridge 返回 `PiMarketInstallResult`),audit 字段一边叫
 * `entries` 一边叫 `events`。因为当时没有 UI 消费,类型检查抓不到;R32 接 UI 时
 * 才发现 —— 如果 UI 直接信任 wrapper 的 `ok`,每次安装都会读到 `undefined`。
 */
export type {
  PiMarketAction,
  PiMarketAuditEntry,
  PiMarketCapability,
  PiMarketCapabilityRisk,
  PiMarketErrorCode,
  PiMarketInstallOptions,
  PiMarketInstallResult,
  PiMarketKind,
  PiMarketLockEntry,
  PiMarketLockfile,
  PiMarketRefreshReport,
  PiMarketRegistrySource,
  PiMarketSourceState,
  PiMarketSourceStatus,
  PiMarketUninstallResult,
} from "@openbuddy/shared-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 索引里的一条 Pi 扩展描述。字段全部宽松:缺省值在归一化阶段补齐。 */
export interface PiMarketRegistryEntry {
  id: string;
  /** R32 — 由合并逻辑写入:最终提供这条条目的源 id。 */
  sourceId?: string;
  /** R32 — 同 id 还被哪些(权重更低的)源提供。 */
  alsoOfferedBy?: readonly string[];
  name?: string;
  publisher?: string;
  description?: string;
  /** 推荐(最新)版本。缺省时取 versions 里的最大者。 */
  version?: string;
  versions?: readonly string[];
  kinds?: readonly PiMarketKind[];
  capabilities?: readonly PiMarketCapability[];
  packageName?: string;
  /** 兼容性区间,例如 `>=0.14.0 <0.16.0`;`openbuddy` 用于宿主兼容判定。 */
  engines?: { openbuddy?: string; pi?: string };
  dependencies?: readonly string[];
  /** 显式 manifest track(优先);缺省时由 source/inline 合成一条 pi track。 */
  tracks?: readonly OpenBuddyPluginTrack[];
  /** 合成 pi track 时的模块路径。 */
  source?: string;
  /** 合成 pi track 时的内置工厂 id。 */
  inline?: string;
  /** 内联载荷:相对路径 → 文件内容。 */
  files?: Record<string, string>;
  /** 本地目录载荷(测试与内网分发用)。 */
  payloadPath?: string;
  /** 远端载荷 URL(需要注入 fetchPayload 才能真正落盘)。 */
  payloadUrl?: string;
  homepage?: string;
  updatedAt?: string;
  installedBytes?: number;
}

export interface PiMarketRegistryFile {
  version?: number;
  updatedAt?: string;
  extensions: readonly PiMarketRegistryEntry[];
}

/** 归一化后的市场条目(供 renderer 直接消费)。 */
export interface PiMarketEntry {
  id: string;
  /** R32 — 条目最终来自哪个源(传统本地 `registry.json` 是 `"local"`)。 */
  sourceId?: string;
  /** R32 — 同 id 还被哪些(权重更低的)源提供。 */
  alsoOfferedBy?: readonly string[];
  name: string;
  publisher: string;
  description: string;
  version: string;
  versions: readonly string[];
  kinds: readonly PiMarketKind[];
  capabilities: readonly PiMarketCapability[];
  manifest: OpenBuddyPluginManifest;
  installedVersion?: string;
  updateAvailable?: boolean;
  incompatible?: boolean;
  dependencies?: readonly string[];
  packageName?: string;
  homepage?: string;
  updatedAt?: string;
  installedBytes?: number;
}

export interface PiMarketBridgeOptions {
  /** 数据目录等价物(宿主传 `app.getPath("userData")`)。 */
  dataDir: string;
  /** 可选远端索引 URL(单源简写;等价于一个 id=`default`、weight=0 的源)。 */
  registryUrl?: string;
  /**
   * R32 — 多个索引源。权重大的先赢,详见 `mergePiMarketSources`。
   * 与 registryUrl 同时给出时两者都生效(registryUrl 变成 `default` 源)。
   *
   * R35 —— 这里的源被当作**只读**(宿主注入 / 部署事实),不在 UI 里编辑。
   */
  sources?: readonly PiMarketRegistrySource[];
  /**
   * R35 —— `sources.json` 的内容(宿主启动时用 `resolvePiMarketSourcesDetailed()`
   * 读一次传进来)。这一份是**用户可编辑**的:`setSources()` 会原子写回文件并
   * 立刻替换内存里的列表,所以 UI 改完源不用重启就能刷新。
   */
  fileSources?: readonly PiMarketRegistrySource[];
  /** 注入式 JSON fetcher(测试用;缺省走 globalThis.fetch)。 */
  fetchJson?: (url: string) => Promise<unknown>;
  /** 注入式载荷物化(远端 tarball / 私有协议由宿主实现)。 */
  fetchPayload?: (
    entry: PiMarketRegistryEntry,
    version: string,
    destination: string,
  ) => Promise<void>;
  /** 宿主版本,用于 engines.openbuddy 兼容判定。 */
  hostVersion?: string;
  /** 注入时钟(测试用)。 */
  now?: () => Date;
}

export class PiMarketBridgeError extends Error {
  readonly code: PiMarketErrorCode;
  constructor(code: PiMarketErrorCode, message: string, cause?: unknown) {
    // R32 — 错误码写进 message:Electron 的 `ipcRenderer.invoke` 只透传
    // message,挂在 Error 上的 `code` 属性到不了渲染进程。渲染端用
    // `parsePiMarketError()` 取回码,再决定补救动作(同意 / 换版本 / 强制重装)。
    super(formatPiMarketError(code, message));
    this.name = "PiMarketBridgeError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface PiMarketUninstallOptions {
  /**
   * 只摘掉 lockfile 里的激活记录,保留 `<id>/<version>/` 载荷目录。
   * 加载器是跟着 lockfile 走的(`init-pi-user-extensions` 读 `installed.json`
   * 再跟 `<id>/current`),所以效果等同于"停用,但随时能再装回来"。
   */
  keepPayload?: boolean;
}

export interface PiMarketBridge {
  readonly paths: {
    root: string;
    registryFile: string;
    lockfile: string;
    auditFile: string;
    /** R32 — 每源离线缓存目录(`sources/<sourceId>.json`)。 */
    sourcesDir: string;
    /** R35 — 用户可编辑的源配置(`pi-extensions/sources.json`)。 */
    sourcesFile: string;
  };
  readRegistry(): Promise<{
    entries: PiMarketRegistryEntry[];
    source: "local" | "remote" | "empty";
    updatedAt?: string;
    /** R32 — 每个源的读取结果;未配置多源时不出现。 */
    sources?: PiMarketSourceStatus[];
  }>;
  refreshRegistry(): Promise<PiMarketRefreshReport>;
  listMarketEntries(): Promise<PiMarketEntry[]>;
  getMarketEntry(id: string): Promise<PiMarketEntry | undefined>;
  installPiExtension(
    id: string,
    version?: string,
    options?: PiMarketInstallOptions,
  ): Promise<PiMarketInstallResult>;
  upgradePiExtension(id: string, options?: PiMarketInstallOptions): Promise<PiMarketInstallResult>;
  rollbackPiExtension(id: string, options?: PiMarketInstallOptions): Promise<PiMarketInstallResult>;
  /**
   * R33 — 卸载。在此之前装了 Pi 扩展没有任何卸载入口(审计里也查不出"装过又删了")。
   * 默认连版本目录一起删;`keepPayload: true` 只摘掉 lockfile 记录(停用但留着回滚)。
   */
  uninstallPiExtension(
    id: string,
    options?: PiMarketUninstallOptions,
  ): Promise<PiMarketUninstallResult>;
  /**
   * R35 —— 当前源清单。`file` 是可编辑的那一份,`effective` 是合并后的最终列表,
   * `readonlySourceIds` 标出改不动的源(环境变量 / 宿主注入)。
   */
  getSources(): PiMarketSourcesView;
  /**
   * R35 —— 原子写回 `sources.json` 并**立即**替换内存里的源列表,所以紧接着
   * 调 `refreshRegistry()` 就是按新源跑。写入前做严格校验(坏 URL / 重复 id
   * 直接报错,而不是像读路径那样静默跳过)—— 用户正在编辑的东西必须给回执。
   */
  setSources(sources: readonly PiMarketRegistrySource[]): Promise<PiMarketSourcesView>;
  /**
   * R35 —— 探一个源此刻是否可达(不落盘)。给"保存前先测一下"用:
   * 源地址写错时,用户不必先保存再刷新才发现。
   */
  probeSource(source: PiMarketRegistrySource): Promise<PiMarketSourceProbeResult>;
  readLockfile(): Promise<PiMarketLockfile>;
  readAuditTrail(limit?: number): Promise<PiMarketAuditEntry[]>;
}

// ---------------------------------------------------------------------------
// semver 子集(与 renderer 侧 marketplace-model 保持同一套语义)
// ---------------------------------------------------------------------------

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly (string | number)[];
}

const SEMVER_RE = /^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parsePiSemver(input: string | undefined | null): SemverParts | null {
  if (typeof input !== "string") return null;
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  const prerelease: (string | number)[] = [];
  if (match[4]) {
    for (const segment of match[4].split(".")) {
      prerelease.push(/^\d+$/.test(segment) ? Number(segment) : segment);
    }
  }
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease,
  };
}

function comparePrerelease(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** 与 renderer 侧 `compareSemver` 同语义:返回 -1/0/1,非法返回 null。 */
export function comparePiSemver(
  a: string | undefined | null,
  b: string | undefined | null,
): number | null {
  const left = parsePiSemver(a);
  const right = parsePiSemver(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const max = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < max; index += 1) {
    const l = left.prerelease[index];
    const r = right.prerelease[index];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const verdict = comparePrerelease(l, r);
    if (verdict !== 0) return verdict;
  }
  return 0;
}

function compareWith(version: string, op: string, target: SemverParts): boolean {
  const left = parsePiSemver(version);
  if (!left) return false;
  const right = target;
  const cmp =
    left.major !== right.major
      ? left.major < right.major
        ? -1
        : 1
      : left.minor !== right.minor
        ? left.minor < right.minor
          ? -1
          : 1
        : left.patch !== right.patch
          ? left.patch < right.patch
            ? -1
            : 1
          : 0;
  switch (op) {
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case "<":
      return cmp < 0;
    case "=":
      return cmp === 0;
    default:
      return false;
  }
}

function satisfiesComparator(version: string, comparator: string): boolean {
  const trimmed = comparator.trim();
  if (!trimmed || trimmed === "*" || trimmed === "x") return true;
  const caret = /^\^(.+)$/.exec(trimmed);
  if (caret) {
    const base = parsePiSemver(caret[1]);
    if (!base) return false;
    const cmp = comparePiSemver(version, caret[1]);
    if (cmp === null) return false;
    if (base.major > 0) return cmp >= 0 && (parsePiSemver(version)?.major ?? -1) === base.major;
    if (base.minor > 0) {
      const parts = parsePiSemver(version);
      return cmp >= 0 && parts?.major === 0 && parts.minor === base.minor;
    }
    const parts = parsePiSemver(version);
    return cmp >= 0 && parts?.major === 0 && parts.minor === 0 && parts.patch === base.patch;
  }
  const tilde = /^~(.+)$/.exec(trimmed);
  if (tilde) {
    const base = parsePiSemver(tilde[1]);
    const parts = parsePiSemver(version);
    if (!base || !parts) return false;
    const cmp = comparePiSemver(version, tilde[1]);
    return cmp !== null && cmp >= 0 && parts.major === base.major && parts.minor === base.minor;
  }
  const op = /^(>=|<=|>|<|=)\s*(.+)$/.exec(trimmed);
  if (op) {
    const target = parsePiSemver(op[2]);
    if (!target) return false;
    return compareWith(version, op[1], target);
  }
  const exact = parsePiSemver(trimmed);
  if (!exact) return false;
  return comparePiSemver(version, trimmed) === 0;
}

/** 极简区间匹配:`||` 分隔的析取,组内空格分隔的合取,支持 `^ ~ >= <= > < = *`。 */
export function satisfiesPiRange(version: string | undefined, range: string | undefined): boolean {
  if (!range || !range.trim()) return true;
  if (!version) return false;
  return range.split("||").some((group) =>
    group
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .every((comparator) => satisfiesComparator(version, comparator)),
  );
}

function highestVersion(versions: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const candidate of versions) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const verdict = comparePiSemver(candidate, best);
    if (verdict !== null && verdict > 0) best = candidate;
  }
  return best;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** 校验扩展 id:禁止路径分隔符 / `.` / 空串,避免越权写盘。 */
export function safePiExtensionId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id || id === "." || id === ".." || !ID_RE.test(id) || id.includes("..")) {
    throw new PiMarketBridgeError("invalid-id", `invalid extension id: ${JSON.stringify(value)}`);
  }
  return id;
}

function safeRelativePath(value: string): string {
  const candidate = value.replace(/\\/g, "/").trim();
  if (
    !candidate ||
    isAbsolute(candidate) ||
    candidate.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new PiMarketBridgeError("unsafe-target", `unsafe payload path: ${JSON.stringify(value)}`);
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  return lstat(path)
    .then(() => true)
    .catch(() => false);
}

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** temp + rename 原子写(与 pi-resources/shared.writeJson 同语义)。 */
async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await rename(temporary, file);
}

async function writeTextAtomic(file: string, content: string, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, file);
}

/** 目录指纹:排序后的相对路径 + 内容 sha256(确定性,便于 integrity 比对)。 */
export async function hashPayloadDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      const full = join(current, entry.name);
      const rel = relative(root, full).split("\\").join("/");
      if (entry.isDirectory()) {
        hash.update(`dir:${rel}\n`);
        await walk(full);
      } else if (entry.isSymbolicLink()) {
        throw new PiMarketBridgeError("unsafe-target", `payload contains a symlink: ${rel}`);
      } else if (entry.isFile()) {
        hash.update(`file:${rel}\n`);
        hash.update(await readFile(full));
        hash.update("\n");
      }
    }
  }
  await walk(root);
  return hash.digest("hex");
}

const DEFAULT_KINDS: readonly PiMarketKind[] = ["extension"];
const VALID_KINDS: readonly PiMarketKind[] = ["plugin", "skill", "extension", "mcp", "theme"];

function normalizeKinds(value: unknown): PiMarketKind[] {
  if (!Array.isArray(value)) return [...DEFAULT_KINDS];
  const kinds = value
    .map((item) => String(item))
    .filter((item): item is PiMarketKind => (VALID_KINDS as readonly string[]).includes(item));
  return kinds.length > 0 ? [...new Set(kinds)] : [...DEFAULT_KINDS];
}

function normalizeCapabilities(value: unknown): PiMarketCapability[] {
  if (!Array.isArray(value)) return [];
  const out: PiMarketCapability[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push({ id: item });
      continue;
    }
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    const risk =
      item.risk === "high" || item.risk === "medium" || item.risk === "low" ? item.risk : undefined;
    out.push({
      id: item.id,
      ...(typeof item.label === "string" ? { label: item.label } : {}),
      ...(risk ? { risk } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
    });
  }
  return out;
}

export function hasHighRiskCapability(capabilities: readonly PiMarketCapability[]): boolean {
  return capabilities.some((capability) => capability.risk === "high");
}

// ---------------------------------------------------------------------------
// manifest 映射
// ---------------------------------------------------------------------------

/**
 * Pi 扩展描述 → `openbuddy.plugin.v1` manifest。
 *
 * 复用既有校验器(不重造规则)。缺省 track 采用 `pi-extension:<id>` 方案:
 * 宿主在解析 pi track 时通过 `resolvePiExtensionSource(id)` 把该 scheme 映射到
 * lockfile 里的安装目录,因此这里不需要猜模块路径。
 */
export function mapPiExtensionToOpenBuddyManifest(
  entry: PiMarketRegistryEntry,
  version?: string,
): OpenBuddyPluginManifest {
  if (!isRecord(entry))
    throw new PiMarketBridgeError("invalid-descriptor", "registry entry must be an object");
  const id = safePiExtensionId(entry.id);
  const tracks: readonly OpenBuddyPluginTrack[] =
    Array.isArray(entry.tracks) && entry.tracks.length > 0
      ? entry.tracks
      : [
          (() => {
            if (typeof entry.inline === "string" && entry.inline.trim())
              return { kind: "pi" as const, inline: entry.inline };
            const source =
              typeof entry.source === "string" && entry.source.trim()
                ? entry.source
                : `pi-extension:${id}`;
            return { kind: "pi" as const, source };
          })(),
        ];
  const candidate = {
    schema: openbuddyPluginManifestSchema,
    id,
    ...(typeof entry.packageName === "string" ? { packageName: entry.packageName } : {}),
    ...((version ?? entry.version) ? { version: version ?? entry.version } : {}),
    tracks,
    ...(typeof entry.description === "string" ? { description: entry.description } : {}),
  };
  try {
    return validateOpenBuddyPluginManifest(candidate);
  } catch (error) {
    throw new PiMarketBridgeError(
      "invalid-descriptor",
      error instanceof Error ? error.message : `invalid manifest for ${id}`,
      error,
    );
  }
}

/** `pi-extension:<id>` scheme 的解析器;宿主拿到安装目录后再交给 pi loader。 */
export function isPiExtensionScheme(source: string): boolean {
  return source.startsWith("pi-extension:");
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// R32 — 多源 registry:归一化 / 合并 / 解析
// ---------------------------------------------------------------------------

/** 用户可编辑的多源配置(数据目录内 `pi-extensions/sources.json`)。 */
export const PI_MARKET_SOURCES_FILE = "sources.json";
/** 环境变量形式的源(JSON 数组,或单个 URL)。 */
export const PI_MARKET_SOURCES_ENV = "OPENBUDDY_PI_MARKET_SOURCES";
/** 兼容配置:单个 URL(等价于一个 id=`default` 的源)。 */
export const PI_MARKET_REGISTRY_URL_ENV = "OPENBUDDY_PI_MARKET_REGISTRY_URL";
export const PI_MARKET_DEFAULT_TIMEOUT_MS = 8000;

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** 缺省权重 0;非有限数一律当 0(别让 `NaN` 悄悄改变优先级)。 */
export function sourceWeight(source: PiMarketRegistrySource): number {
  const weight = source.weight;
  return typeof weight === "number" && Number.isFinite(weight) ? weight : 0;
}

/** 派生 id 时顺手去掉的常见索引文件后缀(`primary.json` → `primary`)。 */
const SOURCE_URL_EXT_RE = /\.(json|json5|ya?ml|txt)$/i;

/**
 * 把 URL 的 path 压成 id 里可读的一段:`/pi/stable.json` → `pi-stable`。
 *
 * 为什么 id 必须带 path(而不是只有 host):**同一个 host 上放多个索引是常态**
 * —— `https://mirror.corp/pi/stable.json` 与 `.../nightly.json` 是两个源。
 * 只按 host 派生会让它们撞成一个 id,读路径的去重(同 id 只保留第一条)于是
 * **静默丢掉第二个源** —— 用户写了两个源却只有一个生效,而且没有任何提示。
 */
function slugifySourcePath(pathname: string): string {
  return pathname
    .replace(/^[/\\]+|[/\\]+$/g, "")
    .replace(SOURCE_URL_EXT_RE, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * 用户没写 id 时从 URL 里凑一个稳定的标识。
 *
 * 稳定性是硬要求:id 同时是**离线缓存的文件名**(`sources/<id>.json`)。
 * 用序号做兜底会让"调整一下源的顺序"把缓存全部指错地方。
 */
function deriveSourceId(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/[^a-z0-9.-]/gi, "").toLowerCase();
    if (host) {
      const slug = slugifySourcePath(parsed.pathname);
      return slug ? `${host}-${slug}` : host;
    }
  } catch {
    // 非 URL(本地绝对路径等):用路径本身派生,同样避免两个本地索引撞 id。
    const slug = slugifySourcePath(url);
    if (slug) return `local-${slug}`;
  }
  return `source-${index + 1}`;
}

/**
 * 归一化一份源清单(数组,或 `{ sources: [...] }`)。
 *
 * 坏条目**跳过而不是抛错**:源是用户可编辑的配置,写错一行不该让整个市场
 * 打不开。同 id 只保留第一条(谁优先由调用方的拼接顺序决定)。
 */
export function normalizeRegistrySources(value: unknown): PiMarketRegistrySource[] {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.sources)
      ? value.sources
      : [];
  const out: PiMarketRegistrySource[] = [];
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    if (!isRecord(item)) return;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) return;
    const id =
      typeof item.id === "string" && SOURCE_ID_RE.test(item.id.trim())
        ? item.id.trim()
        : deriveSourceId(url, index);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      url,
      ...(typeof item.label === "string" && item.label.trim() ? { label: item.label.trim() } : {}),
      ...(typeof item.weight === "number" && Number.isFinite(item.weight)
        ? { weight: item.weight }
        : {}),
      ...(item.trusted === true ? { trusted: true } : {}),
      ...(typeof item.timeoutMs === "number" && item.timeoutMs > 0
        ? { timeoutMs: item.timeoutMs }
        : {}),
    });
  });
  return out;
}

/**
 * 把多个源的条目合并成一份列表(确定性,可单测)。
 *
 * 规则刻意做得很窄,因为"聪明的字段级合并"是不可预测的:
 *
 *   1. 权重从大到小处理;同权重保持**声明顺序**(数组 sort 是稳定的)。
 *   2. 同一个 id **只有第一个源赢**,winner 的字段原样保留 —— 不做字段合并。
 *      两个源对同一插件给出不同载荷/能力声明时,混合出来的东西没人能复现。
 *   3. 低权重源里**独有的 id** 照常收录(镜像可以补充官方源没有的插件),
 *      只在 winner 上记 `alsoOfferedBy`,UI 用来标注「亦有镜像」。
 *
 * 「官方源掉线时镜像接管」不需要额外规则:官方源没返回条目,镜像自然成为 winner。
 */
export function mergePiMarketSources(
  groups: readonly { source: PiMarketRegistrySource; entries: readonly PiMarketRegistryEntry[] }[],
): PiMarketRegistryEntry[] {
  const ordered = [...groups].sort((a, b) => sourceWeight(b.source) - sourceWeight(a.source));
  const order: string[] = [];
  const merged = new Map<string, { entry: PiMarketRegistryEntry; also: string[] }>();
  for (const { source, entries } of ordered) {
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
      const existing = merged.get(entry.id);
      if (!existing) {
        merged.set(entry.id, { entry: { ...entry, sourceId: source.id }, also: [] });
        order.push(entry.id);
        continue;
      }
      if (existing.entry.sourceId !== source.id && !existing.also.includes(source.id)) {
        existing.also.push(source.id);
      }
    }
  }
  return order.map((id) => {
    const { entry, also } = merged.get(id)!;
    return also.length > 0 ? { ...entry, alsoOfferedBy: also } : entry;
  });
}

/** `resolvePiMarketSourcesDetailed()` 的三份结果。 */
export interface PiMarketResolvedSources {
  /**
   * 宿主注入 + registryUrl + 环境变量。这些是**部署事实** —— UI 里改不动,
   * 改了文件也不会生效,所以单独一份而不是混进可编辑列表。
   */
  readonly: PiMarketRegistrySource[];
  /** `sources.json` 的内容(用户可编辑的那一份)。 */
  file: PiMarketRegistrySource[];
  /** 合并去重(同 id 先出现者赢)+ 按权重从大到小排序后的最终列表。 */
  merged: PiMarketRegistrySource[];
}

/**
 * 汇总所有配置来源,得到最终的源清单(分读写两半)。
 *
 * 优先级(同 id 时先出现的赢):**显式 options.sources > registryUrl > 环境变量
 * > `sources.json`**。最终按权重从大到小排序。
 *
 * 为什么默认不内置任何远端源:OpenBuddy 的产品立场是本地优先 / 数据自决
 * (见 `docs/PLUGIN_MARKETPLACE.md`)—— **没配置 = 不联网**;要多个源就显式写下来。
 *
 * R35 —— 返回**分开的两份**(`readonly` / `file`)而不只是一份合并结果:源管理 UI
 * 需要知道"哪些能改"。把三份拼成一份再让 UI 去猜哪条来自环境变量,是猜不准的。
 */
export async function resolvePiMarketSourcesDetailed(options: {
  dataDir: string;
  sources?: readonly PiMarketRegistrySource[];
  registryUrl?: string;
  env?: Record<string, string | undefined>;
  /** 注入读取(测试用);返回 `undefined` 表示文件不存在。 */
  readSourceFile?: (path: string) => Promise<string | undefined>;
}): Promise<PiMarketResolvedSources> {
  const readonly: PiMarketRegistrySource[] = [];
  const pushReadonly = (value: unknown): void => {
    for (const source of normalizeRegistrySources(value)) {
      if (readonly.some((existing) => existing.id === source.id)) continue;
      readonly.push(source);
    }
  };

  pushReadonly(options.sources);
  if (options.registryUrl && options.registryUrl.trim()) {
    pushReadonly([{ id: "default", url: options.registryUrl.trim() }]);
  }

  const env = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const envRaw = env[PI_MARKET_SOURCES_ENV];
  if (typeof envRaw === "string" && envRaw.trim()) {
    const text = envRaw.trim();
    try {
      pushReadonly(JSON.parse(text));
    } catch {
      // 不是 JSON:当成"单个 URL"(手写环境变量时最省事的形式)。
      pushReadonly([{ id: "env", url: text }]);
    }
  }
  const envUrl = env[PI_MARKET_REGISTRY_URL_ENV];
  // 与 `options.registryUrl` 用同一个 id(`default`):它们语义相同,同 id 去重
  // 保证"显式配置赢" —— 否则同一个 URL 会因为写法不同出现两次。
  if (typeof envUrl === "string" && envUrl.trim()) pushReadonly([{ id: "default", url: envUrl.trim() }]);

  const file = join(resolve(options.dataDir), "pi-extensions", PI_MARKET_SOURCES_FILE);
  const readFileText =
    options.readSourceFile ??
    (async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return undefined;
      }
    });
  let fileSources: PiMarketRegistrySource[] = [];
  const raw = await readFileText(file);
  if (typeof raw === "string" && raw.trim()) {
    try {
      fileSources = normalizeRegistrySources(JSON.parse(raw));
    } catch {
      // 配置文件语法错误时忽略它,而不是让整个市场打不开。
    }
  }

  return { readonly, file: fileSources, merged: mergeSourceLists(readonly, fileSources) };
}

/** 向后兼容的薄封装:只要合并后的那一份。 */
export async function resolvePiMarketSources(options: {
  dataDir: string;
  sources?: readonly PiMarketRegistrySource[];
  registryUrl?: string;
  env?: Record<string, string | undefined>;
  readSourceFile?: (path: string) => Promise<string | undefined>;
}): Promise<PiMarketRegistrySource[]> {
  return (await resolvePiMarketSourcesDetailed(options)).merged;
}

/**
 * 合并「只读源」与「文件源」:同 id 时只读源赢(部署优先),最后按权重降序。
 *
 * 排序用 `Array.prototype.sort`,它在 V8 上是稳定的 —— 同权重的源保持声明顺序,
 * 否则"我把权重都设成 0"会让优先级变成一个不可预测的谜。
 */
export function mergeSourceLists(
  readonly: readonly PiMarketRegistrySource[],
  file: readonly PiMarketRegistrySource[],
): PiMarketRegistrySource[] {
  const out: PiMarketRegistrySource[] = [];
  for (const list of [readonly, file]) {
    for (const source of list) {
      if (out.some((existing) => existing.id === source.id)) continue;
      out.push(source);
    }
  }
  return out.sort((a, b) => sourceWeight(b) - sourceWeight(a));
}

/**
 * 写入前的**严格**校验 —— 与读路径刻意相反。
 *
 * 读 `sources.json` 时坏条目静默跳过(用户手写 JSON 写错一行不该让市场打不开);
 * 写的时候必须报错并指出位置,因为用户正在编辑,需要回执才能改对。静默丢弃
 * 会让"我明明加了这个源"变成一个查不出来的谜。
 */
export function validateRegistrySourcesForWrite(value: unknown): PiMarketRegistrySource[] {
  if (!Array.isArray(value)) {
    throw new PiMarketBridgeError("invalid-registry", "sources must be an array");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `sources[${index}]`;
    if (!isRecord(item)) throw new PiMarketBridgeError("invalid-registry", `${label} must be an object`);
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) throw new PiMarketBridgeError("invalid-registry", `${label}.url is required`);
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    if (rawId && !SOURCE_ID_RE.test(rawId)) {
      throw new PiMarketBridgeError("invalid-registry", `${label}.id is invalid (letters, digits, . _ -)`);
    }
    const id = rawId || deriveSourceId(url, index);
    if (seen.has(id)) throw new PiMarketBridgeError("invalid-registry", `duplicate source id: ${id}`);
    seen.add(id);
    const weight = item.weight;
    if (weight !== undefined && weight !== null && (typeof weight !== "number" || !Number.isFinite(weight))) {
      throw new PiMarketBridgeError("invalid-registry", `${label}.weight must be a finite number`);
    }
    const timeoutMs = item.timeoutMs;
    if (
      timeoutMs !== undefined &&
      timeoutMs !== null &&
      (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    ) {
      throw new PiMarketBridgeError("invalid-registry", `${label}.timeoutMs must be a positive number`);
    }
    const label_ = typeof item.label === "string" ? item.label.trim() : "";
    return {
      id,
      url,
      ...(label_ ? { label: label_ } : {}),
      ...(typeof weight === "number" ? { weight } : {}),
      ...(item.trusted === true ? { trusted: true } : {}),
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    };
  });
}

/** 给 fetch 套一层超时:多源下不能让一个卡死的源拖住整次刷新。 */
async function withTimeout<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPiMarketBridge(options: PiMarketBridgeOptions): PiMarketBridge {
  if (!options || typeof options.dataDir !== "string" || !options.dataDir.trim()) {
    throw new PiMarketBridgeError("invalid-registry", "dataDir is required");
  }
  const root = join(resolve(options.dataDir), "pi-extensions");
  const registryFile = join(root, "registry.json");
  const lockfilePath = join(root, "installed.json");
  const auditFile = join(root, "audit.jsonl");
  // R32 — 每个源一份离线缓存(`sources/<sourceId>.json`)。不挤进 registry.json:
  // 后者是"刷新后的合并视图"(可能被内网直接拷进来),缓存是"某个源上次成功
  // 返回的原始内容" —— 语义不同,混在一起就分不清"这条数据来自哪个源、什么时候"。
  const sourcesDir = join(root, "sources");
  const now = options.now ?? (() => new Date());

  const sourcesFile = join(root, PI_MARKET_SOURCES_FILE);
  // 只读源 = 宿主注入 / registryUrl(部署事实,UI 里改不动)。
  const readonlySources: PiMarketRegistrySource[] = normalizeRegistrySources([
    ...(options.sources ?? []),
    ...(options.registryUrl && options.registryUrl.trim()
      ? [{ id: "default", url: options.registryUrl.trim() }]
      : []),
  ]).sort((a, b) => sourceWeight(b) - sourceWeight(a));
  // 文件源 = 用户在 UI 里能编辑的那一份。R35 之前它只是构造时读一次的快照;
  // 现在 `setSources()` 会原子写回并就地替换 —— 改完源不用重启就能刷新。
  // 仍然不在每次 list 时读盘:避免"读到一半文件被改"的不确定性。
  let fileSources: PiMarketRegistrySource[] = normalizeRegistrySources(options.fileSources ?? []);
  let sources: PiMarketRegistrySource[] = mergeSourceLists(readonlySources, fileSources);
  /** 上一次探源的结果,给源管理 UI 显示每源状态;`setSources()` 后清空(源变了,旧状态无意义)。 */
  let lastStatuses: PiMarketSourceStatus[] = [];

  // 进程内串行化:install/upgrade/rollback 互斥,避免并发写坏 lockfile。
  let queue: Promise<unknown> = Promise.resolve();
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  }

  async function readLockfile(): Promise<PiMarketLockfile> {
    const parsed = await readJsonFile<PiMarketLockfile>(lockfilePath);
    if (!parsed || !isRecord(parsed.extensions)) return { version: 1, extensions: {} };
    const extensions: Record<string, PiMarketLockEntry> = {};
    for (const [key, value] of Object.entries(parsed.extensions)) {
      if (!isRecord(value) || typeof value.version !== "string" || typeof value.path !== "string")
        continue;
      extensions[key] = {
        version: value.version,
        path: value.path,
        installedAt:
          typeof value.installedAt === "string" ? value.installedAt : now().toISOString(),
        integrity: typeof value.integrity === "string" ? value.integrity : "",
        history: Array.isArray(value.history) ? value.history.map(String) : [],
        capabilities: Array.isArray(value.capabilities) ? value.capabilities.map(String) : [],
      };
    }
    return { version: 1, extensions };
  }

  async function writeLockfile(lockfile: PiMarketLockfile): Promise<void> {
    await writeJsonAtomic(lockfilePath, lockfile, 0o600);
  }

  async function appendAudit(entry: Omit<PiMarketAuditEntry, "id" | "at">): Promise<void> {
    const record: PiMarketAuditEntry = { id: randomUUID(), at: now().toISOString(), ...entry };
    await mkdir(dirname(auditFile), { recursive: true });
    await appendFile(auditFile, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async function readAuditTrail(limit = 50): Promise<PiMarketAuditEntry[]> {
    let content = "";
    try {
      content = await readFile(auditFile, "utf8");
    } catch {
      return [];
    }
    const lines = content.split("\n").filter(Boolean);
    const slice = Number.isFinite(limit) && limit > 0 ? lines.slice(-Math.floor(limit)) : lines;
    const out: PiMarketAuditEntry[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line) as PiMarketAuditEntry;
        if (parsed && typeof parsed === "object") out.push(parsed);
      } catch {
        // 审计文件被截断的尾行:跳过而不是抛错,保证 UI 永远能读到历史。
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // R32 — 多源:每源离线缓存 + 权重合并 + 失败兜底
  // -------------------------------------------------------------------------

  interface SourceCache {
    version: 1;
    source: PiMarketRegistrySource;
    fetchedAt: string;
    entries: PiMarketRegistryEntry[];
  }

  function sourceCacheFile(id: string): string {
    return join(sourcesDir, `${safePiExtensionId(id)}.json`);
  }

  function statusOf(
    source: PiMarketRegistrySource,
    state: PiMarketSourceState,
    entryCount: number,
    fetchedAt?: string,
    error?: string,
  ): PiMarketSourceStatus {
    return {
      id: source.id,
      ...(source.label ? { label: source.label } : {}),
      url: source.url,
      weight: sourceWeight(source),
      ...(source.trusted ? { trusted: true } : {}),
      state,
      entryCount,
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(error ? { error } : {}),
    };
  }

  async function readSourceCache(
    source: PiMarketRegistrySource,
  ): Promise<SourceCache | undefined> {
    const parsed = await readJsonFile<SourceCache>(sourceCacheFile(source.id));
    if (!parsed || !Array.isArray(parsed.entries)) return undefined;
    return {
      version: 1,
      source,
      fetchedAt: typeof parsed.fetchedAt === "string" ? parsed.fetchedAt : now().toISOString(),
      entries: parsed.entries,
    };
  }

  async function writeSourceCache(
    source: PiMarketRegistrySource,
    fetchedAt: string,
    entries: readonly PiMarketRegistryEntry[],
  ): Promise<void> {
    await mkdir(sourcesDir, { recursive: true });
    await writeJsonAtomic(
      sourceCacheFile(source.id),
      { version: 1, source, fetchedAt, entries },
      0o600,
    );
  }

  const jsonFetcher =
    options.fetchJson ??
    (async (url: string) => {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.json();
    });

  async function fetchSource(
    source: PiMarketRegistrySource,
  ): Promise<{ entries: PiMarketRegistryEntry[]; fetchedAt: string }> {
    const timeoutMs =
      typeof source.timeoutMs === "number" && source.timeoutMs > 0
        ? source.timeoutMs
        : PI_MARKET_DEFAULT_TIMEOUT_MS;
    const value = await withTimeout(jsonFetcher(source.url), timeoutMs, `source ${source.id}`);
    return { entries: [...normalizeRegistryFile(value).extensions], fetchedAt: now().toISOString() };
  }

  interface SourceProbe {
    source: PiMarketRegistrySource;
    status: PiMarketSourceStatus;
    entries?: readonly PiMarketRegistryEntry[];
  }

  /**
   * 并发探每个源:拉到了就用新鲜数据(并回写缓存),拉不到就退回上次成功的缓存。
   *
   * 一个源失败**不会**影响其它源 —— 这正是多源的意义;全部失败的判定留给调用方
   * (读路径抛 invalid-registry、刷新路径同样,但只要有缓存就继续服务)。
   */
  async function probeSources(persist: boolean): Promise<SourceProbe[]> {
    const probes = await Promise.all(
      sources.map(async (source): Promise<SourceProbe> => {
        try {
          const fetched = await fetchSource(source);
          if (persist) await writeSourceCache(source, fetched.fetchedAt, fetched.entries);
          return {
            source,
            status: statusOf(source, "fresh", fetched.entries.length, fetched.fetchedAt),
            entries: fetched.entries,
          };
        } catch (error) {
          const cached = await readSourceCache(source);
          if (cached) {
            return {
              source,
              status: statusOf(
                source,
                "cached",
                cached.entries.length,
                cached.fetchedAt,
                errorMessage(error),
              ),
              entries: cached.entries,
            };
          }
          return { source, status: statusOf(source, "failed", 0, undefined, errorMessage(error)) };
        }
      }),
    );
    lastStatuses = probes.map((probe) => probe.status);
    return probes;
  }

  /** R35 —— 源清单的三视图:`file`(可编辑)/ `effective`(最终)/ 只读 id。 */
  function sourcesView(): PiMarketSourcesView {
    return {
      file: fileSources,
      effective: sources,
      filePath: sourcesFile,
      readonlySourceIds: readonlySources.map((source) => source.id),
      statuses: lastStatuses,
    };
  }

  async function setSources(next: readonly PiMarketRegistrySource[]): Promise<PiMarketSourcesView> {
    const validated = validateRegistrySourcesForWrite(next);
    await writeJsonAtomic(sourcesFile, { version: 1, sources: validated }, 0o600);
    fileSources = validated;
    sources = mergeSourceLists(readonlySources, fileSources);
    // 源换了,上一次的每源状态就不再对应任何东西了 —— 留着只会让 UI 显示
    // "这个源已拉取 12 条"而那个源其实已经被删掉/改名。
    lastStatuses = [];
    await appendAudit({
      action: "refresh",
      extensionId: "*",
      outcome: "success",
      reason: `sources updated: ${validated.length} file source(s), ${readonlySources.length} read-only`,
    });
    return sourcesView();
  }

  /**
   * 探一个源此刻可达性。**不落盘**(不写缓存、不改 lastStatuses)——
   * 这是"保存前先试一下",不该在用户还没确定的时候改动任何状态。
   */
  async function probeSource(source: PiMarketRegistrySource): Promise<PiMarketSourceProbeResult> {
    const [candidate] = validateRegistrySourcesForWrite([source]);
    const startedAt = Date.now();
    try {
      const fetched = await fetchSource(candidate);
      return {
        ok: true,
        entryCount: fetched.entries.length,
        ...(fetched.entries[0]?.id ? { sampleId: fetched.entries[0].id } : {}),
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        entryCount: 0,
        error: errorMessage(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  const groupsOf = (
    probes: readonly SourceProbe[],
  ): Array<{ source: PiMarketRegistrySource; entries: readonly PiMarketRegistryEntry[] }> =>
    probes
      .filter((probe): probe is SourceProbe & { entries: readonly PiMarketRegistryEntry[] } =>
        Array.isArray(probe.entries),
      )
      .map((probe) => ({ source: probe.source, entries: probe.entries }));

  const newestFetchedAt = (statuses: readonly PiMarketSourceStatus[]): string | undefined =>
    statuses
      .map((status) => status.fetchedAt)
      .filter((value): value is string => typeof value === "string")
      .sort()
      .pop();

  /**
   * 读源。**读路径也会回写缓存** —— 用户配了源、打开过一次市场,就已经有缓存;
   * 下次断网 / 源挂掉时还能列出上次看到的东西,而不是给一个错误页。
   * 传统 `registry.json` 仍然只在 refresh 时写(保持 R18 的既有契约)。
   */
  async function readConfiguredSources(): Promise<{
    entries: PiMarketRegistryEntry[];
    statuses: PiMarketSourceStatus[];
    usable: boolean;
  }> {
    const probes = await probeSources(true);
    return {
      entries: mergePiMarketSources(groupsOf(probes)),
      statuses: probes.map((probe) => probe.status),
      usable: probes.some((probe) => probe.status.state !== "failed"),
    };
  }

  function normalizeRegistryFile(value: unknown): PiMarketRegistryFile {
    if (Array.isArray(value)) return { version: 1, extensions: value as PiMarketRegistryEntry[] };
    if (!isRecord(value))
      throw new PiMarketBridgeError(
        "invalid-registry",
        "registry index must be an object or array",
      );
    const list = Array.isArray(value.extensions) ? value.extensions : undefined;
    if (!list)
      throw new PiMarketBridgeError(
        "invalid-registry",
        "registry index must declare an `extensions` array",
      );
    return {
      version: typeof value.version === "number" ? value.version : 1,
      ...(typeof value.updatedAt === "string" ? { updatedAt: value.updatedAt } : {}),
      extensions: list as PiMarketRegistryEntry[],
    };
  }

  async function readRegistry(): Promise<{
    entries: PiMarketRegistryEntry[];
    source: "local" | "remote" | "empty";
    updatedAt?: string;
    sources?: PiMarketSourceStatus[];
  }> {
    // 传统本地索引优先:它由 refresh 写入,也可能是内网 / 离线分发直接拷进来的。
    const local = await readJsonFile<unknown>(registryFile);
    if (local !== undefined) {
      const parsed = normalizeRegistryFile(local);
      return {
        entries: [...parsed.extensions],
        source: "local",
        ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
        ...(sources.length > 0
          ? {
              sources: sources.map((source) =>
                statusOf(source, "skipped", 0, undefined, "本地 registry.json 优先,未读取该源"),
              ),
            }
          : {}),
      };
    }
    if (sources.length > 0) {
      const { entries, statuses, usable } = await readConfiguredSources();
      if (!usable) {
        throw new PiMarketBridgeError(
          "invalid-registry",
          `all ${sources.length} registry source(s) unreachable: ${statuses
            .map((status) => `${status.id}=${status.error ?? "error"}`)
            .join("; ")}`,
        );
      }
      const fetchedAt = newestFetchedAt(statuses);
      return {
        entries,
        source: entries.length > 0 ? "remote" : "empty",
        ...(fetchedAt ? { updatedAt: fetchedAt } : {}),
        sources: statuses,
      };
    }
    return { entries: [], source: "empty" };
  }

  function resolveEntryVersion(entry: PiMarketRegistryEntry): string | undefined {
    if (typeof entry.version === "string" && entry.version.trim()) return entry.version.trim();
    const versions = Array.isArray(entry.versions) ? entry.versions.map(String) : [];
    return highestVersion(versions);
  }

  async function toMarketEntry(
    entry: PiMarketRegistryEntry,
    lockfile: PiMarketLockfile,
  ): Promise<PiMarketEntry> {
    const id = safePiExtensionId(entry.id);
    const versions = Array.isArray(entry.versions)
      ? [...new Set(entry.versions.map(String))]
      : typeof entry.version === "string" && entry.version
        ? [entry.version]
        : [];
    const version = resolveEntryVersion(entry) ?? versions[0] ?? "0.0.0";
    const capabilities = normalizeCapabilities(entry.capabilities);
    const engineRange = entry.engines?.openbuddy;
    const incompatible =
      engineRange && options.hostVersion
        ? !satisfiesPiRange(options.hostVersion, engineRange)
        : false;
    const installed = lockfile.extensions[id];
    const updateAvailable = installed
      ? (comparePiSemver(version, installed.version) ?? 0) > 0
      : false;
    return {
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : id,
      publisher:
        typeof entry.publisher === "string" && entry.publisher.trim() ? entry.publisher : "unknown",
      description: typeof entry.description === "string" ? entry.description : "",
      version,
      versions: versions.length > 0 ? versions : [version],
      kinds: normalizeKinds(entry.kinds),
      capabilities,
      manifest: mapPiExtensionToOpenBuddyManifest(entry, version),
      // 本地 `registry.json` 走的是另一条读路径(没有源探针),条目上不会带
      // sourceId —— 这里统一回落到 `"local"`,让渲染端只认一种来源标注。
      sourceId:
        typeof entry.sourceId === "string" && entry.sourceId ? entry.sourceId : "local",
      ...(Array.isArray(entry.alsoOfferedBy) && entry.alsoOfferedBy.length > 0
        ? { alsoOfferedBy: entry.alsoOfferedBy.map(String) }
        : {}),
      ...(installed ? { installedVersion: installed.version } : {}),
      ...(installed ? { updateAvailable } : {}),
      ...(incompatible ? { incompatible: true } : {}),
      ...(Array.isArray(entry.dependencies)
        ? { dependencies: entry.dependencies.map(String) }
        : {}),
      ...(typeof entry.packageName === "string" ? { packageName: entry.packageName } : {}),
      ...(typeof entry.homepage === "string" ? { homepage: entry.homepage } : {}),
      ...(typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}),
      ...(typeof entry.installedBytes === "number" ? { installedBytes: entry.installedBytes } : {}),
    };
  }

  async function listMarketEntries(): Promise<PiMarketEntry[]> {
    const [{ entries }, lockfile] = await Promise.all([readRegistry(), readLockfile()]);
    const out: PiMarketEntry[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.id !== "string") continue;
      try {
        out.push(await toMarketEntry(entry, lockfile));
      } catch (error) {
        // 单条坏数据不应让整页市场打不开:跳过并在审计里留痕。
        await appendAudit({
          action: "refresh",
          extensionId: String((entry as { id?: unknown }).id ?? "unknown"),
          outcome: "failure",
          reason: `entry rejected: ${errorMessage(error)}`,
        });
      }
    }
    return out;
  }

  async function findEntry(id: string): Promise<PiMarketRegistryEntry> {
    const { entries } = await readRegistry();
    const found = entries.find(
      (entry) => isRecord(entry) && typeof entry.id === "string" && entry.id === id,
    );
    if (!found)
      throw new PiMarketBridgeError("not-found", `extension not found in registry: ${id}`);
    return found;
  }

  async function materializePayload(
    entry: PiMarketRegistryEntry,
    version: string,
    destination: string,
  ): Promise<void> {
    if (isRecord(entry.files) && Object.keys(entry.files).length > 0) {
      await mkdir(destination, { recursive: true });
      for (const [rawPath, content] of Object.entries(entry.files)) {
        const rel = safeRelativePath(rawPath);
        const target = join(destination, rel);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, String(content), "utf8");
      }
      return;
    }
    if (typeof entry.payloadPath === "string" && entry.payloadPath.trim()) {
      const source = resolve(entry.payloadPath);
      const info = await stat(source).catch(() => undefined);
      if (!info?.isDirectory()) {
        throw new PiMarketBridgeError(
          "payload-unavailable",
          `payloadPath is not a directory: ${source}`,
        );
      }
      await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
      return;
    }
    if (options.fetchPayload) {
      await mkdir(destination, { recursive: true });
      await options.fetchPayload(entry, version, destination);
      return;
    }
    throw new PiMarketBridgeError(
      "payload-unavailable",
      `no payload source for ${entry.id}@${version} (expected files / payloadPath / injected fetchPayload)`,
    );
  }

  async function commitVersion(
    entry: PiMarketRegistryEntry,
    id: string,
    version: string,
    lockfile: PiMarketLockfile,
    options2: PiMarketInstallOptions,
    action: PiMarketAction,
  ): Promise<PiMarketInstallResult> {
    const extDir = join(root, id);
    const versionDir = join(extDir, version);
    const manifest = mapPiExtensionToOpenBuddyManifest(entry, version);
    const capabilities = normalizeCapabilities(entry.capabilities).map(
      (capability) => capability.id,
    );
    const previous = lockfile.extensions[id]?.version;

    const targetInfo = await lstat(versionDir).catch(() => undefined);
    if (targetInfo?.isSymbolicLink()) {
      throw new PiMarketBridgeError(
        "unsafe-target",
        `refusing to write into a symlinked version dir: ${versionDir}`,
      );
    }

    let integrity = "";
    if (targetInfo?.isDirectory() && !options2.force) {
      integrity = await hashPayloadDirectory(versionDir);
      const expected = lockfile.extensions[id];
      if (
        expected &&
        expected.version === version &&
        expected.integrity &&
        expected.integrity !== integrity
      ) {
        throw new PiMarketBridgeError(
          "corrupt-install",
          `installed payload for ${id}@${version} was modified; re-run with force to re-materialize`,
        );
      }
    } else {
      await mkdir(extDir, { recursive: true });
      if (targetInfo?.isDirectory()) await rm(versionDir, { recursive: true, force: true });
      const stagingRoot = await mkdtemp(join(extDir, ".staging-"));
      const payload = join(stagingRoot, "payload");
      let committed = false;
      try {
        await materializePayload(entry, version, payload);
        await writeJsonAtomic(join(payload, "openbuddy.plugin.json"), manifest);
        integrity = await hashPayloadDirectory(payload);
        await rename(payload, versionDir);
        committed = true;
      } catch (error) {
        if (committed)
          await rm(versionDir, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof PiMarketBridgeError) throw error;
        throw new PiMarketBridgeError(
          "payload-rejected",
          `install failed for ${id}@${version}: ${errorMessage(error)}`,
          error,
        );
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    const installedAt = now().toISOString();
    const history = lockfile.extensions[id]?.history ?? [];
    const nextHistory =
      action === "rollback"
        ? history.filter((item, index) => index !== history.length - 1)
        : previous && previous !== version
          ? [...history, previous]
          : history;
    const nextLockfile: PiMarketLockfile = {
      version: 1,
      extensions: {
        ...lockfile.extensions,
        [id]: {
          version,
          path: versionDir,
          installedAt,
          integrity,
          history: nextHistory,
          capabilities,
        },
      },
    };
    await writeLockfile(nextLockfile);
    // 指针文件写失败时回滚 lockfile,保证「lockfile 描述的状态 == 指针」。
    try {
      await writeTextAtomic(join(extDir, "current"), `${version}\n`, 0o600);
    } catch (error) {
      await writeLockfile(lockfile).catch(() => undefined);
      throw new PiMarketBridgeError(
        "payload-rejected",
        `failed to update current pointer for ${id}: ${errorMessage(error)}`,
        error,
      );
    }
    lockfile.extensions = nextLockfile.extensions;

    await appendAudit({
      action,
      extensionId: id,
      version,
      ...(previous && previous !== version ? { from: previous } : {}),
      outcome: "success",
    });
    return {
      id,
      version,
      path: versionDir,
      ...(previous && previous !== version ? { previousVersion: previous } : {}),
      changed: previous !== version,
      installedAt,
      capabilities,
    };
  }

  async function guard(
    entry: PiMarketRegistryEntry,
    version: string,
    installOptions: PiMarketInstallOptions,
  ): Promise<void> {
    const capabilities = normalizeCapabilities(entry.capabilities);
    if (hasHighRiskCapability(capabilities) && !installOptions.allowHighRisk) {
      throw new PiMarketBridgeError(
        "consent-required",
        `${entry.id} requests high-risk capabilities: ${capabilities
          .filter((c) => c.risk === "high")
          .map((c) => c.id)
          .join(", ")}`,
      );
    }
    const engineRange = entry.engines?.openbuddy;
    if (engineRange && options.hostVersion && !satisfiesPiRange(options.hostVersion, engineRange)) {
      throw new PiMarketBridgeError(
        "incompatible",
        `${entry.id}@${version} requires openbuddy ${engineRange}, host is ${options.hostVersion}`,
      );
    }
  }

  async function install(
    id: string,
    version: string | undefined,
    installOptions: PiMarketInstallOptions,
  ): Promise<PiMarketInstallResult> {
    const safeId = safePiExtensionId(id);
    let target = version;
    try {
      const entry = await findEntry(safeId);
      const lockfile = await readLockfile();
      const offered = new Set<string>([
        ...(Array.isArray(entry.versions) ? entry.versions.map(String) : []),
        ...(typeof entry.version === "string" ? [entry.version] : []),
        ...(lockfile.extensions[safeId]
          ? [lockfile.extensions[safeId].version, ...lockfile.extensions[safeId].history]
          : []),
      ]);
      target = version ?? resolveEntryVersion(entry);
      if (!target)
        throw new PiMarketBridgeError("version-not-found", `${safeId} declares no version`);
      if (offered.size > 0 && !offered.has(target)) {
        throw new PiMarketBridgeError(
          "version-not-found",
          `${safeId}@${target} is not offered by the registry`,
        );
      }
      await guard(entry, target, installOptions);
      return await commitVersion(entry, safeId, target, lockfile, installOptions, "install");
    } catch (error) {
      // 失败也要留痕:审计里能区分「被拒绝」(consent / engine / not-found)与
      // 「写到一半崩了」。
      await appendAudit({
        action: "install",
        extensionId: safeId,
        version: target,
        outcome: "failure",
        reason: errorMessage(error),
      });
      throw error;
    }
  }

  async function upgrade(
    id: string,
    installOptions: PiMarketInstallOptions,
  ): Promise<PiMarketInstallResult> {
    const safeId = safePiExtensionId(id);
    let currentVersion: string | undefined;
    let target: string | undefined;
    try {
      const entry = await findEntry(safeId);
      const lockfile = await readLockfile();
      const current = lockfile.extensions[safeId];
      if (!current) throw new PiMarketBridgeError("not-found", `${safeId} is not installed`);
      currentVersion = current.version;
      target = resolveEntryVersion(entry) ?? current.version;
      const verdict = comparePiSemver(target, current.version);
      if (verdict !== null && verdict <= 0) {
        return {
          id: safeId,
          version: current.version,
          path: current.path,
          changed: false,
          installedAt: current.installedAt,
          capabilities: current.capabilities,
        };
      }
      await guard(entry, target, installOptions);
      return await commitVersion(entry, safeId, target, lockfile, installOptions, "upgrade");
    } catch (error) {
      await appendAudit({
        action: "upgrade",
        extensionId: safeId,
        version: target,
        ...(currentVersion ? { from: currentVersion } : {}),
        outcome: "failure",
        reason: errorMessage(error),
      });
      throw error;
    }
  }

  async function rollback(
    id: string,
    installOptions: PiMarketInstallOptions,
  ): Promise<PiMarketInstallResult> {
    const safeId = safePiExtensionId(id);
    let currentVersion: string | undefined;
    let previous: string | undefined;
    try {
      const lockfile = await readLockfile();
      const current = lockfile.extensions[safeId];
      if (!current) throw new PiMarketBridgeError("not-found", `${safeId} is not installed`);
      currentVersion = current.version;
      previous = current.history[current.history.length - 1];
      if (!previous)
        throw new PiMarketBridgeError(
          "no-previous-version",
          `${safeId} has no recorded previous version`,
        );
      // 回滚不重新下载:直接复用磁盘上已有的版本目录(registry 里已经下架
      // 的版本同样可以回滚),因此这里只在索引里找不到时才合成一个最小描述。
      const previousDir = join(root, safeId, previous);
      if (!(await exists(previousDir))) {
        throw new PiMarketBridgeError(
          "no-previous-version",
          `${safeId}@${previous} is no longer on disk`,
        );
      }
      const entry = (await readRegistry()).entries.find(
        (item) => isRecord(item) && typeof item.id === "string" && item.id === safeId,
      ) ?? { id: safeId, version: previous };
      return await commitVersion(
        entry,
        safeId,
        previous,
        lockfile,
        { ...installOptions, force: false },
        "rollback",
      );
    } catch (error) {
      await appendAudit({
        action: "rollback",
        extensionId: safeId,
        version: previous,
        ...(currentVersion ? { from: currentVersion } : {}),
        outcome: "failure",
        reason: errorMessage(error),
      });
      throw error;
    }
  }

  /** 清掉历史遗留的 `.trash-*`(上一次 uninstall 的 rm 失败时留下的)。 */
  async function sweepTrash(): Promise<void> {
    const names = await readdir(root).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => name.startsWith(".trash-"))
        .map((name) => rm(join(root, name), { recursive: true, force: true }).catch(() => undefined)),
    );
  }

  /**
   * R33 — 卸载。
   *
   * 为什么要"先 rename 再 rm":直接 `rm -rf <id>` 删到一半失败会留下一个
   * **半残但看起来还在**的安装(指针文件还在、版本目录缺文件),加载器照样会去读它。
   * `rename(<id>, .trash-<rand>)` 是原子的 —— 一旦成功,扩展立刻从加载器视角消失,
   * 之后的 rm 只是清理磁盘;rm 失败最多留一个 `.trash-*` 目录(下次卸载顺手扫掉)。
   *
   * lockfile 与磁盘谁在谁不在的四种组合都要能收敛:
   *   - 都在 → 正常卸载;
   *   - 只有 lockfile(目录被外部删了)→ 摘记录,`removedVersions` 为空;
   *   - 只有目录(手工拷进来的)→ 删目录,`version` 为 undefined;
   *   - 都没有 → `not-found`。
   */
  async function uninstall(
    id: string,
    uninstallOptions: PiMarketUninstallOptions,
  ): Promise<PiMarketUninstallResult> {
    const safeId = safePiExtensionId(id);
    const extDir = join(root, safeId);
    const keepPayload = uninstallOptions.keepPayload === true;
    const at = now().toISOString();
    try {
      const lockfile = await readLockfile();
      const record = lockfile.extensions[safeId];
      // lstat(而不是 stat):`<id>` 本身是符号链接时,我们想删的是这个链接,
      // 而不是顺着链接把外面某个目录删掉。
      const dirInfo = await lstat(extDir).catch(() => undefined);
      if (!record && !dirInfo) {
        throw new PiMarketBridgeError("not-found", `${safeId} is not installed`);
      }

      let removedVersions: string[] = [];
      if (dirInfo?.isDirectory() && !keepPayload) {
        const entries = await readdir(extDir, { withFileTypes: true }).catch(() => []);
        removedVersions = entries
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => entry.name)
          .sort();
        const trash = join(root, `.trash-${randomUUID()}`);
        await rename(extDir, trash);
        await rm(trash, { recursive: true, force: true }).catch(() => undefined);
        await sweepTrash();
      } else if (dirInfo?.isDirectory()) {
        removedVersions = [];
      }

      if (record) {
        const next: PiMarketLockfile = { version: 1, extensions: { ...lockfile.extensions } };
        delete next.extensions[safeId];
        await writeLockfile(next);
      }

      await appendAudit({
        action: "uninstall",
        extensionId: safeId,
        ...(record ? { version: record.version } : {}),
        outcome: "success",
        ...(keepPayload ? { reason: "payload kept (lockfile entry removed)" } : {}),
      });

      return {
        id: safeId,
        ...(record ? { version: record.version } : {}),
        removedVersions,
        removedPath: extDir,
        at,
        payloadKept: keepPayload,
      };
    } catch (error) {
      await appendAudit({
        action: "uninstall",
        extensionId: safeId,
        outcome: "failure",
        reason: errorMessage(error),
      });
      throw error;
    }
  }

  /**
   * 刷新所有源(并发),把合并结果写进传统 `registry.json`(保持 R18 契约:
   * 刷新后再 list 就不再触网),并给每个源留一条状态。
   *
   * 只有在**所有源都没拉到、且一个缓存都没有**时才抛错 —— 那时确实没有任何
   * 可展示的内容。只要有缓存,就照旧刷新成功,并把不可达的源放进 `failed`
   * 让 UI 提示「N 个源不可达,已用缓存」。
   */
  async function refreshRegistry(): Promise<PiMarketRefreshReport> {
    const updatedAt = now().toISOString();
    if (sources.length === 0) {
      const { entries } = await readRegistry();
      await appendAudit({
        action: "refresh",
        extensionId: "*",
        outcome: "success",
        reason: `local registry: ${entries.length}`,
      });
      return { count: entries.length, updatedAt, source: "local" };
    }
    const probes = await probeSources(true);
    const statuses = probes.map((probe) => probe.status);
    const freshCount = statuses.filter((status) => status.state === "fresh").length;
    const cachedCount = statuses.filter((status) => status.state === "cached").length;
    const failed = statuses.filter((status) => status.state === "failed");
    if (freshCount === 0 && cachedCount === 0) {
      const reason = `all ${sources.length} source(s) failed: ${failed
        .map((status) => `${status.id}=${status.error ?? "error"}`)
        .join("; ")}`;
      await appendAudit({
        action: "refresh",
        extensionId: "*",
        outcome: "failure",
        reason,
      });
      throw new PiMarketBridgeError("invalid-registry", reason);
    }
    const entries = mergePiMarketSources(groupsOf(probes));
    await writeJsonAtomic(registryFile, { version: 1, updatedAt, extensions: entries }, 0o600);
    await appendAudit({
      action: "refresh",
      extensionId: "*",
      outcome: "success",
      reason: `remote registry: ${entries.length} (${freshCount} fresh, ${cachedCount} cached, ${failed.length} failed)`,
    });
    const notFresh = statuses.filter((status) => status.state !== "fresh");
    return {
      count: entries.length,
      updatedAt,
      source: "remote",
      sources: statuses,
      ...(notFresh.length > 0 ? { failed: notFresh } : {}),
    };
  }

  return {
    paths: { root, registryFile, lockfile: lockfilePath, auditFile, sourcesDir, sourcesFile },
    readRegistry,
    refreshRegistry,
    listMarketEntries,
    async getMarketEntry(id: string) {
      const safeId = safePiExtensionId(id);
      return (await listMarketEntries()).find((entry) => entry.id === safeId);
    },
    installPiExtension: (id, version, installOptions = {}) =>
      serialize(() => install(id, version, installOptions)),
    upgradePiExtension: (id, installOptions = {}) => serialize(() => upgrade(id, installOptions)),
    rollbackPiExtension: (id, installOptions = {}) => serialize(() => rollback(id, installOptions)),
    uninstallPiExtension: (id, uninstallOptions = {}) =>
      serialize(() => uninstall(id, uninstallOptions)),
    getSources: sourcesView,
    setSources: (next) => serialize(() => setSources(next)),
    probeSource: (source) => probeSource(source),
    readLockfile,
    readAuditTrail,
  };
}

// ---------------------------------------------------------------------------
// IPC(显式 additive;宿主可选择不注册)
// ---------------------------------------------------------------------------

export const PI_MARKET_IPC_CHANNELS = {
  list: "agent:pi-market-list",
  refresh: "agent:pi-market-refresh",
  install: "agent:pi-market-install",
  upgrade: "agent:pi-market-upgrade",
  rollback: "agent:pi-market-rollback",
  uninstall: "agent:pi-market-uninstall",
  lockfile: "agent:pi-market-lockfile",
  audit: "agent:pi-market-audit",
  // R35 —— 源管理。在 R35 之前 `sources.json` 只能手写,而且写完必须重启
  // 才生效(源清单在 bridge 构造时定死)。
  sourcesGet: "agent:pi-market-sources-get",
  sourcesSet: "agent:pi-market-sources-set",
  sourceProbe: "agent:pi-market-source-probe",
} as const;

export type PiMarketIpcChannel =
  (typeof PI_MARKET_IPC_CHANNELS)[keyof typeof PI_MARKET_IPC_CHANNELS];

/** electron `ipcMain` 的最小结构面(便于测试注入)。 */
export interface PiMarketIpcLike {
  handle(channel: string, handler: (event: unknown, args?: unknown) => unknown): void;
  removeHandler?(channel: string): void;
}

function requiredArg(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PiMarketBridgeError("invalid-id", `${field} is required`);
  }
  return value.trim();
}

function optionalRecord(args: unknown): Record<string, unknown> {
  return isRecord(args) ? args : {};
}

/** 纯函数式 handler 表:宿主可以整体接管 dispatch(与 preload 白名单无关)。 */
export function createPiMarketHandlers(
  bridge: PiMarketBridge,
): Record<PiMarketIpcChannel, (args?: unknown) => Promise<unknown>> {
  return {
    [PI_MARKET_IPC_CHANNELS.list]: async () => ({ entries: await bridge.listMarketEntries() }),
    [PI_MARKET_IPC_CHANNELS.refresh]: async () => bridge.refreshRegistry(),
    [PI_MARKET_IPC_CHANNELS.install]: async (args) => {
      const input = optionalRecord(args);
      return bridge.installPiExtension(
        requiredArg(input.id, "id"),
        typeof input.version === "string" ? input.version : undefined,
        { allowHighRisk: input.allowHighRisk === true, force: input.force === true },
      );
    },
    [PI_MARKET_IPC_CHANNELS.upgrade]: async (args) => {
      const input = optionalRecord(args);
      return bridge.upgradePiExtension(requiredArg(input.id, "id"), {
        allowHighRisk: input.allowHighRisk === true,
      });
    },
    [PI_MARKET_IPC_CHANNELS.rollback]: async (args) => {
      const input = optionalRecord(args);
      return bridge.rollbackPiExtension(requiredArg(input.id, "id"));
    },
    [PI_MARKET_IPC_CHANNELS.uninstall]: async (args) => {
      const input = optionalRecord(args);
      return bridge.uninstallPiExtension(requiredArg(input.id, "id"), {
        keepPayload: input.keepPayload === true,
      });
    },
    [PI_MARKET_IPC_CHANNELS.sourcesGet]: async () => bridge.getSources(),
    [PI_MARKET_IPC_CHANNELS.sourcesSet]: async (args) => {
      const input = optionalRecord(args);
      if (!Array.isArray(input.sources)) {
        throw new PiMarketBridgeError("invalid-registry", "sources payload is required");
      }
      // **不要**在这里 normalize:读路径的归一化会静默丢掉坏条目,而这是写路径 ——
      // 用户刚在输入框里敲的那一行如果被悄悄吞掉,"我明明加了"就成了查不出的谜。
      // 形状校验交给 bridge 的 validateRegistrySourcesForWrite(),它会指出第几行错在哪。
      return bridge.setSources(input.sources as PiMarketRegistrySource[]);
    },
    [PI_MARKET_IPC_CHANNELS.sourceProbe]: async (args) => {
      const input = optionalRecord(args);
      const candidate = isRecord(input.source) ? input.source : { url: input.url };
      return bridge.probeSource(candidate as PiMarketRegistrySource);
    },
    [PI_MARKET_IPC_CHANNELS.lockfile]: async () => bridge.readLockfile(),
    [PI_MARKET_IPC_CHANNELS.audit]: async (args) => {
      const input = optionalRecord(args);
      const limit =
        typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : 50;
      return { entries: await bridge.readAuditTrail(limit) };
    },
  };
}

/**
 * 把 bridge 挂到 `ipcMain`。**不修改任何既有 channel**;返回 disposer 便于
 * HMR / 测试清理。宿主若尚未把新 channel 加进 preload 白名单,可以先不调用。
 */
export function registerPiMarketBridgeIpc(
  bridge: PiMarketBridge,
  ipc: PiMarketIpcLike,
  channels: Record<string, PiMarketIpcChannel> = PI_MARKET_IPC_CHANNELS,
): () => void {
  const handlers = createPiMarketHandlers(bridge);
  const registered: string[] = [];
  for (const channel of Object.values(channels)) {
    const handler = handlers[channel];
    if (!handler) continue;
    ipc.handle(channel, (_event: unknown, args?: unknown) => handler(args));
    registered.push(channel);
  }
  return () => {
    if (!ipc.removeHandler) return;
    for (const channel of registered) ipc.removeHandler(channel);
  };
}
