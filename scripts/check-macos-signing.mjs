#!/usr/bin/env node
// scripts/check-macos-signing.mjs
//
// Two modes:
//
// 1. Preflight (default, no args)
//    - Checks that signing/notarization credentials are present in env
//      OR a Developer ID certificate is installed in the macOS keychain.
//    - Used by moon's `openbuddy:electron.build.mac` task to fail fast
//      before electron-builder runs.
//
// 2. Verify (--verify <artifact-path>)
//    - Runs `codesign -dv` against the produced `.app` / `.dmg`.
//    - Confirms the signature is a "Developer ID Application".
//    - When notarization credentials are present, also runs
//      `spctl --assess` and `xcrun stapler validate`.
//    - Returns non-zero if the artifact is unsigned, signed by the wrong
//      identity, or not notarized. CI surfaces this as a hard failure.
//
// Exit codes:
//   0 = pass
//   1 = signing credentials missing OR artifact failed verification
//   2 = codesign / spctl / stapler binary missing (caller may treat as
//       "skip, not running on macOS")
//
// Usage in CI:
//   node scripts/check-macos-signing.mjs                          # preflight
//   node scripts/check-macos-signing.mjs --verify release/mac-arm64/OpenBuddy.app

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const SIGN_ENV = {
  CSC_LINK: "CSC_LINK",
  CSC_NAME: "CSC_NAME",
  APPLE_API_KEY: "APPLE_API_KEY",
  APPLE_API_KEY_ID: "APPLE_API_KEY_ID",
  APPLE_API_ISSUER: "APPLE_API_ISSUER",
  APPLE_ID: "APPLE_ID",
  APPLE_APP_SPECIFIC_PASSWORD: "APPLE_APP_SPECIFIC_PASSWORD",
  APPLE_TEAM_ID: "APPLE_TEAM_ID",
  APPLE_KEYCHAIN_PROFILE: "APPLE_KEYCHAIN_PROFILE",
  APPLE_KEYCHAIN: "APPLE_KEYCHAIN",
};

// ---------------------------------------------------------------------------
// Pure helpers — exported so they can be unit-tested on any platform.
// ---------------------------------------------------------------------------

export function detectSigningCredentials(env = process.env, lookInKeychain = () => false) {
  const certificate = {
    source: null,
    present: false,
  };
  if (env[SIGN_ENV.CSC_LINK]) {
    certificate.source = "CSC_LINK";
    certificate.present = true;
  } else if (env[SIGN_ENV.CSC_NAME]) {
    certificate.source = "CSC_NAME";
    certificate.present = true;
  } else if (lookInKeychain()) {
    certificate.source = "keychain";
    certificate.present = true;
  }

  const notarization = {
    source: null,
    present: false,
  };
  if (env[SIGN_ENV.APPLE_API_KEY] && env[SIGN_ENV.APPLE_API_KEY_ID] && env[SIGN_ENV.APPLE_API_ISSUER]) {
    notarization.source = "APPLE_API_KEY";
    notarization.present = true;
  } else if (
    env[SIGN_ENV.APPLE_ID] &&
    env[SIGN_ENV.APPLE_APP_SPECIFIC_PASSWORD] &&
    env[SIGN_ENV.APPLE_TEAM_ID]
  ) {
    notarization.source = "APPLE_ID";
    notarization.present = true;
  } else if (env[SIGN_ENV.APPLE_KEYCHAIN_PROFILE] || (env[SIGN_ENV.APPLE_KEYCHAIN] && env[SIGN_ENV.APPLE_KEYCHAIN_PROFILE])) {
    notarization.source = "keychain";
    notarization.present = true;
  }

  return { certificate, notarization };
}

export function parseCodesignOutput(output) {
  const text = `${output || ""}`;
  // `codesign -dv` writes most fields on their own line, but the
  // `flags=` token appears inside the `CodeDirectory v=… size=… flags=…`
  // line. Match anywhere on a line to handle both layouts.
  const authorityMatch = text.match(/^Authority=Developer ID Application:\s*(.+)$/m);
  const identifierMatch = text.match(/^Identifier=(.+)$/m);
  const flagsMatch = text.match(/(?:^|\s)flags=(.*)$/m);
  // `codesign -dv` exposes hardened runtime either as the literal
  // `hard` / `hardened` flag name (older toolchains) or as `runtime`
  // (newer toolchains, where `0x10000` is the bitmask). Accept both.
  const hardenedRuntime = flagsMatch ? /\bhard(?:ened)?\b|\bruntime\b/i.test(flagsMatch[1]) : false;
  return {
    authority: authorityMatch ? authorityMatch[1].trim() : null,
    identifier: identifierMatch ? identifierMatch[1].trim() : null,
    hardenedRuntime,
    flags: flagsMatch ? flagsMatch[1].trim() : null,
  };
}

export function isCodesignFailure(stderr, stdout) {
  const detail = `${stderr || ""} ${stdout || ""}`;
  return /not signed/i.test(detail) || /code object is not signed/i.test(detail);
}

export function isSpctlFailure(stderr, stdout) {
  const detail = `${stderr || ""} ${stdout || ""}`;
  return /rejected/i.test(detail);
}

export function isStaplerFailure(stderr, stdout) {
  const detail = `${stderr || ""} ${stdout || ""}`;
  return /not a staple/i.test(detail) || /does not have a staple/i.test(detail);
}

// ---------------------------------------------------------------------------
// Glue: spawn wrappers used in verify mode. Exported for tests via dependency
// injection so we can stub them on non-macOS hosts.
// ---------------------------------------------------------------------------

export function defaultKeychainProbe() {
  try {
    const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return identities.includes("Developer ID Application:");
  } catch {
    return false;
  }
}

export function defaultCodesignVersion() {
  return spawnSync("codesign", ["--version"], { encoding: "utf8" }).status === 0;
}

export function runCodesignVerify(artifact) {
  return spawnSync("codesign", ["-dv", artifact], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function runSpctlAssess(artifact) {
  return spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=2", artifact], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function runStaplerValidate(artifact) {
  return spawnSync("xcrun", ["stapler", "validate", artifact], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ---------------------------------------------------------------------------
// Verify orchestration — exported so it can be unit-tested with stubbed
// spawn functions.
// ---------------------------------------------------------------------------

export function verifySignedArtifact({
  artifact,
  hasNotaryCredentials,
  allowUnsigned = false,
  codesignAvailable = defaultCodesignVersion,
  codesignProbe = runCodesignVerify,
  spctlProbe = runSpctlAssess,
  staplerProbe = runStaplerValidate,
} = {}) {
  if (!artifact) {
    return { ok: false, code: 1, reason: "missing artifact path" };
  }
  const absolute = resolve(artifact);
  if (!existsSync(absolute)) {
    return { ok: false, code: 1, reason: `artifact does not exist: ${absolute}` };
  }
  const stat = statSync(absolute);
  if (!stat.isFile() && !stat.isDirectory()) {
    return { ok: false, code: 1, reason: `artifact is not a file or .app bundle: ${absolute}` };
  }
  if (!codesignAvailable()) {
    return { ok: false, code: 2, reason: "codesign not available on this host (not running on macOS)" };
  }
  const codesignResult = codesignProbe(absolute);
  const codesignOutput = `${codesignResult.stdout || ""}\n${codesignResult.stderr || ""}`;
  if (codesignResult.status !== 0) {
    if (allowUnsigned && isCodesignFailure(codesignResult.stderr, codesignResult.stdout)) {
      return { ok: true, code: 0, warning: "artifact is unsigned; --allow-unsigned accepts it", output: codesignOutput };
    }
    return { ok: false, code: 1, reason: `codesign -dv failed: ${codesignOutput.trim()}`, output: codesignOutput };
  }
  const parsed = parseCodesignOutput(codesignOutput);
  if (!parsed.authority) {
    if (allowUnsigned) {
      return { ok: true, code: 0, warning: "artifact is not signed by a Developer ID Application; --allow-unsigned accepts it", output: codesignOutput };
    }
    return { ok: false, code: 1, reason: "artifact is not signed by a Developer ID Application identity", output: codesignOutput };
  }
  const warnings = [];
  if (!parsed.hardenedRuntime) {
    warnings.push("hardened runtime does not appear to be set on the signature flags");
  }
  if (!hasNotaryCredentials) {
    return { ok: true, code: 0, authority: parsed.authority, warnings: warnings.concat(["notarization credentials not configured, skipping notarization checks"]) };
  }
  const spctlResult = spctlProbe(absolute);
  if (spctlResult.status !== 0) {
    if (allowUnsigned && isSpctlFailure(spctlResult.stderr, spctlResult.stdout)) {
      return { ok: true, code: 0, authority: parsed.authority, warning: "spctl rejected the bundle; --allow-unsigned accepts it", warnings };
    }
    return { ok: false, code: 1, reason: `spctl rejected the bundle: ${(spctlResult.stderr || spctlResult.stdout || "").trim()}` };
  }
  if (absolute.endsWith(".dmg") || absolute.endsWith(".pkg")) {
    const staplerResult = staplerProbe(absolute);
    if (staplerResult.status !== 0) {
      if (allowUnsigned && isStaplerFailure(staplerResult.stderr, staplerResult.stdout)) {
        return { ok: true, code: 0, authority: parsed.authority, warning: "stapler reported no staple; --allow-unsigned accepts it", warnings };
      }
      return { ok: false, code: 1, reason: `stapler validate failed: ${(staplerResult.stderr || staplerResult.stdout || "").trim()}` };
    }
  }
  return { ok: true, code: 0, authority: parsed.authority, warnings };
}

// ---------------------------------------------------------------------------
// CLI entry point. When this file is required as a module (e.g. from tests),
// the CLI block is skipped via the `isMainModule` guard.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";

export function isMain(meta = import.meta) {
  if (!meta || !meta.url) return false;
  return meta.url === `file://${process.argv[1]}` || fileURLToPath(meta.url) === resolve(process.argv[1] || "");
}

if (isMain(import.meta)) {
  const cliArgs = process.argv.slice(2);
  let verifyMode = false;
  let verifyArtifact = "";
  let allowUnsigned = false;

  for (let i = 0; i < cliArgs.length; i += 1) {
    const arg = cliArgs[i];
    if (arg === "--verify") {
      verifyMode = true;
      const next = cliArgs[i + 1];
      if (!next || next.startsWith("--")) {
        console.error("--verify requires an artifact path");
        process.exit(1);
      }
      verifyArtifact = resolve(next);
      i += 1;
    } else if (arg === "--allow-unsigned") {
      // CI may run on a fork where Apple secrets are not configured.
      // In that case, signing is skipped on purpose and verify must
      // accept the unsigned artifact as a warning rather than an error.
      allowUnsigned = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: check-macos-signing.mjs [--verify <path>] [--allow-unsigned]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  const credentials = detectSigningCredentials(process.env, defaultKeychainProbe);
  if (!credentials.certificate.present) {
    console.error(
      "macOS release requires an Apple Developer ID Application certificate. " +
      "Set CSC_LINK/CSC_KEY_PASSWORD (or install the certificate in the keychain and set CSC_NAME).",
    );
    process.exit(1);
  }
  if (!credentials.notarization.present) {
    console.error(
      "macOS release requires notarization credentials: " +
      "APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, " +
      "APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, " +
      "or APPLE_KEYCHAIN_PROFILE.",
    );
    process.exit(1);
  }

  console.info(
    `macOS signing preflight passed: Developer ID certificate (${credentials.certificate.source}) ` +
      `+ notarization credentials (${credentials.notarization.source}).`,
  );

  if (!verifyMode) {
    process.exit(0);
  }

  const result = verifySignedArtifact({
    artifact: verifyArtifact,
    hasNotaryCredentials: credentials.notarization.present,
    allowUnsigned,
  });
  if (!result.ok) {
    if (result.warning) {
      console.warn(`verify: ${result.warning}`);
      process.exit(0);
    }
    if (result.warnings && result.warnings.length > 0) {
      for (const w of result.warnings) console.warn(`verify: ${w}`);
    }
    console.error(result.reason || "verify failed");
    process.exit(result.code);
  }
  if (result.authority) {
    console.info(`verify: Developer ID Application signature detected (${result.authority})`);
  }
  if (result.warnings) {
    for (const w of result.warnings) console.warn(`verify: ${w}`);
  }
  if (result.warning) {
    console.warn(`verify: ${result.warning}`);
  }
  console.info(`macOS signing verify passed for ${verifyArtifact}`);
  process.exit(0);
}