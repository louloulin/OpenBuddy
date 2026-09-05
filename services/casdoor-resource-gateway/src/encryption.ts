import { createPublicKey, publicEncrypt, constants, randomBytes, createCipheriv } from "node:crypto";

const ENCRYPTION_PREFIX = "casdoor:v1:";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SENSITIVE_METADATA_KEY = /(api.?key|secret|password|token|credential|private.?key|access.?key|client.?secret)/i;

/**
 * Public-key encryption layer for the Casdoor resource gateway.
 *
 * Use case: an enterprise admin wants "static encryption at rest" for sensitive
 * resource metadata. They paste a Casdoor-issued RSA public key into the
 * gateway's environment (RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY, PEM), and from
 * then on any resource whose metadata carries `encryptedBy: "casdoor"` will
 * have its string values encrypted before the gateway writes them to its
 * store. The cleartext is unrecoverable without the Casdoor private key,
 * which only the Casdoor control plane (or a designated recovery admin) holds.
 *
 * Wire format for an encrypted value:
 *   "casdoor:v1:<base64 RSA-wrapped AES key>:<base64 IV>:<base64 auth tag>:<base64 ciphertext>"
 *
 * We wrap a fresh AES-256-GCM session key with RSA-OAEP (SHA-256) so we can
 * encrypt arbitrarily long payloads without blowing past RSA size limits.
 */

export interface EncryptionContext {
  publicKeyPem: string;
}

export function loadEncryptionContext(publicKeyPem: string | undefined): EncryptionContext | null {
  if (!publicKeyPem || !publicKeyPem.trim()) return null;
  try {
    createPublicKey(publicKeyPem);
    return { publicKeyPem: publicKeyPem.trim() };
  } catch {
    throw new Error("RESOURCE_GATEWAY_CASDOOR_PUBLIC_KEY 不是有效的 PEM 公钥");
  }
}

export function isEncryptedValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptString(plaintext: string, context: EncryptionContext): string {
  const key = randomBytes(32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const wrappedKey = publicEncrypt(
    { key: context.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    key,
  );
  return [
    ENCRYPTION_PREFIX,
    wrappedKey.toString("base64"),
    ":",
    iv.toString("base64"),
    ":",
    authTag.toString("base64"),
    ":",
    ciphertext.toString("base64"),
  ].join("");
}

export function encryptMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
  context: EncryptionContext | null,
): { metadata: Record<string, string | number | boolean | null>; encryptedFieldCount: number } {
  if (!metadata) return { metadata: {}, encryptedFieldCount: 0 };
  if (!context) return { metadata, encryptedFieldCount: 0 };
  const out: Record<string, string | number | boolean | null> = {};
  let encryptedFieldCount = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string" || isEncryptedValue(value)) {
      out[key] = value;
      continue;
    }
    if (key === "encryptedBy" || !SENSITIVE_METADATA_KEY.test(key)) {
      out[key] = value;
      continue;
    }
    out[key] = encryptString(value, context);
    encryptedFieldCount += 1;
  }
  return { metadata: out, encryptedFieldCount };
}

export function summarizeEncryption(metadata: Record<string, string | number | boolean | null> | undefined): { enabled: boolean; encryptedFields: string[] } {
  if (!metadata) return { enabled: false, encryptedFields: [] };
  const encryptedFields = Object.keys(metadata).filter((key) => key !== "encryptedBy" && isEncryptedValue(metadata[key]));
  const enabled = metadata.encryptedBy === "casdoor" || encryptedFields.length > 0;
  return { enabled, encryptedFields };
}
