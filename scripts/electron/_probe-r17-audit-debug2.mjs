import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ad2-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

// Install hook AFTER window.api is set
await page.evaluate(() => {
  if (!window.api?.invoke) return;
  window.__INVOKES__ = [];
  const orig = window.api.invoke.bind(window.api);
  window.api.invoke = async (channel, args) => {
    window.__INVOKES__.push({ channel, args: JSON.parse(JSON.stringify(args ?? null)) });
    try {
      const r = await orig(channel, args);
      window.__INVOKES__[window.__INVOKES__.length - 1].result = "ok";
      return r;
    } catch (e) {
      window.__INVOKES__[window.__INVOKES__.length - 1].result = String(e?.message ?? e);
      throw e;
    }
  };
});

// click settings
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(3500);

const inv = await page.evaluate(() => window.__INVOKES__ ?? []);
console.log("INVIKES:", JSON.stringify(inv, null, 2));
const auditFile = join(userData, "audit.jsonl");
console.log("FILE:", existsSync(auditFile) ? readFileSync(auditFile, "utf8").slice(0, 600) : "missing");
await app.close();
process.exit(0);
