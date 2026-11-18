/** Quote helpers shared by 批注 and 改这段 (pii W1.9). */
export function quoteLines(selected: string): string {
  return selected.trim().split("\n").slice(0, 40).map((line) => `> ${line}`).join("\n");
}

/** The block a 批注 contributes to the next prompt. */
export function annotationBlock(path: string, selected: string): string {
  return `关于 \`${path}\` 中的这段：\n${quoteLines(selected)}`;
}

/** 选中文字 → 改这段 (composer) or 批注 (tray) — pii W1.9. */
export function askEdit(
  context: {
    sessionId?: string | null;
    relPath: (path: string) => string;
    draft: () => string;
    putInComposer: (text: string) => void;
    addAnnotation: (sessionId: string, path: string, text: string) => void;
  },
  path: string,
  selected: string,
  mode: "edit" | "comment",
): void {
  const rel = context.relPath(path);
  if (mode === "comment" && context.sessionId) {
    context.addAnnotation(context.sessionId, rel, annotationBlock(rel, selected));
    return;
  }
  const current = context.draft();
  context.putInComposer(`${current ? current + "\n\n" : ""}请修改 \`${rel}\` 中的这段内容：\n${quoteLines(selected)}\n\n修改要求：`);
}
