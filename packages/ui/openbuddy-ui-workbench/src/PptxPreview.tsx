/**
 * PPTX 内嵌预览 —— pptx-preview 逐页渲染成 DOM 幻灯片。
 *
 * 与 `PdfJsPreview` 同构:
 * - 库懒加载(dynamic import),并且 pptx-preview 会连带拉入 echarts,
 *   静态引入代价过大;
 * - 渲染宽度按容器实时宽度计算(容器为 0 时回退到 960px 逻辑宽度,jsdom
 *   与首帧都能拿到确定值),高度按 16:9 推导;
 * - 任何一步失败(库缺失、文件损坏、无 DOM 环境)都降级为 `fallback`,
 *   永不白屏;
 * - 卸载时调用 `destroy()` 释放 previewer 持有的 DOM 引用。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { decodeDataUrl, toArrayBuffer } from "./office-preview";
import { loadPptxPreview, type PptxPreviewer } from "./office-preview-loader";
import styles from "./OfficePreview.module.css";

/** 容器宽度取不到时的逻辑宽度(16:9)。 */
const FALLBACK_STAGE_WIDTH = 960;

type Phase = "loading" | "ready" | "error";

export interface PptxPreviewProps {
  filename: string;
  /** data URL 或裸 base64 的演示文稿内容。 */
  content: string;
  /** 加载失败 / 解析失败时渲染的降级视图。 */
  fallback: ReactNode;
  className?: string;
}

export function PptxPreview({ filename, content, fallback, className }: PptxPreviewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    let cancelled = false;
    let previewer: PptxPreviewer | null = null;
    setPhase("loading");
    node.replaceChildren();
    void (async () => {
      try {
        const mod = await loadPptxPreview();
        const bytes = decodeDataUrl(content);
        if (cancelled) return;
        const width = node.clientWidth || FALLBACK_STAGE_WIDTH;
        previewer = mod.init(node, {
          width,
          height: Math.round((width * 9) / 16),
          mode: "list",
        });
        await previewer.preview(toArrayBuffer(bytes));
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
      try {
        previewer?.destroy?.();
      } catch {
        /* destroy 失败不影响降级路径 */
      }
    };
  }, [content]);

  if (phase === "error") return <>{fallback}</>;

  return (
    <div
      className={cx("file-preview", "file-preview--pptx", styles.root, className)}
      data-office-kind="pptx"
    >
      <div className={cx("file-preview__head", styles.head)}>
        <span className={cx("file-preview__name", styles.name)}>{filename}</span>
        <span className={cx("file-preview__kind", styles.kind)}>PPTX</span>
      </div>
      <div className={cx("file-preview__pptx-scroll", styles.scroll)}>
        {phase === "loading" ? (
          <div className={styles.loading} role="status">
            演示文稿加载中…
          </div>
        ) : null}
        <div className={styles.pptxBody}>
          <div
            ref={stageRef}
            className={styles.pptxStage}
            data-testid="office-preview-body"
          />
        </div>
      </div>
    </div>
  );
}
