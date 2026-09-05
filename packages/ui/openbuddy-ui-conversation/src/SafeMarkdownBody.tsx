/**
 * SafeMarkdownBody — Phase R3.0 (pi-web-alignment).
 *
 * Markdown with an oversized-content guard. When a chat message exceeds
 * `MAX_MARKDOWN_CHARS` (default 100,000 chars), react-markdown + KaTeX +
 * syntax highlighting can freeze the browser main thread on multi-hundred-KB
 * payloads (pasted code, JSON dumps, log captures, etc.).
 *
 * The guard:
 *   1. Below the threshold → renders normally via the `Markdown` component.
 *   2. Above the threshold → shows a click-to-reveal button. The button
 *      swaps in a plain-text `<pre>` (still capped to a max-height + scroll)
 *      so the user can read the payload without locking the renderer.
 *
 * Pattern mirrors pi-web `components/MessageView.tsx:99-148` exactly.
 * `t` is optional — when absent the component falls back to hardcoded
 * English/Chinese strings so this package stays i18n-agnostic.
 */
import { useState, type ComponentProps, type ReactNode } from "react";
import { Markdown } from "@openbuddy/ui-markdown";

/** Mirrors pi-web's threshold. Tune upward if real users need it. */
export const MAX_MARKDOWN_CHARS = 100_000;

export interface SafeMarkdownBodyProps
  extends Omit<ComponentProps<typeof Markdown>, "children"> {
  children: string;
  /** Optional i18n hook. Falls back to literal strings. */
  t?: (key: string, params?: Record<string, string | number>) => string;
  /** Test override for the threshold. */
  threshold?: number;
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

export function SafeMarkdownBody({
  children,
  className,
  t,
  threshold = MAX_MARKDOWN_CHARS,
  ...rest
}: SafeMarkdownBodyProps): ReactNode {
  const [showRaw, setShowRaw] = useState(false);

  // Below threshold — render through the regular Markdown pipeline.
  if (children.length <= threshold) {
    return (
      <Markdown className={className} {...rest}>
        {children}
      </Markdown>
    );
  }

  // Above threshold — first click reveals the raw payload.
  if (!showRaw) {
    return (
      <button
        type="button"
        onClick={() => setShowRaw(true)}
        className={`safe-md-reveal${className ? ` ${className}` : ""}`}
        data-testid="safe-md-reveal"
        aria-label={t?.("i18n.largeMessageReveal", { size: formatBytes(children.length) }) ?? `Large message — ${ formatBytes(children.length)} — click to reveal raw text`}
        style={{
          display: "block",
          width: "100%",
          margin: "4px 0",
          padding: "7px 10px",
          border: "1px solid var(--wb-border-default, var(--border))",
          borderRadius: 6,
          background: "var(--wb-bg-panel, var(--bg-panel))",
          color: "var(--wb-text-muted, var(--text-muted))",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        ⚠{" "}
        {t?.("i18n.largeMessageReveal", { size: formatBytes(children.length) }) ??
          `Large message — ${formatBytes(children.length)} — click to reveal raw text`}
      </button>
    );
  }

  // Revealed — render plain text inside a scrollable <pre>. Cap height so
  // an enormous payload doesn't push the conversation off-screen.
  return (
    <div
      className={`safe-md-raw${className ? ` ${className}` : ""}`}
      data-testid="safe-md-raw"
      style={{ maxHeight: 420, overflow: "auto", fontSize: 12, lineHeight: 1.5 }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "var(--wb-font-mono, var(--font-mono))",
          color: "var(--wb-text-muted, var(--text-muted))",
        }}
      >
        {children}
      </pre>
    </div>
  );
}