import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-debug-theme-"));
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

async function checkTheme(name, pref) {
  await page.evaluate(
    ([n, p]) => {
      window.localStorage.setItem("openbuddy.theme", p);
      window.localStorage.setItem("openbuddy.theme.name", n);
      window.localStorage.setItem("openbuddy.theme.mode", "manual");
    },
    [name, pref],
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8_000);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      dataTheme: root.getAttribute("data-theme"),
      dataThemeName: root.getAttribute("data-theme-name"),
      inlineStylePrimary: root.style.getPropertyValue("--wb-bg-primary"),
      computedPrimary: cs.getPropertyValue("--wb-bg-primary").trim(),
      computedElevated: cs.getPropertyValue("--wb-bg-elevated").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(name, JSON.stringify(info));
}

await checkTheme("openbuddy-dark", "dark");
await checkTheme("black", "dark");
await checkTheme("aurora", "dark");
await checkTheme("matrix", "dark");
await checkTheme("claude", "dark");

await app.close();
process.exit(0);
