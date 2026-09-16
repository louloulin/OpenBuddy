import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-rz-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

// Find the app__sidebar-shell and its handle
const initial = await page.evaluate(() => {
  const shell = document.querySelector(".app__sidebar-shell");
  const handle = document.querySelector(".app__sidebar-handle");
  return {
    shellFound: !!shell,
    shellWidth: shell?.getBoundingClientRect().width,
    handleFound: !!handle,
    handleRect: handle?.getBoundingClientRect(),
  };
});
console.log("INITIAL:", JSON.stringify(initial, null, 2));

if (initial.handleFound) {
  const r = initial.handleRect;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  // Drag right
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy, { steps: 8 });
  await page.mouse.move(cx + 160, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterRight = await page.evaluate(() => {
    const s = document.querySelector(".app__sidebar-shell");
    return { width: s?.getBoundingClientRect().width };
  });
  console.log("AFTER_DRAG_RIGHT:", JSON.stringify(afterRight));
  await page.screenshot({ path: join(ROOT, "tests/screenshots/r18-sidebar-after-drag.png") });

  // Drag back left
  await page.mouse.move(cx + 160, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 80, cy, { steps: 8 });
  await page.mouse.move(cx - 160, cy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterLeft = await page.evaluate(() => {
    const s = document.querySelector(".app__sidebar-shell");
    return { width: s?.getBoundingClientRect().width };
  });
  console.log("AFTER_DRAG_LEFT:", JSON.stringify(afterLeft));
  await page.screenshot({ path: join(ROOT, "tests/screenshots/r18-sidebar-drag-left.png") });
}

console.log("ERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
