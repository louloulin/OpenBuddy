import { execFileSync } from "node:child_process";

const hasCertificateFile = Boolean(process.env.CSC_LINK);
const hasCertificateName = Boolean(process.env.CSC_NAME);
const hasNotaryApiKey = Boolean(
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER,
);
const hasNotaryAppleId = Boolean(
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID,
);
const hasNotaryKeychain = Boolean(
  process.env.APPLE_KEYCHAIN_PROFILE ||
  (process.env.APPLE_KEYCHAIN && process.env.APPLE_KEYCHAIN_PROFILE),
);

if (!hasCertificateFile && !hasCertificateName) {
  try {
    const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!identities.includes("Developer ID Application:")) {
      throw new Error("no Developer ID Application identity");
    }
  } catch {
    console.error(
      "macOS release requires an Apple Developer ID Application certificate. " +
      "Set CSC_LINK/CSC_KEY_PASSWORD (or install the certificate in the keychain and set CSC_NAME).",
    );
    process.exit(1);
  }
}

if (!hasNotaryApiKey && !hasNotaryAppleId && !hasNotaryKeychain) {
  console.error(
    "macOS release requires notarization credentials: " +
    "APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER, " +
    "APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID, " +
    "or APPLE_KEYCHAIN_PROFILE.",
  );
  process.exit(1);
}

console.info("macOS signing preflight passed: Developer ID certificate and notarization credentials are available.");
