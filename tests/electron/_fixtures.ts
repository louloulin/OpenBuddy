/**
 * R3.2 — `@playwright/test` fixture for Electron-driven e2e tests.
 *
 * Each spec that imports this fixture gets an `electronApp` (Playwright
 * `_electron.ElectronApplication`) plus a `page` resolved to the renderer's
 * first BrowserWindow. The renderer is loaded from the compiled
 * `out/main/index.html` (production build), NOT a vite dev server — that
 * means there is no localhost:5173 to point Playwright at, and a normal
 * browser channel does not work.
 *
 * The fixture launches its own Electron with an isolated `--user-data-dir`
 * so concurrent specs get separate SQLite databases. Echo provider is
 * configured via `OPENBUDDY_ECHO_URL` so the model layer is deterministic.
 *
 * Previously this fixture assumed a vite dev server was already running on
 * `localhost:5173`. That assumption broke when the dev server stopped being
 * part of the harness (R3.1) — specs ended up hitting an unrelated service
 * (or WeKnora docs) instead of the OpenBuddy renderer.
 */
import { test as base, _electron } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type ElectronAppFixture = {
  /** Resolves to the launched Electron app + its first window page. */
  electronApp: import("playwright").ElectronApplication;
  page: import("@playwright/test").Page;
};

/**
 * Provider-credential scrubbing — re-exported from the shared helper.
 *
 * The rationale, in short: the fixture has to spread `process.env` into the
 * Electron child (PATH, HOME, and the Electron runtime vars all live there),
 * so a developer who exports e.g. `ANTHROPIC_AUTH_TOKEN` in their shell
 * silently makes the app under test believe a provider is already configured.
 * `pi-ai`'s `getApiKeyEnvVars()` treats that variable as an auth source, which
 * flows up through `ModelRuntime.hasConfiguredAuth()` →
 * `electron/main/agent/host-modules/agent-model.ts:authStatus()` → `apiReady`,
 * and the composer renders enabled. Specs asserting the cold-start "no
 * credentials" surface then fail locally and pass in CI, or vice versa.
 *
 * The list itself now lives in `scripts/lib/e2e-credentials.mjs` because it
 * had drifted into three different versions (this file plus two runner
 * scripts, each missing variables the others had). A variable missing from
 * the list is a leaked credential, so there is exactly one list now.
 *
 * `OPENBUDDY_E2E_*` are deliberately NOT scrubbed: those are read by the spec
 * process to decide whether to skip, never by the app.
 */
export {
  PROVIDER_CREDENTIAL_ENV_VARS as SCRUBBED_PROVIDER_ENV_VARS,
  scrubProviderCredentials,
} from "../../scripts/lib/e2e-credentials.mjs";
import { scrubProviderCredentials as scrubEnv } from "../../scripts/lib/e2e-credentials.mjs";

/**
 * Echo provider URL — `launch-real-evals-echo.mjs` boots an OpenAI-compatible
 * stub on this port. Tests use it as the upstream so they don't hit any
 * external API.
 */
export const ECHO_PROVIDER_URL = process.env.OPENBUDDY_ECHO_URL
  ?? "http://localhost:8787/v1";

/** Kept for backwards-compat — previously used as the baseURL. Unused now. */
export const RENDERER_PORT = Number(process.env.OPENBUDDY_E2E_PORT ?? 5173);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(__dirname));

/**
 * Compiled artifacts the Electron app cannot boot without.
 *
 * Why this check exists: `moon run openbuddy:build` was once observed exiting 0
 * and reporting `build.bundle (cached)` while `out/main` and `out/renderer`
 * were EMPTY. Every spec then failed inside `_electron.launch()` with a bare
 * `exitCode=1`, which reads like a chat/bridge regression and sent an
 * investigation down the wrong path for a while. `npx electron-vite build`
 * produced the artifacts correctly.
 *
 * The root cause was NOT pinned down. A later attempt to reproduce it — same
 * cache hash, same restore path — worked fine, and the cache archive for that
 * hash was verified complete (4.8MB, `out/main/index.js` + 130 renderer
 * entries). The circumstantial detail is that a full `playwright test` run had
 * just been killed and left Electron processes alive (Playwright logged
 * `kill EPERM` on one), so a restore racing live file handles on `out/` is the
 * leading theory rather than a deterministic moon bug. Do not trust the
 * "moon cache is broken" reading without reproducing it.
 *
 * Either way the guard is worth keeping: it turns a silent boot failure into
 * one actionable message, and it also catches the subtler variant where a
 * *stale* bundle boots fine and quietly tests old code (this repo has a
 * documented history of `out/renderer` lagging behind source).
 */
const REQUIRED_BUILD_ARTIFACTS = [
  join(ROOT, "out", "main", "index.js"),
  join(ROOT, "out", "preload", "index.cjs"),
  join(ROOT, "out", "renderer", "index.html"),
];

function assertBuildArtifacts(): void {
  const missing = REQUIRED_BUILD_ARTIFACTS.filter((p) => !existsSync(p));
  if (missing.length === 0) return;
  throw new Error(
    [
      "Electron build artifacts are missing, so the app under test cannot boot:",
      ...missing.map((p) => `  - ${p}`),
      "",
      "Rebuild before running e2e:  npx electron-vite build",
      "",
      "If `moon run openbuddy:build` reported success and you still see this,",
      "its cache restore left `out/` incomplete — run electron-vite directly.",
      "Check for orphaned Electron processes from a previous killed test run.",
    ].join("\n"),
  );
}

export const test = base.extend<ElectronAppFixture>({
  electronApp: async ({}, use) => {
    assertBuildArtifacts();
    const userData = mkdtempSync(join(tmpdir(), "openbuddy-e2e-"));
    const piAgentDir = join(userData, "pi-agent");
    const electronPath =
      process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules", ".bin", "electron");

    const app = await _electron.launch({
      args: [`--user-data-dir=${userData}`, ROOT],
      executablePath: electronPath,
      cwd: ROOT,
      timeout: 30_000,
      env: {
        // Strip ambient provider credentials so `agent:auth-status.ready`
        // reflects the test's own configuration, not the developer's shell.
        // See `scrubProviderCredentials` above for why this matters.
        ...scrubEnv(process.env),
        // Force `file://` load of the compiled renderer so we don't need
        // a separate vite dev server.
        ELECTRON_RENDERER_URL: "",
        PI_CODING_AGENT_DIR: piAgentDir,
        OPENBUDDY_DEBUG_UI: "0",
        OPENBUDDY_ECHO_URL: ECHO_PROVIDER_URL,
        // Disable the harness server extensions — those are for the legacy
        // smoke runner, not the e2e specs.
        OPENBUDDY_HARNESS_FILE: "",
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
  },
  page: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    await window.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
    await use(window);
  },
});

export { expect } from "@playwright/test";
