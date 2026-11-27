import { mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SafeStorage } from "@openbuddy/kernel";
import type { NotifyChannel } from "@openbuddy/protocol/notifications";
import { PiSettingsStore } from "./pi-settings.js";
import { migrate, SCHEMA_VERSION, type Migration } from "../persistence/schema.js";
import { SnapshotStore, storeName, writeAtomic } from "../persistence/snapshots.js";
import type { AppInstallHistory } from "../apps/install-state.js";

/**
 * 受保护路径 (pii W6.2)：写入类工具默认拒绝触碰的文件。规则是用户可编辑的
 * （设置 · 安全中心），这里只是首次使用的默认值。`*.x` 匹配后缀、`.name` 匹配
 * basename 前缀（`.env` 覆盖 `.env.local`），不含 `/` 的短名同时匹配路径段。
 */
export const DEFAULT_PROTECTED_PATHS = [
  ".env",
  ".git",
  ".ssh",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa",
  "id_ed25519",
  "credentials.json",
] as const;

// Moved to @openbuddy/kernel (20261115-md R2); re-exported so existing importers keep working.
export type { SafeStorage };
export { object, text, bool, unsupported } from "@openbuddy/kernel";
export interface JsonStoreOptions {
  /** Persist `schemaVersion` and run the v0→v1+ migrations on read (A2). */
  versioned?: boolean;
  migrations?: Record<number, Migration>;
  /** Restore the newest readable snapshot when the file no longer parses. */
  snapshots?: SnapshotStore;
  onRecover?: (info: { file: string; reason: string; restoredFrom?: string }) => void;
}

/** JSON store with atomic writes; versioning, snapshots and corrupt-file self-heal are opt-in. */
export class JsonStore<T> {
  constructor(
    readonly path: string,
    private fallback: () => T,
    private options: JsonStoreOptions = {},
  ) {}
  read(): T {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.fallback();
      return this.recover(error);
    }
    return this.upgrade(raw);
  }
  /** Upgrade + persist once; a failed upgrade falls into the snapshot/quarantine path. */
  private upgrade(raw: unknown, allowRestore = true): T {
    if (!this.options.versioned) return raw as T;
    try {
      const result = migrate(raw, this.options.migrations);
      if (result.migrated) {
        try {
          this.options.snapshots?.capture(`pre-migration-v${result.from}`, [storeName(this.path)]);
        } catch {
          // A snapshot failure must not block the migration itself.
        }
        this.write(result.data as T);
      }
      return result.data as T;
    } catch (error) {
      return allowRestore ? this.recover(error) : this.quarantine(error);
    }
  }
  private recover(reason: unknown): T {
    const name = storeName(this.path);
    const hit = this.options.snapshots?.latestFor(name);
    if (hit) {
      try {
        writeAtomic(this.path, readFileSync(hit.path));
        this.report({ file: name, reason: String(reason), restoredFrom: hit.manifest.id });
        return this.upgrade(JSON.parse(readFileSync(this.path, "utf8")), false);      } catch {
        // The snapshot was unreadable: fall through to quarantine.
      }
    }
    return this.quarantine(reason);
  }
  private quarantine(reason: unknown): T {
    const name = storeName(this.path);
    try {
      renameSync(this.path, `${this.path}.corrupt-${Date.now()}`);
    } catch {
      // ENOENT or a read-only disk: the fallback is still the safe answer.
    }
    this.report({ file: name, reason: String(reason) });
    return this.fallback();
  }
  private report(info: { file: string; reason: string; restoredFrom?: string }) {
    if (this.options.onRecover) this.options.onRecover(info);
    else console.error("openbuddy: data file recovered", info);
  }
  write(value: T): void {
    const versioned = this.options.versioned && value && typeof value === "object" && !Array.isArray(value);
    const out = versioned ? { ...(value as Record<string, unknown>), schemaVersion: SCHEMA_VERSION } : value;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeAtomic(this.path, JSON.stringify(out, null, 2));
  }
}
export class SecretStore {
  private store: JsonStore<Record<string, string>>;
  constructor(
    dir: string,
    private safe: SafeStorage,
  ) {
    this.store = new JsonStore(join(dir, "credentials.enc.json"), () => ({}));
  }
  private check() {
    if (
      !this.safe.isEncryptionAvailable() ||
      this.safe.getSelectedStorageBackend?.() === "basic_text"
    )
      throw new Error("安全密钥存储不可用，请启用系统钥匙串");
  }
  get(id: string): string | undefined {
    const encoded = this.store.read()[id];
    if (!encoded) return undefined;
    this.check();
    return this.safe.decryptString(Buffer.from(encoded, "base64"));
  }
  set(id: string, value: string | undefined) {
    this.secretsCache = undefined;
    const data = this.store.read();
    if (value) {
      this.check();
      data[id] = this.safe.encryptString(value).toString("base64");
    } else delete data[id];
    this.store.write(data);
  }
  has(id: string) {
    return !!this.store.read()[id];
  }
  /** Decrypted secret values, cached until the next write (redact runs per streamed event). */
  private secretsCache?: string[];
  private secretValues(): string[] {
    if (this.secretsCache) return this.secretsCache;
    const secrets = Object.keys(this.store.read())
      .map((id) => this.get(id))
      .filter((s): s is string => !!s);
    const collect = (value: unknown, sensitive = false): void => {
      if (typeof value === "string" && sensitive && value) secrets.push(value);
      else if (value && typeof value === "object")
        for (const [key, child] of Object.entries(value))
          collect(
            child,
            sensitive || /token|secret|verifier|oauthState/i.test(key),
          );
    };
    for (const secret of [...secrets]) {
      try {
        collect(JSON.parse(secret));
      } catch {
        /* Scalar credentials are already included. */
      }
    }
    this.secretsCache = [...new Set(secrets)].filter(Boolean);
    return this.secretsCache;
  }
  redact(value: unknown): unknown {
    const secrets = this.secretValues();
    if (!secrets.length) return value;
    const visit = (v: unknown): unknown => {
      if (typeof v === "string") {
        let text = v;
        for (const secret of secrets)
          text = text.split(secret).join("[REDACTED]");
        return text;
      }
      if (Array.isArray(v)) return v.map(visit);
      if (v && typeof v === "object")
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, visit(x)]),
        );
      return v;
    };
    return visit(value);
  }
}
export function createSettings(userDataDir: string, safe: SafeStorage) {
  const dir = join(userDataDir, "pi");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // 升级前快照 (A2): one per day before the first read can migrate or corrupt-heal anything.
  const snapshots = new SnapshotStore(dir);
  try {
    snapshots.captureStartup();
  } catch (error) {
    console.error("openbuddy: startup snapshot failed", error);
  }
  const onRecover = (info: { file: string; reason: string; restoredFrom?: string }) =>
    console.error("openbuddy: data file recovered", info);
  return {
    dir,
    snapshots,
    secrets: new SecretStore(dir, safe),
    /** Session behaviour read by Pi's SettingsManager (pi-settings.json, 20261116-pii W0.4 / §8). */
    pi: new PiSettingsStore(dir),
    config: new JsonStore<AppSettings>(join(dir, "openbuddy.json"), () => ({
      permissionMode: "ask",
      rules: [],
      defaults: {
        defaultModel: "",
        defaultPermission: "ask",
        rememberToolApprovals: false,
      },
      skillPaths: [],
      disabledSkills: [],
      trustedFolders: [],
      sessions: {},
      notifications: [],
    }), { versioned: true, snapshots, onRecover }),
  };
}
export interface AppSettings {
  permissionMode: "ask" | "auto" | "always-approve";
  rules: Array<{ action: string; tool: string; pattern?: string }>;
  /** 受保护路径 (pii W6.2): write/edit/delete tools are always denied on these, in every mode. */
  protectedPaths?: string[];
  /** 沙箱与网络策略 (G2-3): hard boundary checked before any rule; empty lists mean "not restricted". */
  sandboxPolicy?: {
    fileWriteAllow: string[];
    commandAllow: string[];
    networkAllow: string[];
  };
  defaults: {
    defaultModel: string;
    defaultPermission: string;
    rememberToolApprovals?: boolean;
    defaultProviderId?: string;
    defaultThinkingLevel?: string;
  };
  extensionPaths?: string[];
  /** Paths switched off in 扩展中心 (pii W2.6): still configured, just not loaded. */
  extensionDisabled?: string[];
  extensionsEnabled?: boolean;
  skillPaths: string[];
  disabledSkills: string[];
  trustedFolders: string[];
  folderTrustDecisions?: Record<string, boolean>;
  sessions: Record<
    string,
    {
      pinned?: boolean;
      archived?: boolean;
      title?: string;
      /** 交接到新任务 (pii W1.7): where this session came from, so the banner survives a reload. */
      handoffFrom?: { sessionId: string; title?: string };
    }
  >;
  /** 本任务连接器开关 (pii W2.4 P2): MCP servers disabled for one session. */
  sessionMcpDisabled?: Record<string, string[]>;
  /** 本地模型 (pii W8): llama.cpp / OpenAI-compatible local server. */
  localModel?: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    contextWindow: number;
    maxTokens: number;
    setDefault: boolean;
  };
  /** 工具策略 (20261126-upup UP-3.2): 应用/用户显式禁用的工具名（平台红线另有一条硬规则）。 */
  deniedTools?: string[];
  /** 只读工具 (UP-3.2): auto 模式下与内建只读工具一样免审。 */
  readonlyTools?: string[];
  /** 当前应用 (20261127-upup U4): 会话打开时把该应用的身份/边界注入 system prompt。 */
  currentAppId?: string;
  /** 应用安装来源与回滚 (U6): key = 去掉 `#ref` 的安装源。 */
  appInstalls?: Record<string, AppInstallHistory>;
  /** 默认打开方式 (G1-6): per file type, "embedded" (预览面板) or "system" (系统关联应用). */
  defaultOpen?: Record<string, "embedded" | "system">;
  /** System notifications while the window is in the background (20261115-ui U6.1); on by default. */
  notifyPrefs?: { system?: boolean };
  /** 通知渠道 (pii W4.6): webhook / mail / desktop, sent by the host. */
  notifyChannels?: NotifyChannel[];
  notifications: Array<{
    id: number;
    kind: string;
    at: string;
    title: string;
    body?: string;
    sessionId?: string;
    severity: string;
    read: boolean;
  }>;
}
export type Settings = ReturnType<typeof createSettings>;
