import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const out = process.argv[2] || "/tmp/ob-clean.png";
const userData = mkdtempSync(join(tmpdir(), "ob-clean-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15000);
const removed = await page.evaluate(() => {
  const killed = [];
  const appEl = document.querySelector(".app");
  for (const el of [...document.body.children]) {
    if (el === appEl) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.backdropFilter !== "none" || el.textContent.includes("欢迎来到")) {
      killed.push(el.className.toString());
      el.remove();
    }
  }
  for (const el of [...document.querySelectorAll("div")]) {
    const cs = getComputedStyle(el);
    if (cs.backdropFilter && cs.backdropFilter !== "none" && el !== appEl) { killed.push("bf:" + el.className); el.remove(); }
  }
  return killed;
});
console.log("removed:", JSON.stringify(removed));
await page.waitForTimeout(800);
await page.screenshot({ path: out });
const dump = await page.evaluate(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 6) return;
    const r = el.getBoundingClientRect();
    const t = el.childElementCount === 0 ? (el.textContent || "").trim().slice(0, 26) : "";
    out.push(`${"  ".repeat(depth)}${el.tagName.toLowerCase()}.${el.className.toString().split(" ").slice(0,2).join(".")} [${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}] ${t}`);
    [...el.children].forEach((c) => walk(c, depth + 1));
  };
  const main = document.querySelector(".app__main");
  if (main) walk(main, 0);
  return out.join("\n");
});
writeFileSync("/tmp/ob-main-tree.txt", dump);
console.log("shot saved ->", out);
await app.close();
process.exit(0);
