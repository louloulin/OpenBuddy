/**
 * AnsiText — render ANSI SGR-colored text as styled React spans.
 *
 * Tool/command output (bash, test runners, pi extension widgets) carries ANSI
 * color codes. Rendered raw inside a `<pre>`, those show as literal
 * `\x1b[31m…` garbage. This turns them into colored spans.
 *
 * Unlike pi-web's `AnsiText` (ansi_up + `dangerouslySetInnerHTML`), the text
 * flows through React as children, so tool output cannot inject markup — there
 * is no HTML string to sanitize. Segmenting is done by `parseAnsi`; see
 * `lib/ansi.ts` for the supported SGR set and the no-ESC fast path.
 */
import { Fragment } from "react";
import { ansiStyleToCss, parseAnsi } from "./lib/ansi";

export function AnsiText({ text }: { text: string }): JSX.Element {
  const segments = parseAnsi(text);
  // Fast path: nothing styled → render the raw string with no wrapper spans.
  if (segments.length === 1 && Object.keys(segments[0].style).length === 0) {
    return <>{segments[0].text}</>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        const css = ansiStyleToCss(seg.style);
        return Object.keys(css).length === 0 ? (
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          <span key={i} style={css}>
            {seg.text}
          </span>
        );
      })}
    </>
  );
}
