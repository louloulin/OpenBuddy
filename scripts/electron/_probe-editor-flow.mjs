/**
 * 编辑器落地真实路径探针 v2: 用模糊匹配扫描所有 [class*="file-preview"],
 * [class*="tool-call"], [class*="prose"] 等真实类名。
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-editor-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
await page.waitForTimeout(15000);
await page.evaluate(() => { for (const el of [...document.querySelectorAll("*")]) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== "none") el.remove(); } });
await page.waitForTimeout(500);

const sessions = await page.evaluate(() => [...document.querySelectorAll(".sidebar__conv-wrap")].map((el) => el.textContent?.trim().slice(0, 30) || "?"));
let chosen = null;
for (let i = 0; i < Math.min(sessions.length, 25); i++) {
  await page.evaluate((idx) => { document.querySelectorAll(".sidebar__conv-wrap")[idx]?.click(); }, i);
  await page.waitForTimeout(2800);
  const scan = await page.evaluate(() => {
    const fuzzy = (s) => document.querySelectorAll(`[class*="${s}"]`).length;
    return {
      toolCalls: fuzzy("tool-call"),
      filePreviews: fuzzy("file-preview") - fuzzy("file-preview-edit") - fuzzy("file-preview-editor"),
      filePreviewEdits: fuzzy("file-preview-edit") + fuzzy("file-preview__edit"),
      proseMirror: fuzzy("ProseMirror"),
      toolSidePanels: fuzzy("ToolSidePanel") + fuzzy("tool-side-panel"),
      toolResultTabs: fuzzy("tool-result-tab") + fuzzy("ToolResult"),
      // 取 chatview 全文里出现 'edit' / '保存' 的可点击节点
      buttonsWithEdit: [...document.querySelectorAll("button")].filter((b) => /^(编辑|Edit|edit)$/.test((b.textContent || "").trim())).length,
    };
  });
  if (scan.filePreviews > 0 || scan.proseMirror > 0) {
    chosen = { session: sessions[i], scan };
    break;
  }
}
console.log("sessions:", sessionsCount(sessions), "chosen:", JSON.stringify(chosen, null, 2));
// 如果还没找到，扫一下全部 session 找含 .ProseMirror 或 [class*=file-preview] 最多的那个
if (!chosen) {
  const scanAll = await page.evaluate(async () => {
    // 同步扫：不能 await pageevaluate click
    const out = [];
    const sess = document.querySelectorAll(".sidebar__conv-wrap");
    return { totalSessions: sess.length };
  });
  console.log("scanAll:", JSON.stringify(scanAll));
}
console.log("errors:", errors);
await page.screenshot({ path: "/tmp/ob-editor-flow.png" });
await app.close();
process.exit(0);

function sessionsCount(arr) { return arr.length; }
