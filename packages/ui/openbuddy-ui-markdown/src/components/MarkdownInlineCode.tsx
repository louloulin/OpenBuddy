import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import type { MarkdownConfig, PathType } from "./types";
import { detectPath, truncatePathDisplay } from "./utils/path-detector";

type Props = {
  children?: ReactNode;
  className?: string;
  pathClickHandler?: MarkdownConfig["pathClickHandler"];
  resolveCode?: MarkdownConfig["resolveCode"];
  openCodeLink?: MarkdownConfig["openCodeLink"];
  requestId?: string;
  renderPathIcon?: MarkdownConfig["renderInlineCodePathIcon"];
};

const resolvedTypeCache = new Map<string, PathType>();
const resolvingPromiseCache = new Map<string, Promise<PathType>>();

function getCacheKey(requestId: string, code: string) {
  return `${requestId}:${code}`;
}

function childrenToCode(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToCode).join("");
  return String(children ?? "");
}

export const MarkdownInlineCode = memo(function MarkdownInlineCode({
  children,
  className = "",
  pathClickHandler,
  resolveCode,
  openCodeLink,
  requestId,
  renderPathIcon,
}: Props) {
  const code = useMemo(() => childrenToCode(children), [children]);

  const pathDetection = useMemo(() => {
    if (!pathClickHandler?.onPathClick && !resolveCode) return { isPath: false as const };
    return detectPath(code);
  }, [code, pathClickHandler, resolveCode]);

  const cacheKey = requestId ? getCacheKey(requestId, code) : "";
  const [resolvedType, setResolvedType] = useState<PathType | undefined>(() => {
    if (cacheKey) return resolvedTypeCache.get(cacheKey);
    return undefined;
  });

  useEffect(() => {
    if (!resolveCode || !requestId || !pathDetection.isPath) return;
    const key = getCacheKey(requestId, code);
    const cached = resolvedTypeCache.get(key);
    if (cached !== undefined) {
      setResolvedType(cached);
      return;
    }
    const existing = resolvingPromiseCache.get(key);
    if (existing) {
      existing.then(setResolvedType);
      return;
    }
    const promise = resolveCode(requestId, code)
      .then((result) => {
        resolvedTypeCache.set(key, result);
        resolvingPromiseCache.delete(key);
        setResolvedType(result);
        return result;
      })
      .catch(() => {
        const fallback: PathType = "unknown";
        resolvedTypeCache.set(key, fallback);
        resolvingPromiseCache.delete(key);
        setResolvedType(fallback);
        return fallback;
      });
    resolvingPromiseCache.set(key, promise);
  }, [resolveCode, requestId, code, pathDetection.isPath]);

  // Heuristic highlight when no async resolver is provided but path handler exists
  const heuristicType = pathDetection.isPath ? pathDetection.type : undefined;

  const shouldHighlight = useMemo(() => {
    if (resolveCode && requestId) {
      return (
        resolvedType === "file" ||
        resolvedType === "directory" ||
        resolvedType === "symbol"
      );
    }
    if (pathClickHandler?.onPathClick && heuristicType && heuristicType !== "unknown") {
      return true;
    }
    return false;
  }, [resolveCode, requestId, resolvedType, pathClickHandler, heuristicType]);

  const finalType: PathType | undefined = useMemo(() => {
    if (resolveCode && requestId && resolvedType && resolvedType !== "unknown") {
      return resolvedType;
    }
    if (heuristicType && heuristicType !== "unknown") return heuristicType;
    return undefined;
  }, [resolveCode, requestId, resolvedType, heuristicType]);

  const handleClick = useCallback(() => {
    if (!shouldHighlight || !finalType) return;
    if (openCodeLink && requestId) {
      try {
        openCodeLink(requestId, code, finalType);
      } catch {
        /* ignore */
      }
      return;
    }
    if (pathClickHandler?.onPathClick) {
      const purePath = pathDetection.purePath || code;
      pathClickHandler.onPathClick(purePath, finalType, pathDetection.range);
    }
  }, [
    shouldHighlight,
    finalType,
    openCodeLink,
    requestId,
    code,
    pathClickHandler,
    pathDetection,
  ]);

  // R93 fix:下面 3 个 hook 原先声明在 `if (shouldHighlight && finalType)`
  // 的 early return 之后。同一实例的 `code` 随 Markdown 重渲染变化时
  // (流式输出 / 就地重新渲染),命中/不命中路径分支会翻转,hook 数量随之
  // 变化 → React #300/#310。统一上移到第一个 early return 之前。
  // R8.55 — Inline code copy button. Track the "copied" state so we can
  // swap the Copy icon for a Check icon for 2s, mirroring the
  // CodeBlockActions pattern (PI-Desktop parity). The button is hidden
  // by default (opacity: 0) and revealed on hover / focus-within so
  // it never competes with the inline text. Non-visual handler is
  // always wired (keyboard accessible via Enter on the code element).
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const text = code;
      if (!text) return;
      const done = () => setCopied(true);
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            done();
          } catch {
            /* ignore */
          }
        });
        return;
      }
      // Fallback for restricted contexts
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch {
        /* ignore */
      }
    },
    [code],
  );

  if (shouldHighlight && finalType) {
    const titleText =
      finalType === "symbol"
        ? "跳转到符号"
        : finalType === "file"
          ? "打开文件"
          : "打开目录";
    const iconNode = renderPathIcon?.({
      code,
      purePath: pathDetection.purePath || code,
      type: finalType,
    });
    return (
      <code
        className={[className, "md-inline-code", "md-clickable-path", `md-path-type-${finalType}`]
          .filter(Boolean)
          .join(" ")}
        onClick={handleClick}
        title={titleText}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {iconNode ? <span className="md-clickable-path-icon">{iconNode}</span> : null}
        {truncatePathDisplay(code)}
      </code>
    );
  }

  return (
    <code className={["md-inline-code", className].filter(Boolean).join(" ")}>
      <span className="md-inline-code__text">{children}</span>
      <button
        type="button"
        className={
          "md-inline-code__copy" + (copied ? " md-inline-code__copy--ok" : "")
        }
        aria-label={copied ? "已复制" : "复制"}
        title={copied ? "已复制" : "复制代码"}
        onClick={handleCopy}
        tabIndex={-1}
      >
        {copied ? (
          <Check size={12} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Copy size={12} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </code>
  );
});
