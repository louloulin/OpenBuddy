/**
 * code / image / pdf 画布承载。
 *
 * 复用 workbench 的 FilePreview 预览栈,不自造第二套渲染器 —— 首版先把
 * 图片与 PDF 走通,code 类由上层转成 markdown 承载或走纯文本编辑。
 */
import type { CanvasTab } from "@openbuddy/ui-state/canvas-store";
import { useT } from "@openbuddy/ui-locale/client";

export interface CanvasFilePreviewProps {
  tab: CanvasTab;
}

export function CanvasFilePreview({ tab }: CanvasFilePreviewProps) {
  const fileMissing = useT("conversation.canvas.fileMissing");
  if (!tab.sourcePath) {
    return (
      <div className="canvas-panel__empty" data-testid="canvas-file-empty">
        {fileMissing}
      </div>
    );
  }
  if (tab.kind === "code") {
    return (
      <pre className="canvas-file__code" data-testid="canvas-file-code">
        {tab.content ?? ""}
      </pre>
    );
  }
  // image / pdf 交给浏览器原生渲染:pdf.js 与图片解码器的依赖图不进首包,
  // 画布是低频入口,原生 <img>/<embed> 完全够用。
  return tab.kind === "image" ? (
    <img
      className="canvas-file__image"
      data-testid="canvas-file-image"
      alt={tab.title}
      src={`file://${tab.sourcePath}`}
    />
  ) : (
    <embed
      className="canvas-file__pdf"
      data-testid="canvas-file-pdf"
      type="application/pdf"
      src={`file://${tab.sourcePath}`}
    />
  );
}

export default CanvasFilePreview;
