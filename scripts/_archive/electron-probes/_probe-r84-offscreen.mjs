/**
 * 判定实验:把窗口移到屏幕外(-3000,-3000),外部屏幕级点击就点不到。
 * 如果这时引导不再自动前进 → 是外部点击器在点;若仍自动 → 是 app 内部逻辑。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-off-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({ args: [`--user-data-dir=${userData}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), timeout: 30_000 });
const page = await app.firstWindow({ timeout: 30_000 });
const bw = app.browserWindow(page);
await bw.evaluate((w) => w.setPosition(-3000, -3000));
await page.waitForTimeout(1500);
console.log("pos:", JSON.stringify(await bw.evaluate((w) => w.getPosition())));
const samples = [];
for (let i = 0; i < 16; i += 1) {
  samples.push(await page.evaluate(() => {
    const w = document.querySelector('[data-testid="onboarding-wizard"]');
    return (w?.getAttribute("data-step-index") ?? "-") + "/" + (window.localStorage.getItem("openbuddy.onboarding.state") ? JSON.parse(window.localStorage.getItem("openbuddy.onboarding.state")).status : "null");
  }));
  await page.waitForTimeout(1000);
}
console.log("samples:", samples.join(" "));
await app.close();
process.exit(0);
