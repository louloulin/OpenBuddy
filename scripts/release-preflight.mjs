#!/usr/bin/env node
/**
 * Local, credential-free release/smoke preflight.
 *
 * This is intentionally a static/local gate: it never signs, notarizes,
 * publishes, contacts a provider, or contacts GitHub. It verifies that the
 * checked-out release contract and built Electron inputs are complete, and
 * records why desktop smoke can or cannot run in this environment.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = process.argv.find((arg) => arg.startsWith("--json="))?.slice(7)
  ?? "evidence/release/release-preflight.json";
const reportFile = resolve(root, reportPath);
const checks = [];
const check = (name, ok, details = {}) => {
  checks.push({ name, ok, ...details });
  return ok;
};
const fileText = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";

const packageJson = JSON.parse(fileText(join(root, "package.json")) || "{}");
const builder = fileText(join(root, "electron-builder.yml"));
const workflow = fileText(join(root, ".github/workflows/release.yml"));
const requiredFiles = [
  "out/main/index.js",
  "out/preload/index.cjs",
  "out/renderer/index.html",
  "electron-builder.yml",
  ".github/workflows/release.yml",
];
for (const relative of requiredFiles) {
  const path = join(root, relative);
  check(`file:${relative}`, existsSync(path), existsSync(path) ? { bytes: statSync(path).size } : { reason: "missing; run pnpm build" });
}

const targets = [
  ["windows", /build-windows:/, /target:\s*nsis/],
  ["macos", /build-macos:/, /target:\s*dmg/],
  ["linux", /build-linux:/, /target:\s*AppImage/],
];
for (const [name, jobPattern, targetPattern] of targets) {
  check(`release:${name}`, jobPattern.test(workflow) && targetPattern.test(builder), {
    workflowJob: jobPattern.test(workflow),
    builderTarget: targetPattern.test(builder),
  });
}
check("release:ci-gates", /pnpm typecheck && pnpm workspace:typecheck/.test(workflow) && /pnpm test/.test(workflow) && /pnpm build/.test(workflow));
check("release:runner-matrix", /build-windows:[\s\S]*?runs-on: windows-latest/.test(workflow) && /build-macos:[\s\S]*?runs-on: macos-latest/.test(workflow) && /build-linux:[\s\S]*?runs-on: ubuntu-latest/.test(workflow), {
  windows: /build-windows:[\s\S]*?runs-on: windows-latest/.test(workflow),
  macos: /build-macos:[\s\S]*?runs-on: macos-latest/.test(workflow),
  linux: /build-linux:[\s\S]*?runs-on: ubuntu-latest/.test(workflow),
});
check("release:artifact-upload", /actions\/upload-artifact@v4/.test(workflow) && /release\/\*\.(exe|dmg|AppImage)/.test(workflow));
check("release:publishing-contract", /publish-release:/.test(workflow) && /provider:\s*github/.test(builder) && /owner:\s*louloulin/.test(builder) && /repo:\s*OpenBuddy/.test(builder));
const signingContract = {
  windowsBuild: /pnpm electron:build:win/.test(workflow) && workflow.includes("path: release/*.exe"),
  macSecrets: /MACOS_CSC_LINK_BASE64/.test(workflow) && /MACOS_CSC_KEY_PASSWORD/.test(workflow) && /MACOS_API_KEY_BASE64/.test(workflow) && /MACOS_API_KEY_ID/.test(workflow) && /MACOS_API_ISSUER/.test(workflow),
  macImport: /CSC_LINK=\$RUNNER_TEMP/.test(workflow) && /APPLE_API_KEY=\$RUNNER_TEMP/.test(workflow),
  macRelease: /pnpm electron:release:mac/.test(workflow) && /notarize:\s*true/.test(builder) && /hardenedRuntime:\s*true/.test(builder),
  linuxBuild: /pnpm electron:build:linux/.test(workflow) && workflow.includes("path: release/*.AppImage"),
  publishNeedsAll: /needs:\s*\[build-windows, build-macos, build-linux\]/.test(workflow),
};
check("release:installer-signing-contract", Object.values(signingContract).every(Boolean), {
  ...signingContract,
  credentialPolicy: "signing/notarization only on CI runners; local preflight never reads or validates secret values",
});
check("release:artifact-contract", /artifactName: \$\{productName\}-\$\{version\}-setup\.\$\{ext\}/.test(builder) && /artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/.test(builder) && /artifactName: \$\{productName\}-\$\{version\}\.\$\{ext\}/.test(builder), {
  windows: /artifactName: \$\{productName\}-\$\{version\}-setup\.\$\{ext\}/.test(builder),
  macos: /artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}/.test(builder),
  linux: /artifactName: \$\{productName\}-\$\{version\}\.\$\{ext\}/.test(builder),
});
check("release:signing-is-ci-only", !process.env.CSC_LINK && !process.env.CSC_KEY_PASSWORD && !process.env.APPLE_API_KEY, {
  reason: "local preflight never consumes signing/notarization credentials",
});

const digest = createHash("sha256");
let hashedFiles = 0;
for (const relative of ["out/main/index.js", "out/preload/index.cjs", "out/renderer/index.html"]) {
  const path = join(root, relative);
  if (!existsSync(path)) continue;
  digest.update(relative);
  digest.update(readFileSync(path));
  hashedFiles += 1;
}
check("build:artifact-hash", hashedFiles === 3, { hashedFiles, sha256: digest.digest("hex") });

const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const smokeScripts = [
  "scripts/electron/ipc-surface-smoke.mjs",
  "scripts/electron/stream-port-smoke.mjs",
  "scripts/electron/real-ui-smoke.mjs",
];
const smokeScriptsPresent = smokeScripts.every((relative) => existsSync(join(root, relative)));
check("desktop:smoke-contract", smokeScriptsPresent && /OPENBUDDY_E2E_REQUIRED/.test(fileText(join(root, "scripts/electron/real-ui-smoke.mjs"))), {
  scripts: smokeScripts,
  realUiRequiresE2E: /OPENBUDDY_E2E_REQUIRED/.test(fileText(join(root, "scripts/electron/real-ui-smoke.mjs"))),
  reason: smokeScriptsPresent ? undefined : "one or more desktop smoke entrypoints are missing",
});
check("desktop:display", hasDisplay, {
  platform: platform(),
  arch: arch(),
  display: process.env.DISPLAY || null,
  waylandDisplay: process.env.WAYLAND_DISPLAY || null,
  ci: process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
  runnerRecommendation: hasDisplay ? "run ipc-surface, stream-port, then real-ui with approved temporary credentials" : "use a Linux desktop runner with Xvfb/Wayland; do not set OPENBUDDY_E2E_REQUIRED locally",
  reason: hasDisplay ? undefined : "X server/Wayland display unavailable; Electron smoke must be run on a desktop runner",
});
check("desktop:credentials-gate", !process.env.OPENBUDDY_E2E_REQUIRED, {
  requiredForRealUi: true,
  reason: "real provider smoke remains opt-in and is not run by this preflight",
});

const report = {
  schema: "openbuddy.release-preflight.v1",
  generatedAt: new Date().toISOString(),
  repository: packageJson.name ?? "openbuddy",
  version: packageJson.version ?? null,
  mode: "local-credential-free-static",
  noNetwork: true,
  checks,
  ok: checks.filter((entry) => entry.name.startsWith("release:") || entry.name.startsWith("build:")).every((entry) => entry.ok),
  desktopSmokeReady: checks.find((entry) => entry.name === "desktop:display")?.ok === true && checks.find((entry) => entry.name === "desktop:smoke-contract")?.ok === true,
  desktopRunner: {
    displayAvailable: hasDisplay,
    smokeContractPresent: smokeScriptsPresent,
    requiredCommands: ["pnpm test:electron:ipc-surface", "pnpm test:electron:stream-port", "pnpm test:electron:real-ui"],
    credentialPolicy: "OPENBUDDY_E2E_REQUIRED=1 plus temporary provider credentials only on approved runner",
  },
};
mkdirSync(dirname(reportFile), { recursive: true });
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${reportFile}`);
if (!report.ok) process.exitCode = 2;
