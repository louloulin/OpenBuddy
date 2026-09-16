import { _electron as electron } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/louloulin/appx/OpenBuddy";
const outDir = "/tmp/openbuddy-screenshots";
mkdirSync(outDir, { recursive: true });

const app = await electron.launch({
  executablePath: join(root, "node_modules", ".bin", "electron"),
  args: [join(root, "out/main/index.js")],
  cwd: root,
});
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(2500);

// Full page screenshot of just the chat scroll area
const chatArea = await page.$(".chatview__scroll, .chatview");
if (chatArea) {
  await chatArea.screenshot({ path: join(outDir, "03-chat-area.png") });
}
await page.screenshot({ path: join(outDir, "03-full.png") });

const msgReport = await page.evaluate(() => {
  const out = { messages: [], bubbles: [], composer: null, header: null };
  document.querySelectorAll(".msg").forEach((m, i) => {
    if (i > 6) return;
    const r = m.getBoundingClientRect();
    const cs = getComputedStyle(m);
    const cls = typeof m.className === "string" ? m.className : "";
    const bubble = m.querySelector(".msg__bubble");
    const avatar = m.querySelector(".msg__avatar");
    const role = m.querySelector(".msg__role");
    const meta = m.querySelector(".msg__meta");
    const bcs = bubble ? getComputedStyle(bubble) : null;
    const br = bubble ? bubble.getBoundingClientRect() : null;
    out.messages.push({
      idx: i,
      cls,
      role: cls.includes("msg--assistant") ? "assistant" : cls.includes("msg--user") ? "user" : "?",
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      display: cs.display,
      hasAvatar: !!avatar,
      hasRole: !!role,
      roleText: role ? role.textContent : null,
      hasMeta: !!meta,
      metaText: meta ? meta.textContent.trim().slice(0, 40) : null,
      bubble: bcs ? {
        x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height),
        bg: bcs.backgroundColor,
        color: bcs.color,
        radius: bcs.borderRadius,
        padding: bcs.padding,
        fontSize: bcs.fontSize,
        lineHeight: bcs.lineHeight,
        maxWidth: bcs.maxWidth,
      } : null,
    });
  });

  const composer = document.querySelector(".wb-composer, .composer");
  if (composer) {
    const r = composer.getBoundingClientRect();
    const cs = getComputedStyle(composer);
    out.composer = {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor, radius: cs.borderRadius, border: cs.border,
      maxWidth: cs.maxWidth, padding: cs.padding,
    };
  }

  const header = document.querySelector(".chatview__header, .main-topbar");
  if (header) {
    const r = header.getBoundingClientRect();
    const cs = getComputedStyle(header);
    out.header = {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      bg: cs.backgroundColor,
    };
  }
  return out;
});

writeFileSync(join(outDir, "03-messages.json"), JSON.stringify(msgReport, null, 2));
console.log(JSON.stringify(msgReport, null, 2));
await app.close();
