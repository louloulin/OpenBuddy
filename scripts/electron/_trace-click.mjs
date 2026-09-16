/** 谁在点「下一步」：给 wizard 按钮挂捕获监听，记录 isTrusted + 调用栈。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-tc-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.evaluate(function () {
  window.__clicks = [];
  document.addEventListener(
    "click",
    function (ev) {
      const t = ev.target;
      if (t && t.closest && t.closest('[data-testid="onboarding-next"],[data-testid="onboarding-skip"]')) {
        window.__clicks.push({ sel: t.getAttribute && t.getAttribute("data-testid"), trusted: ev.isTrusted, stack: new Error().stack, t: Date.now() });
      }
    },
    true,
  );
});
await page.waitForTimeout(12000);
const clicks = await page.evaluate(function () { return window.__clicks || []; });
console.log("clicks:", clicks.length);
for (const c of clicks.slice(0, 4)) {
  console.log("---", c.sel, "trusted=", c.trusted);
  console.log(String(c.stack).split("\n").slice(1, 6).join("\n"));
}
await app.close();
process.exit(0);
