import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CodeBlockActions } from "./CodeBlockActions";
import { extractCodeFromChildren } from "./utils/collect-text";
import type { MarkdownConfig } from "./types";

/**
 * plan1030 批 5c — 长代码限高 + wrap 切换（对标 lumos CodeViewer）。
 * 超过 420px 的代码块默认折叠 + 底部「展开全部」；头部提供 wrap 切换。
 * 420px 与 lumos CodeViewer 的 max-h-[420px] 同值。
 */
const CODE_COLLAPSE_HEIGHT = 420;

type FileInfo = {
  startLine: number;
  endLine: number;
  filePath: string;
  fileName: string;
  metaLanguage?: string;
};

function parseMeta(meta: string | undefined | null): FileInfo | null {
  if (!meta || typeof meta !== "string") return null;

  const match3 = meta.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+):(\d+):(.+)$/);
  if (match3) {
    const filePath = match3[4];
    return {
      startLine: Math.max(parseInt(match3[2], 10), 1),
      endLine: Math.max(parseInt(match3[3], 10), 1),
      filePath,
      fileName: filePath.split(/[\\/]/).pop() || filePath,
      metaLanguage: match3[1],
    };
  }

  const match1 = meta.match(/^(\d+):(\d+):(.+)$/);
  if (match1) {
    const filePath = match1[3];
    return {
      startLine: Math.max(parseInt(match1[1], 10), 1),
      endLine: Math.max(parseInt(match1[2], 10), 1),
      filePath,
      fileName: filePath.split(/[\\/]/).pop() || filePath,
    };
  }

  const match2 = meta.match(/^([a-zA-Z][a-zA-Z0-9]*):(\d+)-(\d+):(.+)$/);
  if (match2) {
    const filePath = match2[4];
    return {
      startLine: Math.max(parseInt(match2[2], 10), 1),
      endLine: Math.max(parseInt(match2[3], 10), 1),
      filePath,
      fileName: filePath.split(/[\\/]/).pop() || filePath,
      metaLanguage: match2[1],
    };
  }

  return null;
}

const FULL_LATEX_DOC = [
  /\\documentclass\b/,
  /\\begin\s*\{\s*document\s*\}/,
  /\\end\s*\{\s*document\s*\}/,
  /\\usepackage\b/,
  /\\maketitle\b/,
  /\\section\b/,
  /\\subsection\b/,
  /\\chapter\b/,
  /\\part\b/,
  /\\appendix\b/,
  /\\tableofcontents\b/,
  /\\bibliography\b/,
];

function isFullLatexDocument(latex: string) {
  return FULL_LATEX_DOC.some((p) => p.test(latex));
}

type Props = HTMLAttributes<HTMLPreElement> & {
  children?: ReactNode;
  language?: string;
  code?: string;
  meta?: string;
  isLatex?: boolean;
  pathClickHandler?: MarkdownConfig["pathClickHandler"];
  codeBlockActions?: MarkdownConfig["codeBlockActions"];
  onApplyCode?: MarkdownConfig["onApplyCode"];
  requestId?: string;
  onCodeBlockAction?: MarkdownConfig["onCodeBlockAction"];
};

export const MarkdownPre = memo(function MarkdownPre({
  children,
  className,
  language: propLanguage,
  code: propCode,
  meta,
  isLatex = false,
  pathClickHandler,
  codeBlockActions,
  onApplyCode,
  requestId,
  onCodeBlockAction,
  ...preProps
}: Props) {
  const { language, code } = useMemo(() => {
    if (propLanguage && propCode != null) {
      return { language: propLanguage, code: propCode };
    }
    const extracted = extractCodeFromChildren(children);
    return {
      language: propLanguage || extracted.language,
      code: propCode ?? extracted.code,
    };
  }, [children, propLanguage, propCode]);

  const fileInfo = useMemo(() => parseMeta(meta), [meta]);
  const clickable = !!fileInfo && !!pathClickHandler?.onPathClick;

  const handleClickTitle = useCallback(() => {
    if (!clickable || !fileInfo || !pathClickHandler?.onPathClick) return;
    pathClickHandler.onPathClick(fileInfo.filePath, "file", {
      start: fileInfo.startLine,
      end: fileInfo.endLine,
    });
  }, [clickable, fileInfo, pathClickHandler]);

  const handleApply = useCallback(() => {
    if (onApplyCode) onApplyCode(code, language, fileInfo?.filePath);
    if (onCodeBlockAction && requestId && language) {
      onCodeBlockAction("apply", code, language, requestId);
    }
  }, [onApplyCode, onCodeBlockAction, requestId, code, language, fileInfo]);

  const handleAction = useCallback(
    (action: string, actionCode: string, actionLanguage: string) => {
      if (onCodeBlockAction && requestId) {
        onCodeBlockAction(action, actionCode, actionLanguage, requestId);
      }
    },
    [onCodeBlockAction, requestId],
  );

  const shouldRenderAsLatex = useMemo(() => {
    if (!isLatex || !code) return false;
    return !isFullLatexDocument(code);
  }, [isLatex, code]);

  // plan1030 批 5c — 完成态长代码限高：挂载/内容变化后量一次自然高度，
  // 超过 CODE_COLLAPSE_HEIGHT 则折叠（overflow:hidden 下 scrollHeight
  // 仍包含被裁剪的内容，无需先展开再量）。
  const preRef = useRef<HTMLPreElement | null>(null);
  const [overLimit, setOverLimit] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  useLayoutEffect(() => {
    const el = preRef.current;
    if (!el) {
      setOverLimit(false);
      return;
    }
    setOverLimit(el.scrollHeight > CODE_COLLAPSE_HEIGHT);
  }, [code, children]);
  const lineCount = useMemo(() => (code ? code.split("\n").length : 0), [code]);

  const preCls = [
    "md-code-pre",
    overLimit && !expanded ? "md-code-pre--collapsed" : "",
    wrap ? "md-code-pre--wrap" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const [latexHtml, setLatexHtml] = useState<string | null>(null);
  const [latexError, setLatexError] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldRenderAsLatex || !code) {
      setLatexHtml(null);
      setLatexError(null);
      return;
    }
    let cancelled = false;
    import("katex")
      .then((mod) => {
        if (cancelled) return;
        try {
          const html = mod.default.renderToString(code, {
            displayMode: true,
            throwOnError: false,
            errorColor: "var(--wb-status-error, #e74856)",
            strict: false,
            trust: false,
          });
          setLatexHtml(html);
          setLatexError(null);
        } catch (err) {
          setLatexHtml(null);
          setLatexError(err instanceof Error ? err.message : String(err));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLatexHtml(null);
          setLatexError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldRenderAsLatex, code]);

  const showHeader = !!(language || codeBlockActions?.length || onApplyCode || code);

  const applyButton = onApplyCode ? (
    <button
      type="button"
      className="md-code-action"
      onClick={handleApply}
      aria-label="应用到对话"
      title="应用"
    >
      <span className="md-code-action-label">应用</span>
    </button>
  ) : undefined;

  return (
    <div className="md-code-wrapper">
      <div className="md-code-container">
        {showHeader ? (
          <div className="md-code-header">
            {/* 可点击时是真 button；不可点击时保持 <strong>。两者都靠 .md-code-lang
                这个 class 取样式，换元素不影响外观。 */}
            {clickable ? (
              <button
                type="button"
                className="md-code-lang md-code-lang--clickable"
                title={
                  fileInfo
                    ? `${fileInfo.startLine}:${fileInfo.endLine}:${fileInfo.filePath}`
                    : language || "code"
                }
                onClick={handleClickTitle}
              >
                {fileInfo ? (
                  <>
                    {fileInfo.fileName}
                    <span className="md-code-line-range">
                      L{fileInfo.startLine}-L{fileInfo.endLine}
                    </span>
                  </>
                ) : (
                  language || "code"
                )}
              </button>
            ) : (
              <strong className="md-code-lang" title={language || "code"}>
                {language || "code"}
              </strong>
            )}
            <CodeBlockActions
              code={code}
              language={language}
              actions={codeBlockActions}
              applyButton={applyButton}
              requestId={requestId}
              onAction={handleAction}
              copyIconOnly
            />
            {/* plan1030 批 5c — wrap 切换（默认不换行，横向滚动）。 */}
            <button
              type="button"
              className="md-code-action"
              aria-pressed={wrap}
              aria-label={wrap ? "关闭自动换行" : "自动换行"}
              title={wrap ? "关闭自动换行" : "自动换行"}
              onClick={() => setWrap((v) => !v)}
            >
              <span className="md-code-action-label">{wrap ? "不换行" : "换行"}</span>
            </button>
          </div>
        ) : null}

        {shouldRenderAsLatex ? (
          latexHtml == null && !latexError ? (
            <pre ref={preRef} className={preCls} {...preProps}>
              <code className="language-latex">{code}</code>
            </pre>
          ) : latexError ? (
            <pre ref={preRef} className={preCls} {...preProps}>
              <code className="language-latex">{code}</code>
              <div className="md-latex-error">LaTeX 渲染失败: {latexError}</div>
            </pre>
          ) : (
            <div
              className={["md-code-pre", "md-latex-display", className]
                .filter(Boolean)
                .join(" ")}
              dangerouslySetInnerHTML={{ __html: latexHtml || "" }}
            />
          )
        ) : (
          <pre ref={preRef} className={preCls} {...preProps}>
            {children}
          </pre>
        )}

        {/* plan1030 批 5c — 折叠时底部展开栏（lumos "Show more" 模式）。 */}
        {overLimit && !expanded ? (
          <button
            type="button"
            className="md-code-expand"
            onClick={() => setExpanded(true)}
          >
            展开全部（{lineCount} 行）
          </button>
        ) : null}
      </div>
    </div>
  );
});
