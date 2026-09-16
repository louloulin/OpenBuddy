/** 追踪谁在写 openbuddy.onboarding.state —— 抓 setItem 调用栈。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-trace-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.evaluate(function () {
  window.__writes = [];
  const proto = Object.getPrototypeOf(window.localStorage);
  const orig = proto.setItem;
  proto.setItem = function (k, v) {
    if (String(k).indexOf("onboarding") !== -1) {
      window.__writes.push({ k: String(k), v: String(v).slice(0, 90), stack: new Error().stack });
    }
    return orig.call(this, k, v);
  };
});
await page.waitForTimeout(12000);
const writes = await page.evaluate(function () { return window.__writes || []; });
console.log("writes:", writes.length);
for (const w of writes.slice(0, 5)) {
  console.log("---", w.v);
  console.log(String(w.stack).split("\n").slice(1, 5).join("\n"));
}
await app.close();
process.exit(0);
