import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-persist-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errors = [];
const logs = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page.waitForTimeout(400);
const handle = await page.$('[role="separator"][aria-label="调整侧栏宽度"]');
let box = await handle.boundingBox();
await page.mouse.move(box.x + 2, 400);
await page.mouse.down();
await page.mouse.move(box.x + 2 + 72, 400, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);
const stored1 = await page.evaluate(() => localStorage.getItem("openbuddy.sidebar.width"));
const w1 = await page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
// 用键盘再试一次（另一条 persist 路径）
await handle.focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
const stored2 = await page.evaluate(() => localStorage.getItem("openbuddy.sidebar.width"));
const w2 = await page.evaluate(() => Math.round(document.querySelector(".sidebar").getBoundingClientRect().width));
console.log(JSON.stringify({ w1, stored1, w2, stored2, errors, logs: logs.slice(0, 8) }, null, 2));
await app.close();
process.exit(0);
