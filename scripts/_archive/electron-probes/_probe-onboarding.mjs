/** 首启引导探针：全新 user-data 下应出现 OnboardingWizard，并校验步骤 / 门控。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-onb-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const pageErrors = [];
const page = await app.firstWindow({ timeout: 30_000 });
page.on("pageerror", (e) => pageErrors.push(String(e.message)));
await page.waitForTimeout(15_000);

const first = await page.evaluate(() => {
  const w = document.querySelector('[data-testid="onboarding-wizard"]');
  return {
    errorBoundary: !!document.querySelector(".error-boundary"),
    wizard: !!w,
    stepIndex: w?.getAttribute("data-step-index"),
    stepId: w?.getAttribute("data-step-id"),
    title: (w?.textContent || "").replace(/\s+/g, " ").slice(0, 120),
    persisted: window.localStorage.getItem("openbuddy.onboarding.state"),
  };
});

// 点「下一步」若干次，最后应落盘 done 并消失
for (let i = 0; i < 8; i += 1) {
  const advanced = await page.evaluate(() => {
    const w = document.querySelector('[data-testid="onboarding-wizard"]');
    if (!w) return "gone";
    const btns = Array.from(w.querySelectorAll("button"));
    const next = btns.find((b) => /下一步|完成|开始/.test(b.textContent || ""))
      || btns.find((b) => /跳过/.test(b.textContent || ""));
    if (next) { next.click(); return "clicked"; }
    return "nobtn";
  });
  if (advanced === "gone") break;
  await page.waitForTimeout(900);
}
await page.waitForTimeout(1200);
const after = await page.evaluate(() => ({
  wizard: !!document.querySelector('[data-testid="onboarding-wizard"]'),
  persisted: window.localStorage.getItem("openbuddy.onboarding.state"),
}));

console.log(JSON.stringify({ first, after, pageErrors }, null, 2));
await app.close();
process.exit(0);
