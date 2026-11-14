import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CodeBlockActions } from "./CodeBlockActions";
import { extractCodeFromChildren } from "./utils/collect-text";
import type { MarkdownConfig } from "./types";

type FileInfo = {
  /** Absent when the fence names a whole file (`ts:src/a.ts`, ```ts title="src/a.ts"```). */
  startLine?: number;
  endLine?: number;
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

  // `lang:path` without lines: the block is the whole file, so it can be applied.
  const match4 = meta.match(/^([a-zA-Z][a-zA-Z0-9+#-]*):([^\d\s][^\s]*)$/);
  if (match4 && /[./\\]/.test(match4[2])) {
    const filePath = match4[2];
    return { filePath, fileName: filePath.split(/[\\/]/).pop() || filePath, metaLanguage: match4[1] };
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

/** Blocks longer than this open folded. */
const COLLAPSE_LINES = 18;

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
    pathClickHandler.onPathClick(fileInfo.filePath, "file", fileInfo.startLine !== undefined ? {
      start: fileInfo.startLine,
      end: fileInfo.endLine,
    } : undefined);
  }, [clickable, fileInfo, pathClickHandler]);

  // "应用" only where the answer says which file the block is: a fragment with line numbers or
  // an anonymous snippet would overwrite a whole file with a piece of it (§4-A8).
  const applicable = !!onApplyCode && !!fileInfo && fileInfo.startLine === undefined;
  const handleApply = useCallback(() => {
    if (onApplyCode && fileInfo) onApplyCode(code, language, fileInfo.filePath);
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
  // Long blocks open folded to a screenful; the header and the footer toggle them.
  const lineCount = useMemo(() => (code ? code.replace(/\n$/, "").split("\n").length : 0), [code]);
  const foldable = !shouldRenderAsLatex && lineCount > COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  const folded = foldable && !expanded;

  const applyButton = applicable ? (
    <button
      type="button"
      className="md-code-action"
      onClick={handleApply}
      aria-label={`应用到 ${fileInfo!.filePath}`}
      title={`写入 ${fileInfo!.filePath}（先看改动，可还原）`}
    >
      <span className="md-code-action-label">应用</span>
    </button>
  ) : undefined;

  return (
    <div className="md-code-wrapper">
      <div className="md-code-container">
        {showHeader ? (
          <div className="md-code-header">
            <strong
              className={
                clickable ? "md-code-lang md-code-lang--clickable" : "md-code-lang"
              }
              title={
                clickable && fileInfo
                  ? fileInfo.startLine !== undefined ? `${fileInfo.startLine}:${fileInfo.endLine}:${fileInfo.filePath}` : fileInfo.filePath
                  : language || "code"
              }
              onClick={clickable ? handleClickTitle : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleClickTitle();
                      }
                    }
                  : undefined
              }
            >
              {clickable && fileInfo ? (
                <>
                  {fileInfo.fileName}
                  {fileInfo.startLine !== undefined && (
                    <span className="md-code-line-range">
                      L{fileInfo.startLine}-L{fileInfo.endLine}
                    </span>
                  )}
                </>
              ) : (
                language || "code"
              )}
            </strong>
            <CodeBlockActions
              code={code}
              language={language}
              actions={codeBlockActions}
              applyButton={applyButton}
              requestId={requestId}
              onAction={handleAction}
              copyIconOnly
            />
          </div>
        ) : null}

        {shouldRenderAsLatex ? (
          latexHtml == null && !latexError ? (
            <pre className={["md-code-pre", className].filter(Boolean).join(" ")} {...preProps}>
              <code className="language-latex">{code}</code>
            </pre>
          ) : latexError ? (
            <pre className={["md-code-pre", className].filter(Boolean).join(" ")} {...preProps}>
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
          <div className={"md-code-body" + (folded ? " md-code-body--folded" : "")}>
            <pre
              className={["md-code-pre", className].filter(Boolean).join(" ")}
              {...preProps}
            >
              {children}
            </pre>
          </div>
        )}
        {foldable && (
          <button
            type="button"
            className="md-code-fold"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "收起" : `展开全部 · ${lineCount} 行`}
          </button>
        )}
      </div>
    </div>
  );
});
