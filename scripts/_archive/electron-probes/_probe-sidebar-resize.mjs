import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-resize-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page.waitForTimeout(400);
const handle = await page.$('[role="separator"][aria-label="调整侧栏宽度"]');
const box = await handle.boundingBox();
console.log("handle box:", JSON.stringify(box));
const before = await page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
await page.mouse.move(box.x + 2, 400);
await page.mouse.down();
await page.mouse.move(box.x + 2 + 60, 400, { steps: 12 });
const midDragging = await handle.getAttribute("data-dragging");
const midWidth = await page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
await page.mouse.up();
await page.waitForTimeout(500);
const after = await page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
const stored = await page.evaluate(() => localStorage.getItem("openbuddy.sidebar.width"));
console.log(JSON.stringify({ before, midDragging, midWidth, after, stored }));
await app.close();
process.exit(0);
