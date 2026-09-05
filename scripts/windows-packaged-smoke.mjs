import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const executablePath = process.env.OPENBUDDY_ELECTRON_PATH;

if (process.platform !== "win32" || !executablePath) {
  throw new Error("windows-packaged-smoke must run on Windows with OPENBUDDY_ELECTRON_PATH");
}

const userData = mkdtempSync(join(tmpdir(), "openbuddy-windows-smoke-"));
const piAgentDir = join(userData, "pi-agent");
mkdirSync(piAgentDir, { recursive: true });
writeFileSync(
  join(piAgentDir, "models.json"),
  `${JSON.stringify({ providers: {} }, null, 2)}\n`,
  { mode: 0o600 },
);

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  cwd: root,
  executablePath,
  timeout: 30_000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    PI_CODING_AGENT_DIR: piAgentDir,
    OPENBUDDY_DEBUG_UI: "0",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
  await page.locator("#root").waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => window.api?.apiVersion === 1, undefined, { timeout: 30_000 });

  const debugInfo = await page.evaluate(() => window.api.invoke("debug:info"));
  const composer = page.locator("textarea").first();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  const composerEnabled = await composer.isEnabled();

  await page.keyboard.press("Control+K");
  const searchDialog = page.locator('[role="dialog"][aria-label="全局搜索"]');
  await searchDialog.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "全局搜索",
    undefined,
    { timeout: 15_000 },
  );

  await page.keyboard.press("Escape");
  await searchDialog.waitFor({ state: "hidden", timeout: 15_000 });

  console.log(
    JSON.stringify({
      status: "passed",
      platform: process.platform,
      executablePath,
      url: page.url(),
      apiVersion: 1,
      debugAppVersion: debugInfo?.version ?? null,
      composerVisible: true,
      globalSearchShortcut: true,
      composerEnabled,
      searchEscapeRestoresApp: true,
    }),
  );
} finally {
  try {
    await app.close();
  } catch {
    app.process().kill("SIGKILL");
  }
  rmSync(userData, { recursive: true, force: true });
}
