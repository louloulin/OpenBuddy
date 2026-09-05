import { createHash, randomUUID } from "node:crypto";
import { decodeTokenBody, encodeTokenBody, tokenSignature, tokenSignatureMatches } from "./harness-token-codec";

export type HarnessRecoveryClaim = {
  rpcId: string;
  fingerprint: string;
  claimant: string;
  authority?: "trusted-host" | "loopback";
  nonce: string;
  expiresAt: number;
  keyId?: string;
};

function validClaim(value: unknown): value is HarnessRecoveryClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claim = value as Partial<HarnessRecoveryClaim>;
  return typeof claim.rpcId === "string" && claim.rpcId.length > 0
    && typeof claim.fingerprint === "string" && claim.fingerprint.length > 0
    && typeof claim.claimant === "string" && claim.claimant.length > 0
    && (claim.authority === undefined || claim.authority === "trusted-host" || claim.authority === "loopback")
    && typeof claim.nonce === "string" && claim.nonce.length > 0
    && (claim.keyId === undefined || (typeof claim.keyId === "string" && claim.keyId.length > 0))
    && Number.isSafeInteger(claim.expiresAt);
}

export function hashHarnessRecoveryClaim(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueHarnessRecoveryClaim(
  secret: string,
  identity: string,
  input: { rpcId: string; fingerprint: string; claimant: string; authority?: "trusted-host" | "loopback" },
  ttlMs = 10 * 60 * 1000,
  now = Date.now(),
  keyId?: string,
): string {
  if (!secret || !identity) throw new Error("Harness recovery claim secret and identity are required");
  if (!input.rpcId || !input.fingerprint || !input.claimant) throw new Error("Harness recovery claim fields are required");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error("Harness recovery claim TTL is invalid");
  const body = encodeTokenBody(JSON.stringify({
    version: 1,
    identity,
    claim: {
      rpcId: input.rpcId,
      fingerprint: input.fingerprint,
      claimant: input.claimant,
      ...(input.authority ? { authority: input.authority } : {}),
      ...(keyId ? { keyId } : {}),
      nonce: randomUUID(),
      expiresAt: now + ttlMs,
    } satisfies Omit<HarnessRecoveryClaim, never>,
  }));
  return `${body}.${tokenSignature(secret, body)}`;
}

export function verifyHarnessRecoveryClaim(
  token: string,
  secret: string,
  identity: string,
  now = Date.now(),
  authority?: "trusted-host" | "loopback",
): HarnessRecoveryClaim | undefined {
  if (!token || !secret || !identity) return undefined;
  const [body, provided] = token.split(".");
  if (!body || !provided) return undefined;
  if (!tokenSignatureMatches(tokenSignature(secret, body), provided)) return undefined;
  const decoded = decodeTokenBody(body);
  if (!decoded) return undefined;
  try {
    const value = JSON.parse(decoded) as { version?: unknown; identity?: unknown; claim?: unknown };
    if (value.version !== 1 || value.identity !== identity || !validClaim(value.claim)) return undefined;
    if (authority !== undefined && value.claim.authority !== authority) return undefined;
    if (value.claim.expiresAt <= now) return undefined;
    return value.claim;
  } catch {
    return undefined;
  }
}

export function verifyHarnessRecoveryClaimWithKeys(
  token: string,
  keys: readonly { id: string; secret: string; expiresAt?: number }[],
  identity: string,
  now = Date.now(),
  authority?: "trusted-host" | "loopback",
): HarnessRecoveryClaim | undefined {
  for (const key of keys) {
    if (!key.secret || (key.expiresAt !== undefined && key.expiresAt <= now)) continue;
    const claim = verifyHarnessRecoveryClaim(token, key.secret, identity, now, authority);
    if (claim && (claim.keyId === undefined || claim.keyId === key.id)) return claim;
  }
  return undefined;
}
