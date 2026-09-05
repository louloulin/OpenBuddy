import { describe, expect, it } from "vitest";
import { generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { encryptMetadata, encryptString, isEncryptedValue, loadEncryptionContext, summarizeEncryption } from "./encryption";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { format: "pem", type: "spki" }, privateKeyEncoding: { format: "pem", type: "pkcs8" } });
const context = loadEncryptionContext(publicKey)!;

function decryptForTest(ciphertext: string): string {
  const parts = ciphertext.replace("casdoor:v1:", "").split(":");
  const [wrappedKeyB64, ivB64, tagB64, bodyB64] = parts;
  const wrapped = Buffer.from(wrappedKeyB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const body = Buffer.from(bodyB64, "base64");
  const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, wrapped);
  const decipher = (require("node:crypto") as typeof import("node:crypto")).createDecipheriv("aes-256-gcm", aesKey, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

describe("Casdoor resource encryption layer (C2)", () => {
  it("round-trips a string through encryptString with a Casdoor public key", () => {
    const ciphertext = encryptString("api-key-12345", context);
    expect(isEncryptedValue(ciphertext)).toBe(true);
    expect(decryptForTest(ciphertext)).toBe("api-key-12345");
  });

  it("encrypts every string field except encryptedBy and non-strings", () => {
    const { metadata, encryptedFieldCount } = encryptMetadata(
      { encryptedBy: "casdoor", apiKey: "secret-1", region: "us-west-2", retries: 3, enabled: true, blank: "" },
      context,
    );
    expect(encryptedFieldCount).toBe(1);
    expect(metadata.encryptedBy).toBe("casdoor");
    expect(isEncryptedValue(metadata.apiKey)).toBe(true);
    expect(metadata.region).toBe("us-west-2");
    expect(metadata.retries).toBe(3);
    expect(metadata.enabled).toBe(true);
    expect(metadata.blank).toBe("");
  });

  it("leaves metadata untouched when no encryption context is configured", () => {
    const input = { apiKey: "plain" };
    const { metadata, encryptedFieldCount } = encryptMetadata(input, null);
    expect(metadata).toEqual(input);
    expect(encryptedFieldCount).toBe(0);
  });

  it("does not re-encrypt values that are already encrypted", () => {
    const first = encryptMetadata({ apiKey: "secret" }, context).metadata;
    const second = encryptMetadata(first, context);
    expect(second.encryptedFieldCount).toBe(0);
    expect(second.metadata.apiKey).toBe(first.apiKey);
  });

  it("summarizes encryption state for the renderer", () => {
    const { metadata } = encryptMetadata({ secret: "x" }, context);
    const summary = summarizeEncryption(metadata);
    expect(summary.enabled).toBe(true);
    expect(summary.encryptedFields).toEqual(["secret"]);
  });

  it("rejects an invalid PEM in loadEncryptionContext", () => {
    expect(() => loadEncryptionContext("not-a-pem")).toThrowError(/PEM/);
  });

  it("returns null when no public key is configured", () => {
    expect(loadEncryptionContext(undefined)).toBeNull();
    expect(loadEncryptionContext("")).toBeNull();
  });
});
