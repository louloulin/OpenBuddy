import { Fragment, memo } from "react";

/**
 * StreamingMarkdown -- ultra-lightweight renderer used while an assistant
 * message is actively streaming. The full `<Markdown>` pipeline (gfm, math,
 * katex, sanitize, lowlight) re-parses the entire accumulated text on every
 * delta. For a typical 100-token streaming turn the model can emit dozens
 * of chunks per second, so running react-markdown + lowlight + katex on every
 * chunk is the dominant source of UI jank.
 *
 * ## R57 — inline / link styling during streaming
 *
 * Previously, the streaming renderer produced raw `<br>`-separated text.
 * That left inline code, bold, italic, and bare URLs un-styled until the
 * final flip to the rich renderer, so the user watched a long stretch of
 * unformatted prose during multi-thousand-token replies. To close the
 * visible gap without re-running the heavy pipeline on every delta, we
 * run a single-pass tokenizer over each text segment and emit small
 * styled spans (`<code>`, `<strong>`, `<em>`, `<a>`). Tokenization is
 * linear-time, no AST, no sanitize, no syntax highlighting — and we
 * still defer the full gfm/lowlight/katex render to the complete-state
 * pipeline so the final fidelity is unchanged.
 *
 * Trade-off preserved: no inline code styling, no link click affordance,
 * no syntax highlighting during streaming → now we have inline code,
 * bold, italic, and link styling during streaming, with full Markdown
 * fidelity on completion. The streaming-complete swap is still cheaper
 * than running the pipeline every delta.
 */

type Token =
  | { kind: "text"; value: string }
  | { kind: "code"; lang: string; value: string };

// ─── Fenced-code block tokenization ────────────────────────────────

function tokenize(text: string): Token[] {
  if (!text) return [];
  const tokens: Token[] = [];
  // ```lang\n...\n``` (non-greedy, multiline).
  const fence = /```([A-Za-z0-9_+-]*)\n([\s\S]*?)(?:```|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    tokens.push({ kind: "code", lang: match[1] || "", value: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

// ─── Inline tokenizer (R57) ────────────────────────────────────────
//
// Order matters: bold before italic, code before bold (so `**foo**` is
// not eaten as code first). All four patterns are merged into a single
// regex with a `()` group alternation so we walk the text once. Each
// match yields a React element; everything between matches is plain
// text rendered with the same newline → <br> split as before.

type Inline =
  | { kind: "text"; value: string }
  | { kind: "code"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "em"; value: string }
  | { kind: "link"; url: string; value: string };

// Match: `code` | **bold** | *italic* | http(s)://url
// Bold requires two asterisks; italic requires a single asterisk
// bounded by non-word or string boundary so it doesn't match `1*2`.
const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*\n][^*]*?\*\*)|(\*[^*\s\n][^*\n]*?\*)|(https?:\/\/[^\s<>\)\]]+)/g;

function tokenizeInline(text: string): Inline[] {
  if (!text) return [];
  const out: Inline[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: text.slice(lastIndex, m.index) });
    }
    if (m[1] != null) {
      // Strip the surrounding backticks.
      out.push({ kind: "code", value: m[1].slice(1, -1) });
    } else if (m[2] != null) {
      out.push({ kind: "strong", value: m[2].slice(2, -2) });
    } else if (m[3] != null) {
      out.push({ kind: "em", value: m[3].slice(1, -1) });
    } else if (m[4] != null) {
      out.push({ kind: "link", url: m[4], value: m[4] });
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return out;
}

// ─── Render helpers ────────────────────────────────────────────────

function renderTextLines(text: string): React.ReactNode {
  // Split by newlines; React handles escaping the segments automatically.
  const segments = text.split("\n");
  const out: React.ReactNode[] = [];
  for (let i = 0; i < segments.length; i++) {
    out.push(segments[i]);
    if (i < segments.length - 1) out.push(<br key={`br-${i}`} />);
  }
  return out;
}

function renderInlineText(text: string, baseKey: string): React.ReactNode {
  const tokens = tokenizeInline(text);
  if (tokens.length === 0) return null;
  // Fast path: pure-text → split newlines directly, no per-token wrapper.
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return renderTextLines(tokens[0].value);
  }
  return tokens.map((tok, idx) => {
    const key = `${baseKey}-${idx}`;
    switch (tok.kind) {
      case "text":
        return <Fragment key={key}>{renderTextLines(tok.value)}</Fragment>;
      case "code":
        return (
          <code key={key} className="streaming-inline-code">
            {tok.value}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="streaming-inline-strong">
            {tok.value}
          </strong>
        );
      case "em":
        return (
          <em key={key} className="streaming-inline-em">
            {tok.value}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            className="streaming-inline-link"
            href={tok.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {tok.value}
          </a>
        );
    }
  });
}

function StreamingMarkdownInner({
  text,
  markdownTheme = "loose",
}: {
  text: string;
  markdownTheme?: "loose" | "reasoning" | "legacy";
}) {
  // Fast path: plain prose streaming in -- skip tokenization entirely.
  if (text.indexOf("```") === -1) {
    return (
      <div className="markdown-body md-font-size-fixed" data-md-theme={markdownTheme}>
        {renderInlineText(text, "s")}
      </div>
    );
  }
  const tokens = tokenize(text);
  return (
    <div className="markdown-body md-font-size-fixed" data-md-theme={markdownTheme}>
      {tokens.map((tok, idx) => {
        if (tok.kind === "text") {
          return <span key={idx}>{renderInlineText(tok.value, `t${idx}`)}</span>;
        }
        // Placeholder for an in-progress fenced code block -- the real
        // syntax-highlighted render arrives when the message completes.
        return (
          <pre key={idx} className="streaming-code-stub" data-lang={tok.lang}>
            {tok.value || "\u2026"}
          </pre>
        );
      })}
    </div>
  );
}

/** Memoized: only re-renders when the text content actually changes. */
export const StreamingMarkdown = memo(
  StreamingMarkdownInner,
  (prev, next) => prev.text === next.text && prev.markdownTheme === next.markdownTheme,
);

// Exposed for tests.
export const __test__ = { tokenizeInline, INLINE_RE };
