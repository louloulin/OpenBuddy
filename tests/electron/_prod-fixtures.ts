/**
 * R10 — `_electron.launch()` fixture that targets the **packaged production
 * build** at `release/mac-arm64/OpenBuddy.app` (with intel fallback to
 * `release/mac/OpenBuddy.app`). This is the fixture the existing `_fixtures.ts`
 * does NOT cover — that one boots `node_modules/.bin/electron` against the
 * source tree, so it can never catch regressions that only manifest in the
 * bundled `.app` (CSP, code signing, file:// resource loading, prod-only env).
 *
 * Shape is intentionally a *near*-superset of `_fixtures.ts` so any spec
 * written against the dev fixture can be lifted over by swapping the import:
 *
 *   import { test, expect } from "./_fixtures";           // dev
 *   import { test, expect } from "./_prod-fixtures";      // prod (this file)
 *
 * On non-mac hosts — or when the .app artifact isn't present — every spec
 * auto-skips via `test.skip()`. CI runners without a mac machine shouldn't
 * be forced to see red on a build-target check.
 *
 * @see docs/email-ai-redesign/FOLLOWUP.md §12
 */
import {
  test as base,
  _electron,
  expect as baseExpect,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubProviderCredentials } from "../../scripts/lib/e2e-credentials.mjs";

/**
 * Locate the packaged app, preferring arm64 (round 9 build host) and falling
 * back to the intel build. Both directories ship under `release/` next to the
 * repo root.
 */
function resolveProdAppBinary(): string | null {
  const candidates = [
    join(process.cwd(), "release", "mac-arm64", "OpenBuddy.app", "Contents", "MacOS", "OpenBuddy"),
    join(process.cwd(), "release", "mac", "OpenBuddy.app", "Contents", "MacOS", "OpenBuddy"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

/**
 * Onboarding state must be seeded before the wizard mounts, or the modal
 * intercepts every pointer event aimed at the email sidebar entry. Same
 * pattern `_fixtures.ts` already proved works — re-declared locally because
 * importing from `_fixtures.ts` would also drag in the dev-tree launch path,
 * which is the thing we're explicitly NOT using here.
 */
const ONBOARDING_STORAGE_KEY = "openbuddy.onboarding.state";
const ONBOARDING_STATE_VERSION = 1;
const COMPLETED_ONBOARDING_STATE = JSON.stringify({
  version: ONBOARDING_STATE_VERSION,
  status: "done",
  index: 0,
  steps: [] as { id: string; status: string }[],
  updatedAt: 0,
  completedAt: 0,
});

async function dismissFirstRunOnboarding(window: Page): Promise<void> {
  await window.addInitScript(
    (seed: { key: string; value: string }) => {
      try {
        globalThis.localStorage.setItem(seed.key, seed.value);
      } catch {
        /* leave wizard up — silent skip is worse than visible failure */
      }
    },
    { key: ONBOARDING_STORAGE_KEY, value: COMPLETED_ONBOARDING_STATE },
  );
  await window.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
}

export type ProdFixture = {
  electronApp: ElectronApplication;
  page: Page;
  /** True when the .app binary exists and was actually launched. */
  prodAvailable: boolean;
};

/**
 * Conditionally skip the entire spec when we're not on a host that can run
 * the packaged binary, or the .app isn't present. Returning early from
 * `beforeEach` keeps the suite green on Linux CI / Windows runners without
 * the `OpenBuddy.app` artifact.
 */
function skipIfNoProdBuild(testInfo: { skip: (reason?: string) => void }, binary: string | null): void {
  if (process.platform !== "darwin") {
    testInfo.skip(`prod-build spec skipped: requires macOS (current: ${process.platform})`);
    return;
  }
  if (binary === null) {
    testInfo.skip(
      "prod-build spec skipped: no OpenBuddy.app found under release/mac-arm64 or release/mac. " +
        "Run `npm run electron:build:mac` first.",
    );
    return;
  }
}

export const test = base.extend<ProdFixture>({
  prodAvailable: async ({}, use) => {
    const binary = resolveProdAppBinary();
    await use(binary !== null && process.platform === "darwin");
  },

  electronApp: async ({ prodAvailable }, use, testInfo) => {
    const binary = resolveProdAppBinary();
    skipIfNoProdBuild(testInfo, binary);
    // After skipIfNoProdBuild returns without skipping, binary is non-null.
    const appBinary = binary as string;

    const userData = mkdtempSync(join(tmpdir(), "openbuddy-prod-e2e-"));
    const piAgentDir = join(userData, "pi-agent");

    const app = await _electron.launch({
      args: [
        `--user-data-dir=${userData}`,
        // No `ROOT` arg here — production binary already knows its own bundle path.
        // `--no-sandbox` is the documented escape hatch for unsigned dev builds; the
        // arm64 .app from round 9 was built with the unsigned profile, so on first
        // launch macOS Gatekeeper can refuse. Letting Playwright pass --no-sandbox
        // sidesteps that without weakening renderer isolation (Electron still keeps
        // the renderer sandbox by default in production).
        "--no-sandbox",
      ],
      executablePath: appBinary,
      cwd: process.cwd(),
      timeout: 30_000,
      env: {
        ...scrubProviderCredentials(process.env),
        PI_CODING_AGENT_DIR: piAgentDir,
        // Prod binary loads its renderer from `file://` (no vite dev server).
        ELECTRON_RENDERER_URL: "",
        OPENBUDDY_DEBUG_UI: "0",
        OPENBUDDY_HARNESS_FILE: "",
        // Echo provider stays on the same port as the dev fixture so any
        // existing mock-provider scripts keep working unchanged.
        OPENBUDDY_ECHO_URL: process.env.OPENBUDDY_ECHO_URL ?? "http://localhost:8787/v1",
        ELECTRON_ENABLE_LOGGING: "1",
      },
    });

    try {
      await use(app);
    } finally {
      await app.close().catch(() => {
        /* renderer may already be down */
      });
    }
    void prodAvailable;
  },

  page: async ({ electronApp }, use, testInfo) => {
    skipIfNoProdBuild(testInfo, resolveProdAppBinary());
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await dismissFirstRunOnboarding(window);
    await use(window);
  },
});

export { baseExpect as expect };
