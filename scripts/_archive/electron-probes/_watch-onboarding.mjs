import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-watch-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
for (let i = 0; i < 9; i += 1) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => {
    const w = document.querySelector('[data-testid="onboarding-wizard"]');
    const t = document.querySelector('[data-testid="tour-body"], [data-testid="tour-counter"]');
    return {
      wizard: !!w,
      step: w?.getAttribute("data-step-id") ?? null,
      tour: !!t,
      status: (() => { try { return JSON.parse(localStorage.getItem("openbuddy.onboarding.state") || "null")?.status ?? null; } catch { return "parse-error"; } })(),
    };
  });
  console.log(`t=${(i + 1) * 2}s`, JSON.stringify(s));
  if (i === 2) await page.screenshot({ path: "/tmp/ob-onb-6s.png" });
}
await page.screenshot({ path: "/tmp/ob-onb-final.png" });
await app.close();
process.exit(0);
