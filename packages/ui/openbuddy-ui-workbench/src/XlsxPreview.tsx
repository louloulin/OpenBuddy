/**
 * XLSX 内嵌预览 —— SheetJS 把每个工作表转成 HTML 表格。
 *
 * 为什么不直接上 Univer:Univer 是「可编辑工作簿」,启动成本高;聊天内
 * 附件预览只需要「看得清」。所以这里复用本包已有的 SheetJS(与
 * `FilePreview` 的 docExtractor 同一套解析能力),把工作表批量转 HTML,
 * 首屏只渲染前 MAX_INITIAL_SHEETS 张,其余按需展开 —— 与 `PdfJsPreview`
 * 的 `MAX_INITIAL_PAGES` + 「加载更多」保持同一交互语言。
 *
 * 安全:`sheet_to_html` 生成的是 SheetJS 自产的表格标签,内容已按单元格
 * 转义;这里只注入库的产物,不注入用户原始 HTML。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { decodeDataUrl } from "./office-preview";
import { loadXlsx } from "./office-preview-loader";
import styles from "./OfficePreview.module.css";

/** 首屏渲染的工作表上限;更多工作表通过按钮展开。 */
const MAX_INITIAL_SHEETS = 5;

type Phase = "loading" | "ready" | "error";

interface RenderedSheet {
  name: string;
  html: string;
}

export interface XlsxPreviewProps {
  filename: string;
  /** data URL 或裸 base64 的工作簿内容。 */
  content: string;
  /** 加载失败 / 解析失败时渲染的降级视图。 */
  fallback: ReactNode;
  className?: string;
}

export function XlsxPreview({ filename, content, fallback, className }: XlsxPreviewProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [sheets, setSheets] = useState<RenderedSheet[]>([]);
  const [visibleCount, setVisibleCount] = useState(MAX_INITIAL_SHEETS);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setSheets([]);
    setVisibleCount(MAX_INITIAL_SHEETS);
    void (async () => {
      try {
        const mod = await loadXlsx();
        const bytes = decodeDataUrl(content);
        if (cancelled) return;
        const workbook = mod.read(bytes, { type: "array", cellDates: true });
        const rendered: RenderedSheet[] = (workbook.SheetNames ?? []).map((name) => ({
          name,
          // header/footer 置空 → 只拿 <table> 片段,避免嵌套完整 HTML 文档。
          html: mod.utils.sheet_to_html(workbook.Sheets[name], { header: "", footer: "" }),
        }));
        if (cancelled) return;
        setSheets(rendered);
        setPhase("ready");
      } catch {
        if (cancelled) return;
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content]);

  const visibleSheets = useMemo(
    () => sheets.slice(0, visibleCount),
    [sheets, visibleCount],
  );

  if (phase === "error") return <>{fallback}</>;

  return (
    <div
      className={cx("file-preview", "file-preview--sheet", styles.root, className)}
      data-office-kind="xlsx"
    >
      <div className={cx("file-preview__head", styles.head)}>
        <span className={cx("file-preview__name", styles.name)}>{filename}</span>
        <span className={cx("file-preview__kind", styles.kind)}>XLSX</span>
        {phase === "ready" ? (
          <span className={styles.meta}>共 {sheets.length} 个工作表</span>
        ) : null}
      </div>
      <div className={cx("file-preview__sheet-scroll", styles.scroll)}>
        {phase === "loading" ? (
          <div className={styles.loading} role="status">
            工作簿加载中…
          </div>
        ) : null}
        {phase === "ready" && sheets.length === 0 ? (
          <div className={styles.loading} role="status">
            工作簿中没有工作表。
          </div>
        ) : null}
        <div data-testid="office-preview-body">
          {visibleSheets.map((sheet) => (
            <section key={sheet.name} className={styles.sheet}>
              <h4 className={styles.sheetName}>{sheet.name}</h4>
              {/* SheetJS 自产表格标签，不经过用户输入。原处有一条
                  `eslint-disable react/no-danger`，但本仓库从没装过
                  eslint-plugin-react，该指令只会让 ESLint 9 报
                  “Definition for rule … was not found”，故改为说明性注释。 */}
              <div
                className={styles.sheetBody}
                dangerouslySetInnerHTML={{ __html: sheet.html }}
              />
            </section>
          ))}
        </div>
        {phase === "ready" && visibleCount < sheets.length ? (
          <button
            type="button"
            className={styles.more}
            onClick={() => setVisibleCount((count) => count + MAX_INITIAL_SHEETS)}
          >
            显示更多工作表({sheets.length - visibleCount})
          </button>
        ) : null}
      </div>
    </div>
  );
}
