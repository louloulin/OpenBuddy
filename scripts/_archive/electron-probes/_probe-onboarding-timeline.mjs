/** 首启引导时间线探针：全新 profile 下每秒采样 wizard 是否存在 / 第几步。 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-onb-tl-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const samples = [];
const read = () => page.evaluate(() => {
  const w = document.querySelector('[data-testid="onboarding-wizard"]');
  const raw = window.localStorage.getItem("openbuddy.onboarding.state");
  let status = null;
  try { status = raw ? JSON.parse(raw).status : null; } catch { status = "corrupt"; }
  return { wizard: !!w, index: w?.getAttribute("data-step-index") ?? null, stepId: w?.getAttribute("data-step-id") ?? null, status };
});
for (let i = 0; i < 24; i += 1) {
  try { samples.push({ t: i, ...(await read()) }); } catch (e) { samples.push({ t: i, error: String(e).slice(0, 60) }); break; }
  await page.waitForTimeout(1000);
}
console.log(JSON.stringify(samples, null, 0));
await app.close();
process.exit(0);
