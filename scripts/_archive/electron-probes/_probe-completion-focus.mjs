import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-comp-focus-"));

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30000,
});
const page = await app.firstWindow({ timeout: 30000 });
await page.waitForTimeout(8000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(800);

async function captureMode(themeName, themePref) {
  await page.evaluate(([n, p]) => {
    localStorage.setItem("openbuddy.theme", p);
    localStorage.setItem("openbuddy.theme.name", n);
    localStorage.setItem("openbuddy.theme.mode", "manual");
  }, [themeName, themePref]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(800);

  const ta = await page.locator("textarea.wb-composer__input").first();
  if (!(await ta.count())) return null;
  await ta.click();
  await ta.fill("/");
  await page.waitForTimeout(800);
  
  // Focus on just the popover
  const popover = await page.locator(".slash-commands").first();
  if (await popover.count()) {
    await popover.screenshot({ path: `/Users/louloulin/appx/OpenBuddy/tests/screenshots/slash-${themeName}.png` });
    // Probe token values
    const tokens = await popover.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        bg: cs.backgroundColor,
        borderColor: cs.borderColor,
        color: cs.color,
        boxShadow: cs.boxShadow,
      };
    });
    return { themeName, tokens };
  }
  return null;
}

const lightInfo = await captureMode("openbuddy", "light");
console.log("LIGHT slash:", JSON.stringify(lightInfo?.tokens));

const darkInfo = await captureMode("openbuddy-dark", "dark");
console.log("DARK slash:", JSON.stringify(darkInfo?.tokens));

await app.close();
process.exit(0);
