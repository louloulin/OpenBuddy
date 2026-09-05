#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Capture the README screenshots from the REAL Electron app.
//
// Why this script exists: the previous docs/screenshots/*.png were captured by
// pointing a plain browser at the vite dev server. That cannot work — the
// renderer needs the preload bridge (`window.openbuddy`), and per
// tests/electron/_fixtures.ts the dev server stopped being part of the harness
// in R3.1. The result was a 98%-flat-grey frame with one line of red error
// text, shipped as the project's headline screenshot.
//
// So: launch Electron exactly like the e2e fixture does (compiled
// out/main/index.js over file://, isolated user-data-dir, provider credentials
// scrubbed), drive the real UI, and refuse to write a frame that looks blank.
//
// Usage:  pnpm build && pnpm docs:screenshots
// ---------------------------------------------------------------------------
import { _electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubProviderCredentials } from "../lib/e2e-credentials.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = join(ROOT, "docs/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

/** Largest share a single colour may occupy before we call the frame blank. */
const MAX_FLAT_SHARE = 0.9;
/** Minimum visible text in the renderer before a frame is considered rendered. */
const MIN_TEXT_LENGTH = 120;

const problems = [];

/**
 * Reject frames that are effectively empty.
 *
 * This is the guard whose absence shipped the broken screenshots: a failed
 * render still produces a perfectly valid PNG, so "the file exists" proves
 * nothing. Needs ImageMagick; skipped with a warning when absent rather than
 * blocking the capture.
 */
const assertNotBlank = (file) => {
  let histogram;
  try {
    histogram = execFileSync("magick", [file, "-format", "%c", "-depth", "8", "histogram:info:-"], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    console.warn(`  ! magick unavailable — skipped blank-frame check for ${file}`);
    return;
  }
  let top = 0;
  let total = 0;
  for (const line of histogram.split("\n")) {
    const count = Number(line.trim().split(":")[0]);
    if (!Number.isFinite(count)) continue;
    total += count;
    if (count > top) top = count;
  }
  const share = total ? top / total : 1;
  if (share > MAX_FLAT_SHARE) {
    problems.push(`${file}: ${(share * 100).toFixed(1)}% of pixels are one colour — blank render`);
  }
  return share;
};

const capture = async (page, name, prepare) => {
  if (prepare) await prepare();
  await page.waitForTimeout(600); // let transitions settle
  const text = await page.evaluate(() => document.body.innerText.trim().length);
  if (text < MIN_TEXT_LENGTH) {
    problems.push(`${name}: renderer shows only ${text} chars of text — not rendered`);
  }
  const file = join(OUT_DIR, name);
  await page.screenshot({ path: file });
  const share = assertNotBlank(file);
  const flat = share === undefined ? "?" : `${(share * 100).toFixed(1)}% flat`;
  console.log(`✓ ${name}  (${text} chars text, ${flat})`);
};

mkdirSync(OUT_DIR, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), "openbuddy-shots-"));

const app = await _electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: process.env.OPENBUDDY_ELECTRON_PATH ?? join(ROOT, "node_modules/.bin/electron"),
  cwd: ROOT,
  timeout: 60_000,
  env: {
    ...scrubProviderCredentials(process.env),
    ELECTRON_RENDERER_URL: "", // force file:// load of the compiled renderer
    PI_CODING_AGENT_DIR: join(userData, "pi-agent"),
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_HARNESS_FILE: "",
  },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => problems.push(`uncaught renderer error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console error: ${message.text().slice(0, 200)}`);
  });

  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });

  // A window whose size drifts makes every screenshot a different shape, so
  // pin it. Electron owns the window, not Playwright, hence the main-process
  // resize rather than a browser-context viewport.
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setBounds({ x: 0, y: 0, ...size });
  }, VIEWPORT);

  // The composer only mounts once the shell is genuinely interactive, so it is
  // a better readiness signal than #root (which exists even on a failed boot).
  await page.locator("textarea.wb-composer__input").waitFor({ state: "visible", timeout: 30_000 });

  await capture(page, "desktop-main.png");

  await capture(page, "settings-zh.png", async () => {
    await page.getByRole("button", { name: /设置|preferences/i }).first().click();
    await page.waitForTimeout(900);
  });
} finally {
  await app.close().catch(() => {});
}

if (problems.length) {
  console.error("\n✗ capture rejected:");
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nWrote screenshots to ${OUT_DIR.replace(`${ROOT}/`, "")}`);
