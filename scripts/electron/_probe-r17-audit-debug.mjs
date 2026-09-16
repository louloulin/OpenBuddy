import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ad-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.addInitScript(() => {
  window.__INVOKES__ = [];
  const originalInvoke = window.api?.invoke;
  if (originalInvoke) {
    window.api.invoke = async (channel, args) => {
      window.__INVOKES__.push({ channel, args });
      try {
        const r = await originalInvoke(channel, args);
        window.__INVOKES__[window.__INVOKES__.length - 1].result = "ok";
        return r;
      } catch (e) {
        window.__INVOKES__[window.__INVOKES__.length - 1].result = String(e?.message ?? e);
        throw e;
      }
    };
  }
});
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// direct first
await page.evaluate(async () => {
  try { return await window.api.invoke("audit:record", { event: "test.0", outcome: "info", subject: "p" }); }
  catch (e) { return { err: String(e) }; }
});

// Then click settings
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(3000);

const inv = await page.evaluate(() => window.__INVOKES__ ?? []);
console.log("INVIKES:", JSON.stringify(inv, null, 2));

await app.close();
process.exit(0);
