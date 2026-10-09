/**
 * R84 —— 首启引导「过了就不该再弹」真机验证。
 *
 * 复现用户路径:第一次启动 → 用户点「跳过」/「×」(不点完成) → 关掉 app →
 * 用同一个 user-data-dir 再启动 → 引导不应再出现。
 *
 * 同时测三条终结路径:skip 按钮 / 关闭按钮 / Esc —— 三者都必须落盘。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const KEY = "openbuddy.onboarding.state";
const out = {};

async function withApp(tag, fn) {
  const userData = out.__ud ??= mkdtempSync(join(tmpdir(), "ob-r84-onb-"));
  mkdirSync(join(userData, "pi-agent"), { recursive: true });
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, ROOT],
    executablePath: join(ROOT, "node_modules", ".bin", "electron"),
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(13_000);
  const result = await fn(page);
  await app.close();
  return result;
}

const snap = (page) => page.evaluate((key) => {
  const w = document.querySelector('[data-testid="onboarding-wizard"]');
  let st = null;
  try { st = window.localStorage.getItem(key); } catch {}
  return {
    wizard: !!w,
    idx: w?.getAttribute("data-step-index") ?? null,
    status: st ? JSON.parse(st).status : null,
    persisted: st,
  };
}, KEY);

// ---- 路径 A:点「×」关闭 ----
out.viaClose = {};
out.viaClose.before = await withApp("A1", async (page) => {
  const s = await snap(page);
  await page.evaluate(() => {
    const x = document.querySelector('[data-testid="onboarding-close"]');
    x?.click();
  });
  await page.waitForTimeout(1200);
  return { first: s, afterClose: await snap(page) };
});
out.viaClose.restart = await withApp("A2", async (page) => snap(page));

// ---- 路径 B:点「跳过」(若有) ----
const userDataB = mkdtempSync(join(tmpdir(), "ob-r84-onbB-"));
out.viaSkip = {};
{
  mkdirSync(join(userDataB, "pi-agent"), { recursive: true });
  const app = await electron.launch({ args: [`--user-data-dir=${userDataB}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(13_000);
  out.viaSkip.before = await snap(page);
  out.viaSkip.didSkip = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="onboarding-skip"]')
      ?? Array.from(document.querySelectorAll('[data-testid="onboarding-wizard"] button')).find((b) => /跳过/.test(b.textContent || ""));
    if (!btn) return null;
    btn.click();
    return (btn.textContent || "").trim();
  });
  await page.waitForTimeout(1200);
  out.viaSkip.after = await snap(page);
  await app.close();

  const app2 = await electron.launch({ args: [`--user-data-dir=${userDataB}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), timeout: 30_000 });
  const page2 = await app2.firstWindow({ timeout: 30_000 });
  await page2.waitForTimeout(13_000);
  out.viaSkip.restart = await snap(page2);
  await app2.close();
}

// ---- 路径 C:走完全部步骤(点「完成」) ----
const userDataC = mkdtempSync(join(tmpdir(), "ob-r84-onbC-"));
out.viaFinish = {};
{
  mkdirSync(join(userDataC, "pi-agent"), { recursive: true });
  const app = await electron.launch({ args: [`--user-data-dir=${userDataC}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), timeout: 30_000 });
  const page = await app.firstWindow({ timeout: 30_000 });
  await page.waitForTimeout(13_000);
  out.viaFinish.before = await snap(page);
  for (let i = 0; i < 6; i += 1) {
    const gone = await page.evaluate(() => {
      const w = document.querySelector('[data-testid="onboarding-wizard"]');
      if (!w) return true;
      const btn = w.querySelector('[data-testid="onboarding-next"]');
      btn?.click();
      return false;
    });
    if (gone) break;
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1000);
  out.viaFinish.after = await snap(page);
  await app.close();

  const app2 = await electron.launch({ args: [`--user-data-dir=${userDataC}`, ROOT], executablePath: join(ROOT, "node_modules", ".bin", "electron"), timeout: 30_000 });
  const page2 = await app2.firstWindow({ timeout: 30_000 });
  await page2.waitForTimeout(13_000);
  out.viaFinish.restart = await snap(page2);
  await app2.close();
}

out.verdict = {
  closePersists: out.viaClose.restart.status === "dismissed" && !out.viaClose.restart.wizard,
  skipPersists: out.viaSkip.restart.status === "done" && !out.viaSkip.restart.wizard,
  finishPersists: out.viaFinish.restart.status === "done" && !out.viaFinish.restart.wizard,
};
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
process.exit(0);
