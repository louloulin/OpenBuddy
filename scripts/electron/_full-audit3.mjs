import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-a3-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30000 });
await page.waitForTimeout(4000);

const audit = await page.evaluate(() => {
  // Find any class names that contain 'scene', 'home', 'topbar', 'status'
  const found = {};
  const all = Array.from(document.querySelectorAll("*"));
  for (const el of all) {
    const cls = (el.className ?? "").toString();
    for (const keyword of ["scene", "home", "topbar", "statusbar"]) {
      if (cls.toLowerCase().includes(keyword) && !found[keyword]) {
        found[keyword] = {
          tag: el.tagName.toLowerCase(),
          cls: cls.slice(0, 100),
          text: el.textContent?.trim().slice(0, 80),
        };
      }
    }
  }
  return found;
});

console.log(JSON.stringify(audit, null, 2));

// Also screenshot to /tmp for verification
await page.screenshot({ path: "/tmp/ob-current-state.png" });
console.log("\nSaved /tmp/ob-current-state.png");

await app.close();
