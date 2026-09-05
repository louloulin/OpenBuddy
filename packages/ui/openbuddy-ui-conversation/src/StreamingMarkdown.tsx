import { memo } from "react";

/**
 * StreamingMarkdown -- ultra-lightweight renderer used while an assistant
 * message is actively streaming. The full `<Markdown>` pipeline (gfm, math,
 * katex, sanitize, lowlight) re-parses the entire accumulated text on every
 * delta. For a typical 100-token streaming turn the model can emit dozens of
 * chunks per second, so running react-markdown + lowlight + katex on every
 * chunk is the dominant source of UI jank.
 *
 * Instead we render the raw text with `<br>`-separated lines so the user
 * still sees new content appear instantly. Code blocks (triple backtick
 * fences) get a faint placeholder so the user knows a code block is forming
 * -- the real syntax highlighting is done by the full Markdown renderer
 * once the message is complete and the message flips to its final render.
 *
 * Trade-off: during streaming the user sees unformatted text (no link click
 * affordances, no inline code styling, no syntax highlighting). On the
 * streaming-complete transition the message body re-renders with the full
 * pipeline applied. This swap is much cheaper than running the pipeline
 * every delta, and the formatting jump is small relative to the perceived
 * responsiveness win.
 */

type Token = { kind: "text"; value: string } | { kind: "code"; lang: string; value: string };

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
        {renderTextLines(text)}
      </div>
    );
  }
  const tokens = tokenize(text);
  return (
    <div className="markdown-body md-font-size-fixed" data-md-theme={markdownTheme}>
      {tokens.map((tok, idx) => {
        if (tok.kind === "text") {
          return <span key={idx}>{renderTextLines(tok.value)}</span>;
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
