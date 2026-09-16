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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PiMarketKind = "plugin" | "skill" | "extension" | "mcp" | "theme";

export type PiMarketCapabilityRisk = "low" | "medium" | "high";

export interface PiMarketCapability {
  id: string;
  label?: string;
  risk?: PiMarketCapabilityRisk;
  detail?: string;
}

/** 索引里的一条 Pi 扩展描述。字段全部宽松:缺省值在归一化阶段补齐。 */
export interface PiMarketRegistryEntry {
  id: string;
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
  name: string;
  publisher: string;
  description: string;
  version: string;
  versions: string[];
  kinds: PiMarketKind[];
  capabilities: PiMarketCapability[];
  manifest: OpenBuddyPluginManifest;
  installedVersion?: string;
  updateAvailable?: boolean;
  incompatible?: boolean;
  dependencies?: string[];
  packageName?: string;
  homepage?: string;
  updatedAt?: string;
  installedBytes?: number;
}

export type PiMarketAction = "install" | "upgrade" | "rollback" | "refresh";

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

export interface PiMarketLockEntry {
  version: string;
  path: string;
  installedAt: string;
  /** 载荷目录的 sha256(路径+内容),用于检测被外部改写。 */
  integrity: string;
  /** 回滚栈:末尾元素 = 上一个版本。 */
  history: string[];
  capabilities: string[];
}

export interface PiMarketLockfile {
  version: 1;
  extensions: Record<string, PiMarketLockEntry>;
}

export interface PiMarketInstallResult {
  id: string;
  version: string;
  path: string;
  previousVersion?: string;
  /** false 表示「已经是目标版本,未发生变更」(upgrade 的常见结果)。 */
  changed: boolean;
  installedAt: string;
  capabilities: string[];
}

export interface PiMarketInstallOptions {
  /** 高风险能力需要显式同意(renderer 的 InstallDialog 勾选后传入)。 */
  allowHighRisk?: boolean;
  /** 已存在的版本目录被改写 / integrity 不匹配时,强制重新物化。 */
  force?: boolean;
}

export interface PiMarketBridgeOptions {
  /** 数据目录等价物(宿主传 `app.getPath("userData")`)。 */
  dataDir: string;
  /** 可选远端索引 URL;刷新时通过 fetchJson 拉取。 */
  registryUrl?: string;
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

export class PiMarketBridgeError extends Error {
  readonly code: PiMarketErrorCode;
  constructor(code: PiMarketErrorCode, message: string, cause?: unknown) {
    super(`pi-market: ${message}`);
    this.name = "PiMarketBridgeError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface PiMarketBridge {
  readonly paths: {
    root: string;
    registryFile: string;
    lockfile: string;
    auditFile: string;
  };
  readRegistry(): Promise<{
    entries: PiMarketRegistryEntry[];
    source: "local" | "remote" | "empty";
    updatedAt?: string;
  }>;
  refreshRegistry(): Promise<{ count: number; updatedAt: string; source: "remote" | "local" }>;
  listMarketEntries(): Promise<PiMarketEntry[]>;
  getMarketEntry(id: string): Promise<PiMarketEntry | undefined>;
  installPiExtension(
    id: string,
    version?: string,
    options?: PiMarketInstallOptions,
  ): Promise<PiMarketInstallResult>;
  upgradePiExtension(id: string, options?: PiMarketInstallOptions): Promise<PiMarketInstallResult>;
  rollbackPiExtension(id: string, options?: PiMarketInstallOptions): Promise<PiMarketInstallResult>;
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
  const now = options.now ?? (() => new Date());

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

  async function readRemoteIndex(): Promise<PiMarketRegistryFile | undefined> {
    if (!options.registryUrl) return undefined;
    const fetcher =
      options.fetchJson ??
      (async (url: string) => {
        const response = await fetch(url, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return response.json();
      });
    try {
      return normalizeRegistryFile(await fetcher(options.registryUrl));
    } catch (error) {
      throw new PiMarketBridgeError(
        "invalid-registry",
        `remote index fetch failed: ${errorMessage(error)}`,
        error,
      );
    }
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
  }> {
    const local = await readJsonFile<unknown>(registryFile);
    if (local !== undefined) {
      const parsed = normalizeRegistryFile(local);
      return {
        entries: [...parsed.extensions],
        source: "local",
        ...(parsed.updatedAt ? { updatedAt: parsed.updatedAt } : {}),
      };
    }
    if (options.registryUrl) {
      const remote = await readRemoteIndex();
      if (remote) {
        return {
          entries: [...remote.extensions],
          source: "remote",
          ...(remote.updatedAt ? { updatedAt: remote.updatedAt } : {}),
        };
      }
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

  async function refreshRegistry(): Promise<{
    count: number;
    updatedAt: string;
    source: "remote" | "local";
  }> {
    const updatedAt = now().toISOString();
    if (!options.registryUrl) {
      const { entries } = await readRegistry();
      await appendAudit({
        action: "refresh",
        extensionId: "*",
        outcome: "success",
        reason: `local registry: ${entries.length}`,
      });
      return { count: entries.length, updatedAt, source: "local" };
    }
    try {
      const remote = await readRemoteIndex();
      const entries = remote?.extensions ?? [];
      await writeJsonAtomic(registryFile, { version: 1, updatedAt, extensions: entries }, 0o600);
      await appendAudit({
        action: "refresh",
        extensionId: "*",
        outcome: "success",
        reason: `remote registry: ${entries.length}`,
      });
      return { count: entries.length, updatedAt, source: "remote" };
    } catch (error) {
      await appendAudit({
        action: "refresh",
        extensionId: "*",
        outcome: "failure",
        reason: errorMessage(error),
      });
      throw error;
    }
  }

  return {
    paths: { root, registryFile, lockfile: lockfilePath, auditFile },
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
  lockfile: "agent:pi-market-lockfile",
  audit: "agent:pi-market-audit",
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
