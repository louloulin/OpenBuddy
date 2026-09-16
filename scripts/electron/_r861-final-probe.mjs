import { _electron as electron } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
mkdirSync("/tmp/openbuddy-screenshots/r861/final", { recursive: true });
const app = await electron.launch({
  executablePath: join(process.cwd(), "node_modules", ".bin", "electron"),
  args: [join(process.cwd(), "out/main/index.js"), "--no-sandbox"],
  cwd: process.cwd(),
  timeout: 90000,
});
const page = await app.firstWindow({ timeout: 60000 });
await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
await page.waitForTimeout(4500);
await page.evaluate(() => {
  const all = document.querySelectorAll("button, a");
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (t.includes("新建") || t.includes("Home")) { el.click(); return; }
  }
});
await page.waitForTimeout(1500);

// === Capture 1: Idle composer (light) ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.waitForTimeout(400);
const c1 = await page.evaluate(() => {
  const el = document.querySelector(".wb-composer");
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x - 20)), y: Math.max(0, Math.round(r.y - 20)), width: Math.round(r.width + 40), height: Math.round(r.height + 40) };
});
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/composer-idle-light.png", clip: c1 });

// === Capture 2: Idle composer (dark) ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "dark");
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/composer-idle-dark.png", clip: c1 });

// === Capture 3: Slash menu active (light) ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.waitForTimeout(400);
const ta = await page.evaluate(() => {
  const t = document.querySelector(".wb-composer__input");
  const r = t.getBoundingClientRect();
  t.focus();
  t.value = "/";
  t.dispatchEvent(new Event("input", { bubbles: true }));
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
await page.waitForTimeout(700);
const slashRect = await page.evaluate(() => {
  const s = document.querySelector(".slash-commands");
  if (!s) return null;
  const r = s.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x - 12)), y: Math.max(0, Math.round(r.y - 12)), width: Math.round(r.width + 24), height: Math.round(r.height + 24) };
});
if (slashRect) {
  await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/slash-active-light.png", clip: slashRect });
}

// === Capture 4: Slash menu active (dark) ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "dark");
await page.waitForTimeout(400);
if (slashRect) {
  await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/slash-active-dark.png", clip: slashRect });
}

// === Capture 5: Mock-inject mention items with active state ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// Inject a mock mention-picker directly to capture the active-item visuals
const injected = await page.evaluate(() => {
  const ta = document.querySelector(".wb-composer__input");
  ta.focus();
  ta.value = "@";
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
});
await page.waitForTimeout(300);

// Mock-inject items by dispatching a custom event - but easier: render a clone via test id
// Actually inject a real picker DOM via the openbuddy MentionPicker port at body
const mockItems = await page.evaluate(() => {
  const picker = document.createElement("div");
  picker.className = "mention-picker";
  picker.style.cssText = "position:fixed; top:140px; left:316px; width:420px; z-index:1100; background:#fff; border:1px solid rgba(0,0,0,0.08); border-radius:12px; box-shadow:0 12px 40px rgba(0,0,0,0.18),0 2px 8px rgba(0,0,0,0.08); display:flex; flex-direction:column; overflow:hidden; font-size:13px;";
  picker.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(0,0,0,0.06);color:#666;">
      <span style="display:inline-flex;align-items:center;color:#666;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 5.5 1.5"/></svg>
      </span>
      <span style="flex:1;font-family:ui-monospace,monospace;font-size:12px;color:#000;">搜索文件 / 文件夹</span>
    </div>
    <div style="flex:1;overflow-y:auto;padding:4px;">
      <button style="display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;cursor:pointer;text-align:left;font-size:12px;color:#000;font-family:ui-monospace,monospace;">
        <span style="color:#666;">📁</span>
        <span style="flex:1;">src/components/Composer.tsx</span>
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#666;background:#f3f4f6;padding:1px 6px;border-radius:4px;">file</span>
      </button>
      <button class="mention-picker__item--active" style="display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:rgba(0,0,0,0.75);cursor:pointer;text-align:left;font-size:12px;color:#fff;font-family:ui-monospace,monospace;">
        <span style="color:rgba(255,255,255,0.7);">📁</span>
        <span style="flex:1;">src/styles/composer.css</span>
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:rgba(255,255,255,0.7);background:rgba(255,255,255,0.18);padding:1px 6px;border-radius:4px;">file</span>
      </button>
      <button style="display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:none;border-radius:6px;background:transparent;cursor:pointer;text-align:left;font-size:12px;color:#000;font-family:ui-monospace,monospace;">
        <span style="color:#666;">📂</span>
        <span style="flex:1;">packages/ui/openbuddy-ui-conversation</span>
        <span style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#666;background:#f3f4f6;padding:1px 6px;border-radius:4px;">folder</span>
      </button>
    </div>
  `;
  document.body.appendChild(picker);
  const r = picker.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x - 12)), y: Math.max(0, Math.round(r.y - 12)), width: Math.round(r.width + 24), height: Math.round(r.height + 24) };
});
await page.waitForTimeout(200);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/mention-active-mock-light.png", clip: mockItems });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// === Capture 6: Composer with mock text typed (light) ===
await page.evaluate(t => { document.documentElement.setAttribute("data-theme", t); }, "light");
await page.waitForTimeout(300);
await page.mouse.click(c1.x + c1.width / 2, c1.y + c1.height / 2);
await page.waitForTimeout(200);
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);
await page.keyboard.type("帮我用 TypeScript 写一个 React 组件", { delay: 30 });
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/openbuddy-screenshots/r861/final/composer-typed-light.png", clip: c1 });

console.log("=== CAPTURES DONE ===");
console.log(JSON.stringify({ idleClip: c1, slashRect, mentionMockRect: mockItems }, null, 2));
await app.close();
