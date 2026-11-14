import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SafeStorage } from "@openbuddy/kernel";

// Moved to @openbuddy/kernel (20261115-md R2); re-exported so existing importers keep working.
export type { SafeStorage };
export { object, text, bool, unsupported } from "@openbuddy/kernel";
export class JsonStore<T> {
  constructor(
    readonly path: string,
    private fallback: () => T,
  ) {}
  read(): T {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.fallback();
      throw error;
    }
  }
  write(value: T): void {
    const temp = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
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
  return {
    dir,
    secrets: new SecretStore(dir, safe),
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
    })),
  };
}
export interface AppSettings {
  permissionMode: "ask" | "auto" | "always-approve";
  rules: Array<{ action: string; tool: string; pattern?: string }>;
  defaults: {
    defaultModel: string;
    defaultPermission: string;
    rememberToolApprovals?: boolean;
    defaultProviderId?: string;
    defaultThinkingLevel?: string;
  };
  extensionPaths?: string[];
  extensionsEnabled?: boolean;
  skillPaths: string[];
  disabledSkills: string[];
  trustedFolders: string[];
  folderTrustDecisions?: Record<string, boolean>;
  sessions: Record<
    string,
    { pinned?: boolean; archived?: boolean; title?: string }
  >;
  /** System notifications while the window is in the background (20261115-ui U6.1); on by default. */
  notifyPrefs?: { system?: boolean };
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
