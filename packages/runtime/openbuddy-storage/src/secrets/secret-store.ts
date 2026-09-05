export interface SecretRef {
  ref: string;
  provider: string;
  label?: string;
}

export interface SecretStore {
  put(ref: string, value: string, metadata?: { label?: string }): Promise<SecretRef>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

export interface PlatformSecretStoreOptions extends KeychainSecretStoreOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  testMode?: boolean;
}

export class UnsupportedSecretStore implements SecretStore {
  constructor(private readonly provider = "os-keychain") {}

  async put(ref: string, _value: string, metadata?: { label?: string }): Promise<SecretRef> {
    throw new Error(`Secret provider ${this.provider} is not configured for ${metadata?.label ?? ref}`);
  }

  async get(_ref: string): Promise<string | undefined> {
    throw new Error(`Secret provider ${this.provider} is not configured`);
  }

  async delete(_ref: string): Promise<void> {
    throw new Error(`Secret provider ${this.provider} is not configured`);
  }
}

export class EphemeralSecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async put(ref: string, value: string, metadata?: { label?: string }): Promise<SecretRef> {
    this.values.set(ref, value);
    return { ref, provider: "ephemeral", ...(metadata?.label ? { label: metadata.label } : {}) };
  }

  async get(ref: string): Promise<string | undefined> {
    return this.values.get(ref);
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }
}

export interface KeychainSecretStoreOptions {
  service?: string;
}

export class PlatformKeychainSecretStore implements SecretStore {
  private readonly service: string;

  constructor(options: KeychainSecretStoreOptions = {}) {
    this.service = options.service ?? "OpenBuddy";
  }

  async put(ref: string, value: string, metadata?: { label?: string }): Promise<SecretRef> {
    if (process.platform !== "darwin") throw new Error("Platform keychain provider is only configured for macOS");
    await execFileAsync("security", ["add-generic-password", "-U", "-a", ref, "-s", this.service, "-w", value, ...(metadata?.label ? ["-j", metadata.label] : [])]);
    return { ref, provider: "macos-keychain", ...(metadata?.label ? { label: metadata.label } : {}) };
  }

  async get(ref: string): Promise<string | undefined> {
    if (process.platform !== "darwin") throw new Error("Platform keychain provider is only configured for macOS");
    try {
      const result = await execFileAsync("security", ["find-generic-password", "-a", ref, "-s", this.service, "-w"]);
      return result.stdout.trim() || undefined;
    } catch (error) {
      const message = String(error);
      if (message.includes("could not be found") || message.includes("SecKeychainSearchCopyNext")) return undefined;
      throw error;
    }
  }

  async delete(ref: string): Promise<void> {
    if (process.platform !== "darwin") throw new Error("Platform keychain provider is only configured for macOS");
    try { await execFileAsync("security", ["delete-generic-password", "-a", ref, "-s", this.service]); } catch (error) {
      if (!String(error).includes("could not be found")) throw error;
    }
  }
}

/**
 * Selects the only provider allowed for a runtime profile. Unsupported
 * production platforms fail closed instead of falling back to plain files.
 */
export function createPlatformSecretStore(options: PlatformSecretStoreOptions = {}): SecretStore {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  if (options.testMode ?? environment.NODE_ENV === "test") return new EphemeralSecretStore();
  if (platform === "darwin") return new PlatformKeychainSecretStore({ service: options.service });
  return new UnsupportedSecretStore("os-keychain");
}
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
