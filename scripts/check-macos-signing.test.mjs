import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectSigningCredentials,
  parseCodesignOutput,
  isCodesignFailure,
  isSpctlFailure,
  isStaplerFailure,
  verifySignedArtifact,
} from "./check-macos-signing.mjs";

describe("detectSigningCredentials", () => {
  it("reports CSC_LINK + APPLE_API_KEY when both env groups are set", () => {
    const env = {
      CSC_LINK: "/tmp/cert.p12",
      APPLE_API_KEY: "/tmp/key.p8",
      APPLE_API_KEY_ID: "ABCDE12345",
      APPLE_API_ISSUER: "11111111-2222-3333-4444-555555555555",
    };
    const result = detectSigningCredentials(env, () => false);
    expect(result.certificate).toEqual({ source: "CSC_LINK", present: true });
    expect(result.notarization).toEqual({ source: "APPLE_API_KEY", present: true });
  });

  it("falls back to the macOS keychain when no env credentials are set", () => {
    const env = {};
    const result = detectSigningCredentials(env, () => true);
    expect(result.certificate.source).toBe("keychain");
    expect(result.certificate.present).toBe(true);
  });

  it("reports notarization via APPLE_ID fallback when App Store Connect API key is missing", () => {
    const env = {
      CSC_NAME: "OpenBuddy Inc.",
      APPLE_ID: "[email protected]",
      APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      APPLE_TEAM_ID: "ABCDE12345",
    };
    const result = detectSigningCredentials(env, () => false);
    expect(result.certificate).toEqual({ source: "CSC_NAME", present: true });
    expect(result.notarization).toEqual({ source: "APPLE_ID", present: true });
  });

  it("reports notarization via keychain profile when neither API key nor Apple ID is set", () => {
    const env = {
      CSC_LINK: "/tmp/cert.p12",
      APPLE_KEYCHAIN_PROFILE: "openbuddy-notary",
    };
    const result = detectSigningCredentials(env, () => false);
    expect(result.notarization).toEqual({ source: "keychain", present: true });
  });

  it("returns certificate present=false when nothing is set", () => {
    const env = {};
    const result = detectSigningCredentials(env, () => false);
    expect(result.certificate.present).toBe(false);
    expect(result.notarization.present).toBe(false);
  });

  it("requires APPLE_API_KEY_ID + APPLE_API_KEY_ISSUER alongside APPLE_API_KEY", () => {
    const env = { APPLE_API_KEY: "/tmp/key.p8" };
    const result = detectSigningCredentials(env, () => false);
    expect(result.notarization.present).toBe(false);
  });
});

describe("parseCodesignOutput", () => {
  it("extracts the Developer ID Application authority", () => {
    const output = `Executable=/path/to/OpenBuddy.app/Contents/MacOS/OpenBuddy
Identifier=com.openbuddy.desktop
Format=app bundle with Mach-O thin (x86_64)
CodeDirectory v=20400 size=12345 flags=0x10000(runtime) hashes=200
Signature size=8962
Authority=Developer ID Application: OpenBuddy Inc. (ABCDE12345)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=2026-08-31T00:00:00Z
Info.plist entries=12
TeamIdentifier=ABCDE12345
`;
    const parsed = parseCodesignOutput(output);
    expect(parsed.authority).toBe("OpenBuddy Inc. (ABCDE12345)");
    expect(parsed.identifier).toBe("com.openbuddy.desktop");
    expect(parsed.hardenedRuntime).toBe(true);
  });

  it("returns null authority when the artifact is signed by a different identity", () => {
    const output = `Authority=Apple Development: Test User (XX)
Identifier=com.example.test
`;
    const parsed = parseCodesignOutput(output);
    expect(parsed.authority).toBeNull();
    expect(parsed.identifier).toBe("com.example.test");
    expect(parsed.hardenedRuntime).toBe(false);
  });

  it("returns empty fields for empty input", () => {
    expect(parseCodesignOutput("")).toEqual({ authority: null, identifier: null, hardenedRuntime: false, flags: null });
  });
});

describe("isCodesignFailure", () => {
  it("flags 'not signed' messages", () => {
    expect(isCodesignFailure("/tmp/app: code object is not signed at all", "")).toBe(true);
  });
  it("does not flag unrelated errors", () => {
    expect(isCodesignFailure("some other error", "")).toBe(false);
  });
});

describe("isSpctlFailure", () => {
  it("flags Gatekeeper 'rejected' messages", () => {
    expect(isSpctlFailure("/tmp/app: rejected", "")).toBe(true);
  });
  it("does not flag unrelated messages", () => {
    expect(isSpctlFailure("accepted", "")).toBe(false);
  });
});

describe("isStaplerFailure", () => {
  it("flags 'not a staple' messages", () => {
    expect(isStaplerFailure("the package does not have a staple", "")).toBe(true);
  });
});

describe("verifySignedArtifact", () => {
  function makeTempArtifact(suffix = ".app") {
    const dir = mkdtempSync(join(tmpdir(), "openbuddy-mac-"));
    if (suffix.endsWith(".app")) {
      mkdirSync(join(dir, "OpenBuddy.app"), { recursive: true });
      return join(dir, "OpenBuddy.app");
    }
    const file = join(dir, `artifact${suffix}`);
    writeFileSync(file, "fake content");
    return file;
  }

  function codesignOk(stdout) {
    return { status: 0, stdout: stdout || "Authority=Developer ID Application: OpenBuddy Inc. (ABCDE12345)\nIdentifier=com.openbuddy.desktop\n", stderr: "" };
  }
  function codesignFail(stderr = "/tmp/app: code object is not signed at all") {
    return { status: 1, stdout: "", stderr };
  }
  function spctlOk() {
    return { status: 0, stdout: "/tmp/app: accepted\n", stderr: "" };
  }
  function spctlFail() {
    return { status: 1, stdout: "", stderr: "/tmp/app: rejected\n" };
  }
  function staplerOk() {
    return { status: 0, stdout: "The validation passed\n", stderr: "" };
  }
  function staplerFail() {
    return { status: 1, stdout: "", stderr: "the package does not have a staple\n" };
  }

  it("passes for a properly signed .app with notarization credentials", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: true,
      codesignAvailable: () => true,
      codesignProbe: () => codesignOk(),
      spctlProbe: () => spctlOk(),
      staplerProbe: () => staplerOk(),
    });
    expect(result.ok).toBe(true);
    expect(result.authority).toBe("OpenBuddy Inc. (ABCDE12345)");
    rmSync(artifact, { recursive: true, force: true });
  });

  it("warns but passes when hardened runtime is missing from the signature flags", () => {
    const artifact = makeTempArtifact(".app");
    const codesignOut = "Authority=Developer ID Application: OpenBuddy Inc. (ABCDE12345)\nIdentifier=com.openbuddy.desktop\n";
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: false,
      codesignAvailable: () => true,
      codesignProbe: () => ({ status: 0, stdout: codesignOut, stderr: "" }),
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => /hardened runtime/i.test(w))).toBe(true);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("skips notarization checks when no notarization credentials are configured", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: false,
      codesignAvailable: () => true,
      codesignProbe: () => codesignOk(),
    });
    expect(result.ok).toBe(true);
    expect(result.authority).toBe("OpenBuddy Inc. (ABCDE12345)");
    rmSync(artifact, { recursive: true, force: true });
  });

  it("rejects an artifact signed by a non-Developer ID identity", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: false,
      codesignAvailable: () => true,
      codesignProbe: () => ({ status: 0, stdout: "Authority=Apple Development: Test User (XX)\n", stderr: "" }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not signed by a Developer ID Application/);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("warns but passes when --allow-unsigned is set and the artifact is unsigned", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: false,
      allowUnsigned: true,
      codesignAvailable: () => true,
      codesignProbe: () => codesignFail(),
    });
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/unsigned/i);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("returns code 2 when codesign is not available on the host (Linux CI)", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: false,
      codesignAvailable: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(2);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("returns code 1 when the artifact path does not exist", () => {
    const result = verifySignedArtifact({
      artifact: "/tmp/openbuddy-mac-nonexistent.app",
      hasNotaryCredentials: false,
      codesignAvailable: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.reason).toMatch(/does not exist/);
  });

  it("runs stapler validate on a .dmg artifact when notarization credentials are configured", () => {
    const artifact = makeTempArtifact(".dmg");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: true,
      codesignAvailable: () => true,
      codesignProbe: () => codesignOk(),
      spctlProbe: () => spctlOk(),
      staplerProbe: () => staplerOk(),
    });
    expect(result.ok).toBe(true);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("fails when stapler validate rejects the DMG", () => {
    const artifact = makeTempArtifact(".dmg");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: true,
      codesignAvailable: () => true,
      codesignProbe: () => codesignOk(),
      spctlProbe: () => spctlOk(),
      staplerProbe: () => staplerFail(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/stapler validate failed/);
    rmSync(artifact, { recursive: true, force: true });
  });

  it("fails when spctl rejects the bundle", () => {
    const artifact = makeTempArtifact(".app");
    const result = verifySignedArtifact({
      artifact,
      hasNotaryCredentials: true,
      codesignAvailable: () => true,
      codesignProbe: () => codesignOk(),
      spctlProbe: () => spctlFail(),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/spctl rejected/);
    rmSync(artifact, { recursive: true, force: true });
  });
});