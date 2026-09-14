/** Marketplace package signature and trusted-root verification. */
import { createVerify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentRoot, readJson, writeJson } from "./shared";

export interface MarketplaceTrustedRoot { keyId: string; publicKeyPem: string; }
export interface MarketplaceSignature { algorithm: "RSA-SHA256" | "ECDSA-SHA256"; keyId: string; signature: string; }
export interface MarketplaceTrustConfig { roots: MarketplaceTrustedRoot[]; requireSignedRemote: boolean; }

const defaultConfig: MarketplaceTrustConfig = { roots: [], requireSignedRemote: true };
const configPath = () => join(agentRoot(), "marketplace-trust.json");

export async function readMarketplaceTrustConfig(): Promise<MarketplaceTrustConfig> {
  const raw = await readJson<Partial<MarketplaceTrustConfig>>(configPath(), {});
  const roots = Array.isArray(raw.roots) ? raw.roots.filter((root): root is MarketplaceTrustedRoot => Boolean(root) && typeof root.keyId === "string" && typeof root.publicKeyPem === "string") : [];
  return { roots, requireSignedRemote: raw.requireSignedRemote !== false };
}

export async function writeMarketplaceTrustConfig(config: MarketplaceTrustConfig): Promise<MarketplaceTrustConfig> {
  const roots = [...new Map(config.roots.filter((root) => root.keyId.trim() && root.publicKeyPem.includes("BEGIN PUBLIC KEY")).map((root) => [root.keyId.trim(), { keyId: root.keyId.trim(), publicKeyPem: root.publicKeyPem }])).values()];
  const next = { roots, requireSignedRemote: config.requireSignedRemote !== false };
  await writeJson(configPath(), next, 0o600);
  return next;
}

function canonicalManifest(manifest: Record<string, unknown>): string {
  const copy = { ...manifest };
  const openbuddy = copy.openbuddy;
  if (openbuddy && typeof openbuddy === "object" && !Array.isArray(openbuddy)) {
    const namespace = { ...(openbuddy as Record<string, unknown>) };
    delete namespace.signature;
    copy.openbuddy = namespace;
  }
  return JSON.stringify(copy, Object.keys(copy).sort());
}

export async function verifyMarketplacePackage(root: string, remote: boolean): Promise<{ verified: boolean; keyId?: string; reason?: string }> {
  const config = await readMarketplaceTrustConfig();
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
  const openbuddy = manifest.openbuddy;
  const signature = openbuddy && typeof openbuddy === "object" && !Array.isArray(openbuddy) ? (openbuddy as Record<string, unknown>).signature : undefined;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    if (remote && config.requireSignedRemote) return { verified: false, reason: "remote marketplace package is unsigned" };
    return { verified: true, reason: "local package signature is optional" };
  }
  const value = signature as Record<string, unknown>;
  if ((value.algorithm !== "RSA-SHA256" && value.algorithm !== "ECDSA-SHA256") || typeof value.keyId !== "string" || typeof value.signature !== "string") return { verified: false, reason: "invalid package signature metadata" };
  const rootKey = config.roots.find((entry) => entry.keyId === value.keyId);
  if (!rootKey) return { verified: false, reason: `untrusted signing key: ${value.keyId}` };
  const verifier = createVerify(value.algorithm === "RSA-SHA256" ? "RSA-SHA256" : "SHA256");
  verifier.update(canonicalManifest(manifest));
  verifier.end();
  return verifier.verify(rootKey.publicKeyPem, Buffer.from(value.signature, "base64")) ? { verified: true, keyId: value.keyId } : { verified: false, reason: "package signature verification failed" };
}
