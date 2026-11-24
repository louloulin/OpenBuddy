import { Children, cloneElement, isValidElement, memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useMarkdownHost } from "./host";

/** Serialize a rendered <table> back into a GFM Markdown table. */
export function tableToMarkdown(table: HTMLTableElement | null): string {
  if (!table) return "";
  const rows = [...table.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("th,td")].map((cell) =>
      (cell.textContent ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim(),
    ),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const [head, ...body] = rows.map(pad);
  const lines = [
    `| ${head.join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  return lines.join("\n");
}

/**
 * Table block actions (WorkBuddy parity, 20261124 §0.4-M): a small toolbar above
 * every rendered table with 添加到对话 / 放大 / 下载.
 *
 * - 添加到对话 asks the app to put the table's Markdown back into the composer.
 * - 放大 opens the table in a full-screen overlay (no extra dependency).
 * - 下载 writes the table as Markdown to a path the user picks.
 */
export const MarkdownTable = memo(function MarkdownTable({
  children,
  onAddToChat,
}: {
  children: ReactNode;
  onAddToChat?: (markdown: string) => void;
}) {
  const host = useMarkdownHost();
  const tableRef = useRef<HTMLTableElement>(null);
  const [expanded, setExpanded] = useState(false);

  // The renderer hands us the <table> element; we only attach a ref to read it back.
  const child = Children.only(children);
  const table = isValidElement(child)
    ? cloneElement(child as React.ReactElement<{ ref?: React.Ref<HTMLTableElement> }>, { ref: tableRef })
    : child;

  const markdown = useMemo(() => tableToMarkdown(tableRef.current), [expanded]);

  const download = useCallback(async () => {
    try {
      const target = await host.saveDialog({ title: "下载表格", defaultPath: "table.md" });
      if (!target) return;
      await host.exportTextFile(target, tableToMarkdown(tableRef.current));
    } catch {
      /* the host decides how to report; the button simply does nothing */
    }
  }, [host]);

  return (
    <>
      <div className="md-table-actions">
        {onAddToChat && (
          <button type="button" className="md-table-action" onClick={() => onAddToChat(tableToMarkdown(tableRef.current))} aria-label="添加到对话">添加到对话</button>
        )}
        <button type="button" className="md-table-action" onClick={() => setExpanded(true)} aria-label="放大表格">放大</button>
        <button type="button" className="md-table-action" onClick={() => void download()} aria-label="下载表格">下载</button>
      </div>
      <div className="md-table-wrapper">{table}</div>
      {expanded && (
        <div className="md-table-expanded" role="dialog" aria-modal="true" aria-label="放大的表格" onClick={() => setExpanded(false)}>
          <div className="md-table-expanded__panel" onClick={(event) => event.stopPropagation()}>
            <div className="md-table-expanded__head">
              <span>表格</span>
              <button type="button" className="md-table-action" onClick={() => setExpanded(false)} aria-label="关闭">关闭</button>
            </div>
            <pre className="md-table-expanded__body">{markdown || tableToMarkdown(tableRef.current)}</pre>
          </div>
        </div>
      )}
    </>
  );
});
