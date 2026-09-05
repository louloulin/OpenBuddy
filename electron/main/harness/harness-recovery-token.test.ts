import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashHarnessRecoveryClaim,
  issueHarnessRecoveryClaim,
  verifyHarnessRecoveryClaim,
  verifyHarnessRecoveryClaimWithKeys,
  type HarnessRecoveryClaim,
} from "./harness-recovery-token";

describe("harness-recovery-token (issue/verify contract)", () => {
  const secret = "test-secret-1234567890";
  const identity = "agent-test-identity";
  let now = 0;
  beforeEach(() => { now = 1_730_000_000_000; });
  afterEach(() => { now = 0; });

  it("issues a verifiable claim that survives round-trip", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, {
      rpcId: "rpc-1",
      fingerprint: "abc-fingerprint",
      claimant: "loopback-ui",
    }, 60_000, now);
    const claim = verifyHarnessRecoveryClaim(token, secret, identity, now + 1_000);
    expect(claim).toBeDefined();
    expect(claim?.rpcId).toBe("rpc-1");
    expect(claim?.fingerprint).toBe("abc-fingerprint");
    expect(claim?.claimant).toBe("loopback-ui");
    expect(claim?.expiresAt).toBe(now + 60_000);
    expect(claim?.nonce).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects tokens with tampered body (signature mismatch)", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-2", fingerprint: "fp", claimant: "ui" }, 60_000, now);
    const [body, sig] = token.split(".");
    const tampered = `${body!.slice(0, -2)}xx.${sig}`;
    expect(verifyHarnessRecoveryClaim(tampered, secret, identity, now + 1_000)).toBeUndefined();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-3", fingerprint: "fp", claimant: "ui" }, 60_000, now);
    expect(verifyHarnessRecoveryClaim(token, "wrong-secret", identity, now + 1_000)).toBeUndefined();
  });

  it("rejects tokens whose identity does not match", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-4", fingerprint: "fp", claimant: "ui" }, 60_000, now);
    expect(verifyHarnessRecoveryClaim(token, secret, "different-identity", now + 1_000)).toBeUndefined();
  });

  it("rejects expired tokens", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-5", fingerprint: "fp", claimant: "ui" }, 1_000, now);
    expect(verifyHarnessRecoveryClaim(token, secret, identity, now + 5_000)).toBeUndefined();
  });

  it("enforces authority binding when caller supplies one", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, {
      rpcId: "rpc-6",
      fingerprint: "fp",
      claimant: "ui",
      authority: "loopback",
    }, 60_000, now);
    expect(verifyHarnessRecoveryClaim(token, secret, identity, now + 1_000)).toBeDefined();
    expect(verifyHarnessRecoveryClaim(token, secret, identity, now + 1_000, "trusted-host")).toBeUndefined();
    expect(verifyHarnessRecoveryClaim(token, secret, identity, now + 1_000, "loopback")).toBeDefined();
  });

  it("verifyHarnessRecoveryClaimWithKeys finds the matching key in a keyset", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-7", fingerprint: "fp", claimant: "ui" }, 60_000, now, "primary-key");
    const claim = verifyHarnessRecoveryClaimWithKeys(
      token,
      [
        { id: "primary-key", secret },
        { id: "secondary-key", secret: "other-secret" },
      ],
      identity,
      now + 1_000,
    );
    expect(claim).toBeDefined();
    expect(claim?.rpcId).toBe("rpc-7");
  });

  it("verifyHarnessRecoveryClaimWithKeys skips expired keys", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-8", fingerprint: "fp", claimant: "ui" }, 60_000, now, "expired-key");
    const claim = verifyHarnessRecoveryClaimWithKeys(
      token,
      [{ id: "expired-key", secret, expiresAt: now - 1 }],
      identity,
      now + 1_000,
    );
    expect(claim).toBeUndefined();
  });

  it("verifyHarnessRecoveryClaimWithKeys rejects tokens that name a different keyId", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-9", fingerprint: "fp", claimant: "ui" }, 60_000, now, "primary-key");
    const claim = verifyHarnessRecoveryClaimWithKeys(
      token,
      [{ id: "secondary-key", secret: "other-secret" }],
      identity,
      now + 1_000,
    );
    expect(claim).toBeUndefined();
  });

  it("hashHarnessRecoveryClaim is deterministic and 64-char hex", () => {
    const token = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-10", fingerprint: "fp", claimant: "ui" }, 60_000, now);
    const a = hashHarnessRecoveryClaim(token);
    const b = hashHarnessRecoveryClaim(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // Different tokens should produce different hashes
    const other = issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc-11", fingerprint: "fp2", claimant: "ui" }, 60_000, now);
    expect(hashHarnessRecoveryClaim(other)).not.toBe(a);
  });

  it("issueHarnessRecoveryClaim rejects missing required fields", () => {
    expect(() => issueHarnessRecoveryClaim(secret, identity, { rpcId: "", fingerprint: "fp", claimant: "ui" }, 60_000, now)).toThrow();
    expect(() => issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc", fingerprint: "", claimant: "ui" }, 60_000, now)).toThrow();
    expect(() => issueHarnessRecoveryClaim(secret, identity, { rpcId: "rpc", fingerprint: "fp", claimant: "" }, 60_000, now)).toThrow();
    expect(() => issueHarnessRecoveryClaim("", identity, { rpcId: "rpc", fingerprint: "fp", claimant: "ui" }, 60_000, now)).toThrow();
    expect(() => issueHarnessRecoveryClaim(secret, "", { rpcId: "rpc", fingerprint: "fp", claimant: "ui" }, 60_000, now)).toThrow();
  });

  it("verifyHarnessRecoveryClaim returns undefined for malformed tokens", () => {
    expect(verifyHarnessRecoveryClaim("", secret, identity, now)).toBeUndefined();
    expect(verifyHarnessRecoveryClaim("not-a-token", secret, identity, now)).toBeUndefined();
    expect(verifyHarnessRecoveryClaim("only.body", secret, identity, now)).toBeUndefined();
  });
});
