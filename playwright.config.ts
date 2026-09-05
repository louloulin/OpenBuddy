/**
 * R3.1 — `@playwright/test` runner configuration.
 *
 * The repo previously shipped 15 raw `playwright` scripts that ran via
 * `node scripts/electron/*.mjs`. R3 keeps those (back-compat) and adds a
 * structured runner next to them. New e2e specs go under `tests/electron/`
 * and run with `pnpm test:electron:ui` (UI mode) or `pnpm test:electron:report`
 * (HTML report) — both added to package.json scripts.
 *
 * Trace + screenshot collection is enabled so failures always carry a
 * `trace.zip` for postmortem; videos are retained on failure only to keep
 * CI artifact size sane.
 */
import { defineConfig, devices } from "@playwright/test";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM helper, shared with the bare-node scripts under scripts/electron/
import { hydrateE2EEnv, describeSource } from "./scripts/lib/e2e-credentials.mjs";

/**
 * Make stored real-model credentials visible to the specs.
 *
 * `minimax-real-roundtrip.spec.ts` and `session-history-load.spec.ts` decide
 * at module load whether to skip, based on `OPENBUDDY_E2E_API_KEY` /
 * `OPENBUDDY_E2E_BASE_URL`. Nobody exports those interactively, so a plain
 * `npx playwright test` used to report "79 passed / 7 skipped" where six of
 * the skips were the only specs that would ever reach a real LLM — i.e. real
 * model coverage was zero by default.
 *
 * `hydrateE2EEnv()` resolves credentials from the environment, then
 * `.env.e2e.local`, then `~/.pi/agent/auth.json`, and fills the variables in
 * without overwriting anything set explicitly. Machines with no credentials
 * resolve to nothing and the specs still skip, so the suite stays runnable
 * everywhere. The key is never printed — only its length and provenance.
 */
const e2eCredentials = hydrateE2EEnv();
console.log(`[playwright] real-model credentials: ${describeSource(e2eCredentials)}`);

/**
 * R3.2 — The fixture in `tests/electron/_fixtures.ts` launches its own
 * Electron app per spec via `playwright._electron`. There is no separate
 * dev-server URL to point at; each `page` IS the renderer's first window
 * loaded from the compiled `out/main/index.html` over `file://`.
 */
export default defineConfig({
  testDir: "./tests/electron",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  // No `webServer` — the Electron app is launched by the fixture itself.
  projects: [
    {
      name: "electron",
      use: {
        ...devices["Desktop Chrome"],
        channel: undefined,
      },
    },
  ],
});