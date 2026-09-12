/**
 * PDF.js canvas 预览 —— office1 §9 PDF 专项(v2)。
 *
 * ChatGPT / Claude.ai 的聊天内 PDF 附件都走 PDF.js canvas 渲染
 * (见 office1.md §9.3),Cursor 降级为系统原生查看器。本组件对齐
 * 顶级工作台做法:
 * - 首屏只渲染前 MAX_INITIAL_PAGES 页,多页文档不再整包解码;
 * - devicePixelRatio 缩放,高分屏清晰;
 * - 任何一步失败(worker 缺失、损坏的 PDF、无 canvas 环境)都降级
 *   回 v1 的浏览器原生 iframe,保证永不白屏。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadPdfJs } from "./pdfjs-loader";

/** 首屏最多渲染的页数;更多页通过滚动懒加载触发。 */
const MAX_INITIAL_PAGES = 3;
/** 渲染宽度上限(px),超出等比缩小,避免超大页面撑破聊天气泡。 */
const MAX_PAGE_WIDTH = 720;

function base64ToBytes(content: string): Uint8Array {
  const comma = content.indexOf(",");
  const base64 = comma === -1 ? content : content.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function PdfJsPreview({
  filename,
  content,
  fallback,
}: {
  filename: string;
  content: string;
  /** pdfjs 不可用或解析失败时渲染的降级视图(iframe 原生预览)。 */
  fallback: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [renderedPages, setRenderedPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const loadingTask = pdfjs.getDocument({ data: base64ToBytes(content) });
        const destroyTask = (loadingTask as unknown as { destroy?: () => Promise<void> | void }).destroy;
        const doc = await loadingTask.promise;
        destroy = () =>
          void (typeof destroyTask === "function"
            ? destroyTask.call(loadingTask)
            : (doc as unknown as { destroy: () => Promise<void> | void }).destroy());
        if (cancelled) {
          destroy();
          return;
        }
        setPageCount(doc.numPages);
        const containerWidth =
          scrollRef.current?.clientWidth || MAX_PAGE_WIDTH;
        const dpr = window.devicePixelRatio || 1;
        const initial = Math.min(doc.numPages, MAX_INITIAL_PAGES);
        for (let n = 1; n <= initial; n++) {
          const page = await doc.getPage(n);
          if (cancelled) {
            destroy?.();
            return;
          }
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(
            1.6,
            Math.max(0.4, containerWidth / base.width),
          );
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.className = "file-preview__pdf-page";
          canvas.dataset.page = String(n);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          await page.render({
            canvas,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
          if (cancelled) return;
          scrollRef.current?.appendChild(canvas);
          setRenderedPages(n);
          page.cleanup();
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [content]);

  if (failed) return <>{fallback}</>;

  return (
    <div className="file-preview file-preview--pdf file-preview--pdfjs">
      <div className="file-preview__head">
        <span className="file-preview__name">{filename}</span>
        <span className="file-preview__kind">PDF</span>
        {pageCount !== null && (
          <span className="file-preview__pdf-meta">共 {pageCount} 页</span>
        )}
      </div>
      <div className="file-preview__pdf-scroll" ref={scrollRef}>
        {renderedPages === 0 && (
          <div className="file-preview__pdf-loading">PDF 加载中…</div>
        )}
      </div>
    </div>
  );
}
