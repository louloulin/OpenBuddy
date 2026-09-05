import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog } from "@openbuddy/ui-dialogs";
import { PromptDialog } from "@openbuddy/ui-dialogs";
import { writeFileSync } from "fs";
import { test, expect } from "vitest";

const noop = () => {};

test("render dialogs preview", () => {
  const cssLink = (href: string) => `<link rel="stylesheet" href="${href}">`;
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>Email Dialog Style Preview</title>
${cssLink("src/styles/global.css")}
${cssLink("src/styles/tokens.css")}
${cssLink("src/styles/app.css")}
<style>
body { padding: 40px; background: linear-gradient(180deg, #f4f5f7, #e9eaee); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
h1 { font-size: 24px; font-weight: 700; color: #202124; margin-bottom: 8px; }
h2 { font-size: 16px; font-weight: 600; color: #555; margin: 32px 0 12px; }
.preview-overlay {
  position: relative !important;
  inset: auto !important;
  z-index: 1 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  background: transparent !important;
  backdrop-filter: none !important;
  animation: none !important;
  margin-bottom: 24px !important;
  border-radius: 16px !important;
}
</style>
</head>
<body>
<h1>Email Dialog Style Preview (新设计)</h1>

<h2>1. ConfirmDialog — info tone (默认)</h2>
<div class="preview-overlay">
${renderToStaticMarkup(
  <ConfirmDialog open title="标记已读" description="将此线程标记为已读？已读状态会同步到你的邮箱服务商。" confirmLabel="确认标记已读" onConfirm={noop} onCancel={noop} />,
)}
</div>

<h2>2. ConfirmDialog — danger tone (删除)</h2>
<div class="preview-overlay">
${renderToStaticMarkup(
  <ConfirmDialog open title="移入垃圾箱" description="确认将此线程移入垃圾箱？此操作会改变远端邮箱状态。" confirmLabel="移入垃圾箱" tone="danger" onConfirm={noop} onCancel={noop} />,
)}
</div>

<h2>3. ConfirmDialog — warning tone (批量操作)</h2>
<div class="preview-overlay">
${renderToStaticMarkup(
  <ConfirmDialog open title="批量「归档」" description="确认对 5 个线程执行「归档»?" tone="warning" confirmLabel="归档" onConfirm={noop} onCancel={noop} />,
)}
</div>

<h2>4. PromptDialog — 添加标签</h2>
<div class="preview-overlay">
${renderToStaticMarkup(
  <PromptDialog open title="添加标签" description="为这个线程添加一个新标签" placeholder="例如：重要客户" hint="提示：标签会同步到你的邮箱账户" confirmLabel="添加" onConfirm={noop} onCancel={noop} />,
)}
</div>

</body>
</html>`;

  writeFileSync("dialog-preview.html", html);
  expect(html.length).toBeGreaterThan(1000);
});
