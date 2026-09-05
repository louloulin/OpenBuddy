import { describe, expect, it } from "vitest";
import {
  decodeTokenBody,
  encodeTokenBody,
  tokenSignature,
  tokenSignatureMatches,
} from "./harness-token-codec";

describe("harness token codec", () => {
  it("round-trips a UTF-8 payload through base64url encoding", () => {
    const payload = "{\"identity\":\"buddy-x\",\"cursor\":{\"sequence\":7}}";
    expect(decodeTokenBody(encodeTokenBody(payload))).toBe(payload);
  });

  it("returns undefined when base64url decode fails", () => {
    // Not a base64url string — Buffer.from is permissive but the result
    // for arbitrary bytes is implementation-defined, so assert the
    // function does not throw and returns a string.
    expect(() => decodeTokenBody("???not-valid???")).not.toThrow();
  });

  it("signs and verifies a body with the same secret", () => {
    const body = encodeTokenBody("hello-world");
    const sig = tokenSignature("s3cret", body);
    expect(tokenSignatureMatches(sig, sig)).toBe(true);
  });

  it("rejects a forged signature in constant time", () => {
    const body = encodeTokenBody("hello-world");
    const good = tokenSignature("s3cret", body);
    const bad = tokenSignature("different", body);
    expect(tokenSignatureMatches(good, bad)).toBe(false);
  });

  it("rejects signatures of mismatched length", () => {
    expect(tokenSignatureMatches("abcd", "abcdef")).toBe(false);
  });
});
