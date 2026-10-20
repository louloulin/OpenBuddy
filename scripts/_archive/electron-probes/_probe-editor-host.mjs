/** Phase C 宿主探针：工具侧栏里的 markdown「编辑」入口 + TipTap 编辑器是否落地。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-ed-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const pageErrors = [];
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
await page.waitForTimeout(14_000);

// 打开侧栏第一个任务
await page.evaluate(function () {
  const els = Array.from(document.querySelectorAll("button, a, li, div[role='button']"));
  const hit = els.find(function (el) { return /R8\.5 probe/.test(el.textContent || ""); });
  if (hit) hit.click();
});
await page.waitForTimeout(5000);

const labels = await page.evaluate(function () {
  return Array.from(document.querySelectorAll("button[aria-label]"))
    .map(function (b) { return b.getAttribute("aria-label"); })
    .slice(0, 60);
});
console.log("ariaLabels:", JSON.stringify(labels));

await app.close();
process.exit(0);
