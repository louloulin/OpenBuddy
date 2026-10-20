import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const root = "/Users/louloulin/appx/OpenBuddy";
const userData = mkdtempSync(join(tmpdir(), "ob-chip-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root, timeout: 40_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: "", OPENBUDDY_DEBUG_UI: "0" },
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded", { timeout: 30_000 });
await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, { timeout: 30_000 });
await page.waitForTimeout(3000);

const result = await page.evaluate(() => {
  // Find all home__chip elements and their styles
  const chips = Array.from(document.querySelectorAll('.home__chip'));
  return chips.slice(0, 5).map(chip => {
    const r = chip.getBoundingClientRect();
    const cs = getComputedStyle(chip);
    return {
      text: chip.textContent?.trim().slice(0, 20),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor,
      border: cs.border,
      color: cs.color,
    };
  });
});
console.log(JSON.stringify(result, null, 2));
await app.close();
