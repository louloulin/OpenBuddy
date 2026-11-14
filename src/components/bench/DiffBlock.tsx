import { useMemo } from "react";
import { computeUnifiedDiff, summarizeDiff } from "@/lib/unified-diff";

/** Unified diff of two texts, in the transcript's diff style. */
export function DiffBlock({ before, after, empty = "内容没有变化" }: { before: string; after: string; empty?: string }) {
  const lines = useMemo(() => computeUnifiedDiff(before, after, 3), [before, after]);
  const summary = useMemo(() => summarizeDiff(lines), [lines]);
  if (!summary.added && !summary.removed) return <div className="bench-diff__empty">{empty}</div>;
  return (
    <div className="diff bench-diff">
      <div className="diff__stats">
        <span className="diff__stats-add">+{summary.added}</span>
        <span className="diff__stats-del">-{summary.removed}</span>
      </div>
      <pre className="diff__body">
        {lines.map((l, i) => (
          <div key={i} className={`diff__line diff__line--${l.kind}`}>
            <span className="diff__line-num">{l.kind === "del" ? l.oldLine ?? "" : l.newLine ?? ""}</span>
            <span className="diff__line-prefix">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}</span>
            <span className="diff__line-text">{l.text}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
