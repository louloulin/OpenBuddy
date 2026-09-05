import { describe, expect, it } from "vitest";
import { issueHarnessResumeToken, verifyHarnessResumeToken } from "./harness-resume-token";
import { issueHarnessRecoveryClaim, verifyHarnessRecoveryClaim, verifyHarnessRecoveryClaimWithKeys } from "./harness-recovery-token";

describe("Harness resume token", () => {
  it("binds a cursor to the identity and expiry", () => {
    const token = issueHarnessResumeToken("secret", "renderer", { sequence: 12, sessions: { s1: 4 } }, 1000, 100);
    expect(verifyHarnessResumeToken(token, "secret", "renderer", 500)).toEqual({ sequence: 12, sessions: { s1: 4 } });
    expect(verifyHarnessResumeToken(token, "secret", "other", 500)).toBeUndefined();
    expect(verifyHarnessResumeToken(token, "secret", "renderer", 1100)).toBeUndefined();
  });

  it("binds v2 tokens to a client audience for cross-device resume", () => {
    const token = issueHarnessResumeToken("secret", "host", { sessions: { s1: 4 } }, 1000, 100, "device-a");
    expect(verifyHarnessResumeToken(token, "secret", "host", 500, "device-a")).toEqual({ sessions: { s1: 4 } });
    expect(verifyHarnessResumeToken(token, "secret", "host", 500, "device-b")).toBeUndefined();
    expect(verifyHarnessResumeToken(token, "secret", "host", 500)).toBeUndefined();
  });

  it("rejects tampering and malformed cursors", () => {
    const token = issueHarnessResumeToken("secret", "renderer", { sequence: 12 }, 1000, 100);
    const [body, signature] = token.split(".");
    expect(verifyHarnessResumeToken(`${body}x.${signature}`, "secret", "renderer", 100)).toBeUndefined();
    expect(() => issueHarnessResumeToken("secret", "renderer", { sequence: -1 })).toThrow(/invalid/u);
  });

  it("binds a recovery claim to identity, rpc fingerprint, and expiry", () => {
    const token = issueHarnessRecoveryClaim("secret", "host", { rpcId: "rpc-1", fingerprint: "fp-1", claimant: "operator", authority: "trusted-host" }, 1000, 100);
    expect(verifyHarnessRecoveryClaim(token, "secret", "host", 500, "trusted-host")).toMatchObject({ rpcId: "rpc-1", fingerprint: "fp-1", claimant: "operator", authority: "trusted-host" });
    expect(verifyHarnessRecoveryClaim(token, "secret", "host", 500, "loopback")).toBeUndefined();
    expect(verifyHarnessRecoveryClaim(token, "secret", "other", 500)).toBeUndefined();
    expect(verifyHarnessRecoveryClaim(token, "secret", "host", 1100)).toBeUndefined();
    const [body, signature] = token.split(".");
    expect(verifyHarnessRecoveryClaim(`${body}x.${signature}`, "secret", "host", 100)).toBeUndefined();
  });

  it("supports current-key signing with a time-bounded verification grace key", () => {
    const token = issueHarnessRecoveryClaim("old-secret", "host", { rpcId: "rpc-rotate", fingerprint: "fp", claimant: "operator", authority: "loopback" }, 1000, 100, "old");
    expect(verifyHarnessRecoveryClaimWithKeys(token, [
      { id: "current", secret: "new-secret" },
      { id: "old", secret: "old-secret", expiresAt: 900 },
    ], "host", 500, "loopback")).toMatchObject({ keyId: "old", rpcId: "rpc-rotate" });
    expect(verifyHarnessRecoveryClaimWithKeys(token, [
      { id: "current", secret: "new-secret" },
      { id: "old", secret: "old-secret", expiresAt: 500 },
    ], "host", 500, "loopback")).toBeUndefined();
  });
});
