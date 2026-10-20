import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-r17ti-"));
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

const result = await page.evaluate(async () => {
  document.querySelector(".sidebar__icon-btn[aria-label='设置']")?.click();
  await new Promise((r) => setTimeout(r, 1500));
  const items = Array.from(document.querySelectorAll(".settings-navigation__item"));
  const t = items.find((el) => (el.textContent ?? "").includes("个性化"));
  if (t) t.click();
  await new Promise((r) => setTimeout(r, 800));
  const buttons = Array.from(document.querySelectorAll(".theme-toggle__btn"));
  const target = buttons.find((b) => (b.textContent ?? "").includes("深色"));
  if (target) target.click();
  await new Promise((r) => setTimeout(r, 800));
  document.body.click();
  await new Promise((r) => setTimeout(r, 500));

  const input = document.querySelector(".wb-composer__input");
  if (!input) return { found: false };

  const cs = getComputedStyle(input);
  const matches = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (!rule.selectorText) continue;
      try {
        if (input.matches(rule.selectorText) && rule.style && rule.style.backgroundColor) {
          matches.push({ selector: rule.selectorText.slice(0, 120), bg: rule.style.backgroundColor, sheet: (sheet.href ?? "").slice(-60) });
        }
      } catch {}
    }
  }
  return {
    found: true,
    finalBg: cs.backgroundColor,
    finalColor: cs.color,
    classList: input.className,
    parentClass: input.parentElement?.className?.slice(0, 60),
    rules: matches.slice(0, 8),
  };
});
console.log(JSON.stringify(result, null, 2));
await app.close();
process.exit(0);
