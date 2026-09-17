/**
 * @openbuddy/ui-workbench/client — apply() 注册 SearchOverlay 到 shell.overlay slot。
 */
import type { UiRuntimeContext } from "@openbuddy/ui-slots";
import { SearchOverlay } from "./SearchOverlay";
import { DocxPreview } from "./DocxPreview";
import { XlsxPreview } from "./XlsxPreview";
import { PptxPreview } from "./PptxPreview";

export function apply(ctx: UiRuntimeContext): () => void {
  // shell.overlay:向 AppFrame 这类「统一 overlay 层」消费者暴露（list 追加语义）。
  const disposeOverlay = ctx.slots.register(
    { name: "shell.overlay", kind: "list", scope: "root", id: "search", registrant: "@openbuddy/ui-workbench" },
    SearchOverlay as never
  );
  // overlay.search:给 AppShell 这样的「按名字取用」消费者一个可整体替换的入口。
  // 第三方插件注册同名单例 slot 即可接管搜索面板，无需改动 AppShell。
  const disposeNamed = ctx.slots.register(
    { name: "overlay.search", kind: "single", scope: "root", registrant: "@openbuddy/ui-workbench" },
    SearchOverlay as never
  );
  // R68 — Office 三件套预览槽(单一插槽,可整体替换)。内置 DocxPreview /
  // XlsxPreview / PptxPreview 已是懒加载 + 失败回落,与 PdfJsPreview 同构,
  // 第三方插件以更高 priority 注册同名单例即可整体接管对应格式,无需改
  // FilePreview。FilePreview 后续会按需改成读槽(保持向后兼容)。
  const disposeDocx = ctx.slots.register(
    { name: "workbench.preview.docx", kind: "single", scope: "root", registrant: "@openbuddy/ui-workbench" },
    DocxPreview as never
  );
  const disposeXlsx = ctx.slots.register(
    { name: "workbench.preview.xlsx", kind: "single", scope: "root", registrant: "@openbuddy/ui-workbench" },
    XlsxPreview as never
  );
  const disposePptx = ctx.slots.register(
    { name: "workbench.preview.pptx", kind: "single", scope: "root", registrant: "@openbuddy/ui-workbench" },
    PptxPreview as never
  );
  return () => {
    disposeNamed();
    disposeOverlay();
    disposeDocx();
    disposeXlsx();
    disposePptx();
  };
}
