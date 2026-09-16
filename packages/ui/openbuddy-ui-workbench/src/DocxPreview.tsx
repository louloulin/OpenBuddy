/**
 * DOCX 内嵌预览 —— docx-preview 渲染成 DOM。
 *
 * 与 `PdfJsPreview` 同构的降级策略:
 * - 库懒加载(dynamic import),主包零增量;
 * - 加载中显示占位文案,失败时渲染调用方传入的 `fallback`(通常是
 *   「用本地应用打开」的只读提示),**永不白屏**;
 * - 组件卸载 / content 变更时取消后续写入,避免把内容渲染进已卸载的节点。
 *
 * 渲染策略:`inWrapper: false`,让每个页面直接是容器下的
 * `<section class="docx">`,由 `OfficePreview.module.css` 的 `.docxBody > section`
 * 统一纸张化(带主题令牌的边框 / 圆角 / 阴影)。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { decodeDataUrl, toArrayBuffer } from "./office-preview";
import { loadDocxPreview } from "./office-preview-loader";
import styles from "./OfficePreview.module.css";

type Phase = "loading" | "ready" | "error";

export interface DocxPreviewProps {
  filename: string;
  /** data URL 或裸 base64 的文档内容。 */
  content: string;
  /** 加载失败 / 解析失败时渲染的降级视图。 */
  fallback: ReactNode;
  className?: string;
}

export function DocxPreview({ filename, content, fallback, className }: DocxPreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    let cancelled = false;
    setPhase("loading");
    node.replaceChildren();
    void (async () => {
      try {
        const mod = await loadDocxPreview();
        const bytes = decodeDataUrl(content);
        if (cancelled) return;
        await mod.renderAsync(toArrayBuffer(bytes), node, node, {
          className: "docx",
          inWrapper: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
        });
        if (cancelled) return;
        setPhase("ready");
      } catch {
        if (cancelled) return;
        node.replaceChildren();
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  if (phase === "error") return <>{fallback}</>;

  return (
    <div
      className={cx("file-preview", "file-preview--docx", styles.root, className)}
      data-office-kind="docx"
    >
      <div className={cx("file-preview__head", styles.head)}>
        <span className={cx("file-preview__name", styles.name)}>{filename}</span>
        <span className={cx("file-preview__kind", styles.kind)}>DOCX</span>
      </div>
      <div className={cx("file-preview__docx-scroll", styles.scroll)}>
        {phase === "loading" ? (
          <div className={styles.loading} role="status">
            文档加载中…
          </div>
        ) : null}
        <div
          ref={bodyRef}
          className={styles.docxBody}
          data-testid="office-preview-body"
        />
      </div>
    </div>
  );
}
