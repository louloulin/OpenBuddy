import { _electron as electron } from "playwright";
import { join } from "node:path";
const root = "/Users/louloulin/appx/OpenBuddy";
const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "dist/main/index.js")], cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const cs = (el) => el ? getComputedStyle(el) : null;
  const info = (el) => el ? {
    cls: (el.className || "").toString().slice(0, 60),
    bg: cs(el).backgroundColor, color: cs(el).color, radius: cs(el).borderRadius,
    text: el.textContent?.trim().slice(0, 60),
  } : null;
  const tokens = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  return {
    bgSecondary: tokens("--wb-bg-secondary"),
    bgTertiary: tokens("--wb-bg-tertiary"),
    bgPrimary: tokens("--wb-bg-primary"),
    paletteGray2: tokens("--wb-palette-gray-2"),
    userBubble: info(q(".msg--user .msg__bubble")),
    userMsg: info(q(".msg--user")),
    assistantBubble: info(q(".msg--assistant .msg__bubble")),
    anyBubble: info(q(".msg__bubble")),
    theme: document.documentElement.getAttribute("data-theme"),
  };
});
console.log(JSON.stringify(r, null, 2));
await app.close();
