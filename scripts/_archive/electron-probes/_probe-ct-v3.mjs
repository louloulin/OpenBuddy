import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-ct3-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

async function dump(label) {
  const info = await page.evaluate(() => {
    const composer = document.querySelector(".wb-composer");
    const input = composer?.querySelector(".wb-composer__input");
    const inpCs = input ? getComputedStyle(input) : null;
    const cs = composer ? getComputedStyle(composer) : null;
    const root = getComputedStyle(document.documentElement);
    return {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      composerBg: cs?.backgroundColor,
      composerBorder: cs?.borderColor,
      composerBoxShadow: cs?.boxShadow,
      composerBorderRadius: cs?.borderRadius,
      composerPadding: cs?.padding,
      inputBg: inpCs?.backgroundColor,
      inputColor: inpCs?.color,
      inputBorderColor: inpCs?.borderColor,
      inputBorderWidth: inpCs?.borderWidth,
      inputBorderRadius: inpCs?.borderRadius,
      inputPadding: inpCs?.padding,
      rootBgPrimary: root.getPropertyValue("--wb-bg-primary").trim(),
      rootBgElevated: root.getPropertyValue("--wb-bg-elevated").trim(),
      rootComposerBg: root.getPropertyValue("--wb-composer-bg").trim(),
    };
  });
  console.log(label, JSON.stringify(info, null, 2));
  return info;
}

await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
});
await page.waitForTimeout(1200);

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes("浅色"));
  b?.click();
});
await page.waitForTimeout(1500);
await dump("LIGHT:");

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll(".theme-toggle__btn")).find((b) => (b.textContent ?? "").includes("深色"));
  b?.click();
});
await page.waitForTimeout(1500);
await dump("DARK:");

await app.close();
process.exit(0);
