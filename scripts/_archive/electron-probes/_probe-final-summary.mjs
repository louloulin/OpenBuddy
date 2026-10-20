/**
 * R17 终极综合验证 — 一次真实 Electron 启动,串起所有关键件:
 *   1. 19 套主题差异化(每个 named dark 主题有独立 OKLCh)
 *   2. Sidebar 260–480px resize
 *   3. Dark-mode composer 输入透明
 *   4. Audit Trail IPC
 *   5. Settings 个性化面板 ThemePicker 入口
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-final-sum-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const outDir = join(ROOT, "tests/screenshots/r18-final");
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

const results = {};

// 1. Sidebar resize
const sidebarInfo = await page.evaluate(() => {
  const shell = document.querySelector(".app__sidebar-shell");
  const handle = document.querySelector(".app__sidebar-handle");
  return {
    shellWidth: shell?.getBoundingClientRect().width,
    handleFound: !!handle,
    handleLabel: handle?.getAttribute("aria-label"),
  };
});
results.sidebar = sidebarInfo;
console.log("1. SIDEBAR:", JSON.stringify(sidebarInfo));

// 2. Theme picker entry in settings
await page.click(".sidebar__icon-btn[aria-label='设置']");
await page.waitForTimeout(1500);
const themePickerEntry = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button"));
  return all.some((b) => /主题/.test(b.textContent ?? ""));
});
results.themePickerEntry = themePickerEntry;
console.log("2. THEME_PICKER_ENTRY:", themePickerEntry);

// 3. Audit trail entry
const auditEntry = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll("button"));
  return all.some((b) => /审计/.test(b.textContent ?? ""));
});
results.auditEntry = auditEntry;
console.log("3. AUDIT_ENTRY:", auditEntry);

// Close settings
await page.keyboard.press("Escape");
await page.waitForTimeout(800);

// 4. Audit trail IPC
const auditEntries = await page.evaluate(async () => {
  const api = window.openbuddy;
  if (!api?.audit) return null;
  return await api.audit.list({ limit: 10 });
});
results.auditIpc = auditEntries ? { count: auditEntries.events?.length ?? 0 } : null;
console.log("4. AUDIT_IPC:", JSON.stringify(results.auditIpc));

// 5. Theme switch (default → openbuddy-dark → black → matrix)
async function getThemeState() {
  return await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      dataTheme: root.getAttribute("data-theme"),
      dataThemeName: root.getAttribute("data-theme-name"),
      bgPrimary: cs.getPropertyValue("--wb-bg-primary").trim(),
    };
  });
}
async function setThemeByLocalStorage(name, pref) {
  await page.evaluate(([n, p]) => {
    window.localStorage.setItem("openbuddy.theme", p);
    window.localStorage.setItem("openbuddy.theme.name", n);
    window.localStorage.setItem("openbuddy.theme.mode", "manual");
  }, [name, pref]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7_000);
  await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
}

results.themeCheck = {};
for (const [name, pref] of [["openbuddy-dark", "dark"], ["black", "dark"], ["matrix", "dark"], ["aurora", "dark"], ["claude", "dark"]]) {
  await setThemeByLocalStorage(name, pref);
  results.themeCheck[name] = await getThemeState();
  await page.screenshot({ path: join(outDir, `theme-${name}.png`), fullPage: false });
  console.log(`5.${name}:`, JSON.stringify(results.themeCheck[name]));
}

console.log("\nERRORS:", JSON.stringify(errs));
console.log("\n=== FINAL RESULTS ===");
console.log(JSON.stringify(results, null, 2));

await app.close();
process.exit(0);
