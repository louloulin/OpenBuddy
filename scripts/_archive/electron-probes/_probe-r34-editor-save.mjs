/**
 * R34 真机探针:Phase C 收尾 —— 「打开 markdown 产物 → 富文本编辑 → 保存」是真的在跑。
 *
 * 为什么需要这条探针:
 *   链路(ui-editor 的 `editor.body` 槽 → ToolSidePanel 的 FilePreview → 
 *   `write_text_file` IPC)在代码里是通的,但在此之前**没有任何断言**证明它
 *   端到端可用。`_probe-editor-flow.mjs` 只 `console.log` 扫描结果,不判定 ——
 *   那不是证据。这条探针走的是纯用户路径:
 *
 *     1. 建一个会话,工作区里有一个 README.md
 *     2. 点工具栏「工作区文件树」→ 左列列出文件
 *     3. 点 README.md → 主列出现文件预览纯文本
 *     4. 点「编辑」→ 内核 `editor.body` 槽给出的 TipTap 编辑器渲染出来,
 *        并且 markdown 被**真的转成了富文本**(h1 元素存在,不是 textarea)
 *     5. 键盘输入一行标记文本
 *     6. 点「保存」→ 磁盘上的文件真的变了
 *
 * 断言的关键点:**保存前磁盘没变**(证明写入发生在点保存那一刻,不是编辑时),
 * 保存后**原文仍在**(证明 markdown↔HTML 往返没有静默重写用户的文档)。
 *
 * 截图默认不写盘(探针会重排像素);需要视觉资产时:
 *   OPENBUDDY_PROBE_SHOTS=1 node scripts/electron/_probe-r34-editor-save.mjs
 */
import { _electron as electron } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHOTS_ENABLED = process.env.OPENBUDDY_PROBE_SHOTS === "1";
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const MARKER = `PROBE-R34-${Date.now().toString(36)}`;
const ORIGINAL = [
  "# 探针文档",
  "",
  "这一行必须在保存后仍然存在 —— 往返丢失它就是静默重写用户的文档。",
  "",
  "- 列表项一",
  "- 列表项二",
  "",
].join("\n");

const userData = mkdtempSync(join(tmpdir(), "ob-r34-editor-"));
mkdirSync(join(userData, "pi-agent"), { recursive: true });
// 会话落盘走 agentHome(),不是 --user-data-dir;不隔离会在用户真实的
// ~/.openbuddy/agent/sessions/ 里留下临时工作区。
const agentDir = mkdtempSync(join(tmpdir(), "ob-r34-agent-"));
const workspace = mkdtempSync(join(tmpdir(), "ob-r34-ws-"));
const docPath = join(workspace, "README.md");
writeFileSync(docPath, ORIGINAL);

const report = { steps: [], ok: false, pageErrors: [] };
const step = (name, ok, detail) => report.steps.push({ step: name, ok: Boolean(ok), detail });

const app = await electron.launch({
  args: [`--user-data-dir=${userData}`, root],
  executablePath: join(root, "node_modules", ".bin", "electron"),
  cwd: root,
  timeout: 60000,
  env: {
    ...process.env,
    ELECTRON_RENDERER_URL: "",
    OPENBUDDY_DEBUG_UI: "0",
    OPENBUDDY_AGENT_DIR: agentDir,
  },
});

try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.message ?? error)));
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(2500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(400);

  // ── 0. 建会话并激活(与 R28 探针同一条路径) ──
  const created = await page.evaluate(async (cwd) => {
    try {
      return await window.api.invoke("agent:new-session", { cwd });
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }, workspace);
  const sessionId =
    created && typeof created === "object" && typeof created.sessionId === "string"
      ? created.sessionId
      : null;
  step("agent:new-session 真的建出会话", Boolean(sessionId), JSON.stringify(created).slice(0, 300));
  if (!sessionId) throw new Error("无法创建会话,后续步骤全部无意义");

  await page.evaluate(
    ([sid, cwd]) => {
      localStorage.setItem("openbuddy.active-session", JSON.stringify({ sessionId: sid, cwd }));
    },
    [sessionId, created.cwd ?? workspace],
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.api?.apiVersion === 1), undefined, {
    timeout: 40000,
  });
  await page.waitForTimeout(3500);
  await page
    .click("[data-testid='onboarding-wizard'] [aria-label='关闭引导']", { timeout: 2000 })
    .catch(() => {});
  await page.waitForTimeout(600);

  // ── 1. 工具栏「工作区文件树」 ──
  const openedTree = await page.evaluate(() => {
    const button = document.querySelector("button[aria-label='工作区文件树']");
    if (button instanceof HTMLElement) {
      button.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(2500);
  const treeMounted = await page.evaluate(() => {
    const tree = document.querySelector("[data-testid='file-tree']");
    if (!tree) return { mounted: false };
    const rows = Array.from(tree.querySelectorAll("[role='treeitem']"));
    return {
      mounted: true,
      rows: rows.length,
      names: rows.map((row) => row.textContent?.trim() ?? "").slice(0, 12),
      hasDoc: rows.some((row) => (row.textContent ?? "").includes("README.md")),
    };
  });
  step("点「工作区文件树」真的挂载文件树", openedTree && treeMounted.mounted, JSON.stringify(treeMounted));
  step("工作区里的 README.md 出现在树里", treeMounted.hasDoc, JSON.stringify(treeMounted.names));
  if (!treeMounted.hasDoc) throw new Error("文件树里没有 README.md,无法继续");

  // ── 2. 点文件 → 纯文本预览 ──
  const clickedRow = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("[data-testid='file-tree'] [role='treeitem']"));
    const row = rows.find((item) => (item.textContent ?? "").includes("README.md"));
    if (row instanceof HTMLElement) {
      row.click();
      return true;
    }
    return false;
  });
  await page.waitForTimeout(2000);
  const preview = await page.evaluate(() => ({
    hasBody: Boolean(document.querySelector(".file-preview__body")),
    body: document.querySelector(".file-preview__body")?.textContent ?? null,
    path: document.querySelector(".file-preview__path")?.textContent ?? null,
    editButton: Boolean(document.querySelector(".file-preview__open[aria-label='编辑']")),
  }));
  step("点文件后主列真的读出文件内容", clickedRow && preview.hasBody && (preview.body ?? "").includes("探针文档"), JSON.stringify({ path: preview.path, len: preview.body?.length ?? 0 }));
  // 这条很关键:宿主没装 `editor.body` 实现时不该出现「编辑」入口(点了没反应的按钮)。
  step("markdown 文件出现「编辑」入口(说明 editor.body 槽有实现)", preview.editButton, String(preview.path));

  // ── 3. 点「编辑」→ TipTap 富文本 ──
  await page.click(".file-preview__open[aria-label='编辑']");
  await page.waitForTimeout(2000);
  const editorState = await page.evaluate(() => {
    const host = document.querySelector("[data-testid='file-preview-editor']");
    const pm = host?.querySelector(".ProseMirror");
    if (!host || !pm) return { mounted: false };
    return {
      mounted: true,
      headings: host.querySelectorAll("h1, h2, h3").length,
      listItems: host.querySelectorAll("li").length,
      text: (pm.textContent ?? "").slice(0, 200),
      editable: pm.getAttribute("contenteditable"),
      isTextarea: Boolean(host.querySelector("textarea")),
    };
  });
  step("「编辑」渲染出内核 editor.body 槽的编辑器", editorState.mounted, JSON.stringify(editorState).slice(0, 300));
  step("markdown 真的转成富文本(h1 + li,不是 textarea)", editorState.headings >= 1 && editorState.listItems >= 2 && !editorState.isTextarea, `h=${editorState.headings} li=${editorState.listItems}`);

  // ── 4. 键盘输入一行标记 ──
  // 把光标落到文末再加一行。
  // 不用 select-all + ArrowRight:AllSelection 在 ProseMirror 里不保证被方向键
  // 折叠,一旦没折叠,回车和输入就会**整篇替换** —— 探针测的就成了"覆盖"而不是
  // "追加"。也不用块级 bounding rect:块的内容盒可能比可点击区域宽(或 Range 的
  // client rects 退化成 2px),点下去落到编辑器外面,焦点跑掉。
  const pm = await page.$("[data-testid='file-preview-editor'] .ProseMirror");
  const pmBox = await pm.boundingBox();
  if (!pmBox) throw new Error("编辑器没有可见的 box,无法把光标放到文末");
  await pm.click({ position: { x: 10, y: Math.max(4, pmBox.height - 8) } });
  await page.waitForTimeout(300);
  report.caretDebug = await page.evaluate(() => {
    const sel = window.getSelection();
    return {
      active: (document.activeElement?.className ?? "") + "|" + (document.activeElement?.tagName ?? ""),
      anchor: sel?.anchorNode ? `${sel.anchorNode.nodeName}:${(sel.anchorNode.textContent ?? "").slice(0, 20)}` : null,
      collapsed: sel?.isCollapsed ?? null,
    };
  });
  await page.keyboard.press("ControlOrMeta+ArrowDown"); // mac:移到文档末尾
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type(MARKER);
  await page.waitForTimeout(800);
  const typed = await page.evaluate((marker) => {
    const pm = document.querySelector("[data-testid='file-preview-editor'] .ProseMirror");
    return {
      hasMarker: (pm?.textContent ?? "").includes(marker),
      hasOriginal: (pm?.textContent ?? "").includes("探针文档"),
      text: (pm?.textContent ?? "").slice(-120),
    };
  }, MARKER);
  step("键盘输入真的进了编辑器(onChange 回传)", typed.hasMarker, JSON.stringify(typed));
  step("输入是追加,没有把原文整篇替换掉", typed.hasOriginal, JSON.stringify(typed));

  // ── 5. 保存前:磁盘必须还没变 ──
  const beforeSave = readFileSync(docPath, "utf8");
  step("点保存之前磁盘文件没有被改动", !beforeSave.includes(MARKER) && beforeSave === ORIGINAL, `len=${beforeSave.length}`);

  // ── 6. 点「保存」──
  await page.click(".file-preview__open[aria-label='保存']");
  await page.waitForTimeout(2500);
  const afterSave = readFileSync(docPath, "utf8");
  const saveUi = await page.evaluate(() => ({
    stillEditing: Boolean(document.querySelector("[data-testid='file-preview-editor']")),
    body: document.querySelector(".file-preview__body")?.textContent ?? null,
  }));
  step("点「保存」把标记文本真的写进磁盘", afterSave.includes(MARKER), JSON.stringify({ len: afterSave.length, tail: afterSave.slice(-80) }));
  step("原文在往返后仍然存在(没有静默重写用户文档)", afterSave.includes("探针文档") && afterSave.includes("列表项一") && afterSave.includes("这一行必须在保存后仍然存在"), JSON.stringify({ len: afterSave.length }));
  step(
    "markdown 结构往返保真(标题仍是 '# ',列表仍是 '- ')",
    /^#\s+探针文档/m.test(afterSave) && /^-\s+列表项一/m.test(afterSave),
    JSON.stringify(afterSave.slice(0, 160)),
  );
  step("保存后退出编辑态并回到预览", !saveUi.stillEditing && (saveUi.body ?? "").includes(MARKER), JSON.stringify(saveUi).slice(0, 200));

  // ── 7. 重新读盘一次(重开预览)确认落盘内容一致 ──
  const reread = await page.evaluate(async (p) => {
    try {
      return await window.api.invoke("read_text_file", { path: p, cwd: null, maxBytes: 262144 });
    } catch (error) {
      return { error: String(error) };
    }
  }, docPath);
  step("重新 read_text_file 读回的就是新内容", typeof reread === "string" && reread.includes(MARKER), JSON.stringify({ len: typeof reread === "string" ? reread.length : -1 }));

  if (SHOTS_ENABLED) {
    await page.screenshot({ path: "tests/screenshots/r34-editor-save.png" });
  }

  report.ok = report.steps.every((item) => item.ok) && report.pageErrors.length === 0;
} catch (error) {
  report.error = String(error?.stack ?? error);
} finally {
  await app.close().catch(() => {});
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
