import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const userData = mkdtempSync(join(tmpdir(), "ob-editor-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
mkdirSync(join(ROOT, "tests/screenshots"), { recursive: true });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, ROOT],
  executablePath: join(ROOT, "node_modules", ".bin", "electron"),
  timeout: 30_000,
});
const page = await app.firstWindow({ timeout: 30_000 });
await page.waitForTimeout(15_000);
await page.click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 1500 }).catch(() => {});
await page.waitForTimeout(1500);

const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));

// 1. Find the Tiptap editor
const editorInfo = await page.evaluate(() => {
  const tiptap = document.querySelector(".tiptap, .ProseMirror, [data-tiptap-editor]");
  const composer = document.querySelector(".wb-composer");
  const composerInput = composer?.querySelector(".wb-composer__input");
  const result = {
    tiptapFound: !!tiptap,
    tiptapClass: tiptap?.className,
    tiptapEditable: tiptap?.getAttribute("contenteditable"),
    composerFound: !!composer,
    composerInputFound: !!composerInput,
    composerInputTag: composerInput?.tagName,
    composerInputEditable: composerInput?.getAttribute("contenteditable"),
    composerParentClass: composer?.parentElement?.className,
    children: Array.from(document.querySelectorAll("[contenteditable]")).map((el) => ({
      tag: el.tagName,
      cls: el.className?.toString().slice(0, 100),
    })),
  };
  return result;
});
console.log("EDITOR:", JSON.stringify(editorInfo, null, 2));

// 2. Try to find tool side panel + tiptap
const toolSidePanel = await page.evaluate(() => {
  const panels = Array.from(document.querySelectorAll("[class*='tool-side'], [class*='ToolSide'], [data-panel='tool']"));
  return panels.length;
});
console.log("TOOL_SIDE_PANELS:", toolSidePanel);

// 3. Find the editor in ToolSidePanel if exists
const toolEditor = await page.evaluate(() => {
  const tiptap = document.querySelector(".tiptap, .ProseMirror, [data-tiptap-editor]");
  if (!tiptap) return null;
  let parent = tiptap;
  while (parent && parent !== document.body) {
    if (parent.className?.toString().includes("tool-side")) {
      return { found: true, parentClass: parent.className };
    }
    parent = parent.parentElement;
  }
  return { found: false, parents: [] };
});
console.log("TOOL_EDITOR:", JSON.stringify(toolEditor));

// 4. Test paste long markdown into editor if found
const editorEl = await page.$(".tiptap, .ProseMirror");
if (editorEl) {
  await editorEl.click();
  await page.waitForTimeout(500);
  const longMd = `# Heading\n\n${"This is a paragraph with **bold** and *italic* and \`code\`.\n".repeat(50)}\n\n\`\`\`js\nconsole.log("hello");\n${"// comment\n".repeat(20)}\n\`\`\`\n\n| Col1 | Col2 |\n|------|------|\n${"| cell | cell |\n".repeat(20)}\n\n- item 1\n- item 2\n${"- item\n".repeat(30)}\n`;
  await page.keyboard.type(longMd.slice(0, 200)); // type first 200 chars
  await page.waitForTimeout(500);
  // Then paste remaining
  await page.evaluate(async (text) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    const tiptap = document.querySelector(".tiptap, .ProseMirror");
    tiptap?.dispatchEvent(ev);
  }, longMd);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(ROOT, "tests/screenshots/r18-editor-long.png") });
  const state = await page.evaluate(() => {
    const t = document.querySelector(".tiptap, .ProseMirror");
    return { html: t?.innerHTML?.slice(0, 500), len: t?.innerHTML?.length };
  });
  console.log("EDITOR_STATE:", JSON.stringify(state));
} else {
  console.log("NO_TIPTAP_EDITOR_FOUND");
}

console.log("PAGE_ERRORS:", JSON.stringify(errs));
await app.close();
process.exit(0);
