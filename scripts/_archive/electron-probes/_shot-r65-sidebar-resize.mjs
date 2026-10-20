/**
 * R65 视觉:侧栏拖拽到 220 / 260 / 420 三档。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-r65-shot-"));
mkdirSync("tests/screenshots", { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 40000 });

  await page.evaluate(() => {
    try {
      const done = JSON.stringify({ version: 1, status: "done", index: 0, steps: [], startedAt: Date.now(), updatedAt: Date.now(), completedAt: Date.now() });
      window.localStorage.setItem("openbuddy.onboarding.state", done);
      window.localStorage.setItem("openbuddy.tour.state", "seen");
    } catch { /* */ }
  }).catch(() => {});
  await sleep(3000);

  // 默认 260
  await page.screenshot({ path: "tests/screenshots/r65-sidebar-260.png" });

  // 拖到 420
  const handle = await page.evaluate(() => {
    const h = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (handle) {
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 300, handle.y, { steps: 8 });
    await page.mouse.move(handle.x + 600, handle.y, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
  }
  await page.screenshot({ path: "tests/screenshots/r65-sidebar-420.png" });

  // 拖到 220
  const handle2 = await page.evaluate(() => {
    const h = document.querySelector(".app__sidebar-shell [role='separator']");
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (handle2) {
    await page.mouse.move(handle2.x, handle2.y);
    await page.mouse.down();
    await page.mouse.move(handle2.x - 200, handle2.y, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
  }
  await page.screenshot({ path: "tests/screenshots/r65-sidebar-220.png" });

  console.log(JSON.stringify({ ok: true, shots: [
    "tests/screenshots/r65-sidebar-260.png",
    "tests/screenshots/r65-sidebar-420.png",
    "tests/screenshots/r65-sidebar-220.png",
  ] }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
} finally {
  await app.close().catch(() => {});
  process.exit(0);
}
