import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { closeStorage, openStorage, type OpenStorageResult } from "./open-storage";
import { SettingsRegistry } from "./settings";
import { isMissingSource, legacySourceError } from "../adapters/legacy-errors";
import { CredentialStore } from "../secrets/credential-store";
import type { SecretStore } from "../secrets/secret-store";

export type McpAuthStatus = "pending" | "authenticated" | "failed";

export interface McpAuthState {
  status: McpAuthStatus;
  error?: string;
  updatedAt: string;
}

export interface McpAuthCredential {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
}

export interface McpAuthStoreOptions {
  databasePath: string;
  secretStore: SecretStore;
  legacyPath?: string;
  now?: () => string;
}

type LegacyState = Record<string, McpAuthState & Partial<McpAuthCredential>>;

const stateKey = "state";
const importedKey = "legacy-imported";
const migrationKey = "legacy-import";

function credentialRef(serverName: string): string {
  return `mcp-oauth:${serverName}`;
}

function validState(value: unknown): value is McpAuthState {
  return Boolean(value && typeof value === "object" &&
    (value as { status?: unknown }).status &&
    ["pending", "authenticated", "failed"].includes(String((value as { status: unknown }).status)) &&
    typeof (value as { updatedAt?: unknown }).updatedAt === "string");
}

function stateDocument(value: unknown): Record<string, McpAuthState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP auth state must be an object");
  const result: Record<string, McpAuthState> = {};
  for (const [serverName, state] of Object.entries(value)) {
    if (!validState(state)) throw new Error(`MCP auth state is invalid for ${serverName}`);
    result[serverName] = { status: state.status, ...(state.error ? { error: state.error } : {}), updatedAt: state.updatedAt };
  }
  return result;
}

async function writeRedactedLegacy(path: string, state: Record<string, McpAuthState>): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class McpAuthStore {
  private storage?: Promise<OpenStorageResult>;
  private credentials?: CredentialStore;
  private imported = false;
  private importPromise?: Promise<void>;
  private readonly now: () => string;

  constructor(private readonly options: McpAuthStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private async result(): Promise<OpenStorageResult> {
    return this.storage ??= openStorage({ filePath: this.options.databasePath, appVersion: "openbuddy-mcp-auth" });
  }

  private async settings(): Promise<SettingsRegistry> {
    return new SettingsRegistry((await this.result()).driver, this.now);
  }

  private credentialStore(): CredentialStore {
    return this.credentials ??= new CredentialStore({ databasePath: this.options.databasePath, secretStore: this.options.secretStore, now: this.now });
  }

  private async importLegacyInternal(): Promise<void> {
    if (this.imported || !this.options.legacyPath) return;
    const settings = await this.settings();
    if (settings.getStrict("mcp-auth", importedKey)?.value === true) {
      this.imported = true;
      return;
    }
    await settings.setAsync("mcp-auth", migrationKey, { status: "pending", startedAt: this.now() });
    try {
      let legacy: LegacyState = {};
      try {
        const parsed = JSON.parse(await readFile(this.options.legacyPath, "utf8")) as LegacyState;
        stateDocument(parsed);
        legacy = parsed;
      } catch (error) {
        if (isMissingSource(error)) {
          await settings.setAsync("mcp-auth", importedKey, true);
          await settings.setAsync("mcp-auth", migrationKey, { status: "complete", completedAt: this.now() });
          this.imported = true;
          return;
        }
        throw legacySourceError("MCP auth", this.options.legacyPath, error);
      }
      const state: Record<string, McpAuthState> = {};
      for (const [serverName, value] of Object.entries(legacy)) {
        state[serverName] = { status: value.status, ...(value.error ? { error: value.error } : {}), updatedAt: value.updatedAt };
        if (value.accessToken) {
          await this.credentialStore().setRef(credentialRef(serverName), JSON.stringify({
            accessToken: value.accessToken,
            ...(value.refreshToken ? { refreshToken: value.refreshToken } : {}),
            ...(value.tokenType ? { tokenType: value.tokenType } : {}),
            ...(value.expiresAt ? { expiresAt: value.expiresAt } : {}),
          } satisfies McpAuthCredential));
        }
      }
      await settings.setAsync("mcp-auth", stateKey, state);
      await writeRedactedLegacy(this.options.legacyPath, state);
      await settings.setAsync("mcp-auth", importedKey, true);
      await settings.setAsync("mcp-auth", migrationKey, { status: "complete", completedAt: this.now() });
      this.imported = true;
    } catch (error) {
      await settings.setAsync("mcp-auth", migrationKey, { status: "failed", failedAt: this.now() }).catch(() => undefined);
      throw error;
    }
  }

  private async importLegacy(): Promise<void> {
    if (this.imported) return;
    if (this.importPromise) return this.importPromise;
    const pending = this.importLegacyInternal();
    this.importPromise = pending;
    try { await pending; } finally {
      if (this.importPromise === pending) this.importPromise = undefined;
    }
  }

  async getState(serverName: string): Promise<McpAuthState | undefined> {
    await this.importLegacy();
    const value = (await this.settings()).getStrict("mcp-auth", stateKey)?.value;
    const state = value === undefined ? {} : stateDocument(value);
    return validState(state[serverName]) ? state[serverName] : undefined;
  }

  async listStates(): Promise<Record<string, McpAuthState>> {
    await this.importLegacy();
    const value = (await this.settings()).getStrict("mcp-auth", stateKey)?.value;
    return value === undefined ? {} : stateDocument(value);
  }

  async mark(serverName: string, status: McpAuthStatus, error?: string): Promise<void> {
    await this.importLegacy();
    const state = await this.listStates();
    state[serverName] = { status, ...(error ? { error } : {}), updatedAt: this.now() };
    await (await this.settings()).setAsync("mcp-auth", stateKey, state);
  }

  async getCredential(serverName: string): Promise<McpAuthCredential | undefined> {
    await this.importLegacy();
    const value = await this.credentialStore().resolve(credentialRef(serverName));
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value) as McpAuthCredential;
      return typeof parsed.accessToken === "string" && parsed.accessToken ? parsed : undefined;
    } catch (error) {
      throw new Error(`MCP auth credential is malformed for ${serverName}`, { cause: error });
    }
  }

  async setCredential(serverName: string, credential: McpAuthCredential): Promise<void> {
    if (!credential.accessToken) throw new Error(`MCP auth access token is empty for ${serverName}`);
    await this.importLegacy();
    await this.credentialStore().setRef(credentialRef(serverName), JSON.stringify(credential));
    await this.mark(serverName, "authenticated");
  }

  async close(): Promise<void> {
    const credentials = this.credentials;
    this.credentials = undefined;
    if (credentials) await credentials.close();
    const storage = this.storage;
    this.storage = undefined;
    if (storage) await closeStorage(storage);
  }
}
