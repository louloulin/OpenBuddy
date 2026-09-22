/**
 * Unified diff 算法 — 基于 Myers diff 的行级 diff。
 *
 * 替代 ToolCallCard 中的朴素逐行对比。对齐 WorkBuddy 的
 * `multi-edit-diff-viewer.tsx` 和 `diff-viewer.tsx`。
 *
 * 纯函数,无副作用,便于单测。
 */

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  /** 旧文件行号 (1-based), 删除/上下文行有值 */
  oldLine?: number;
  /** 新文件行号 (1-based), 添加/上下文行有值 */
  newLine?: number;
  /** 行内容 */
  text: string;
}

export interface UnifiedDiffResult {
  lines: DiffLine[];
  /** 统计 */
  added: number;
  removed: number;
  context: number;
  /** 文件路径(若有) */
  path?: string;
}

/**
 * 计算两组文本行的 diff(基于 Myers diff 算法的简化版)。
 * 返回带 +/-/context 标记的行列表。
 *
 * @param oldText 旧文本
 * @param newText 新文本
 * @param contextLines 上下文行数(默认 3)
 */
export function computeUnifiedDiff(
  oldText: string,
  newText: string,
  contextLines = 3,
): DiffLine[] {
  // 空文本特殊处理
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  const n = oldLines.length;
  const m = newLines.length;

  // 完全空 → 无 diff
  if (n === 0 && m === 0) return [];

  // Build LCS dp table
  const dp: number[][] = [];
  for (let ii = 0; ii <= n; ii++) dp.push(new Array(m + 1).fill(0));
  for (let ii = 1; ii <= n; ii++) {
    for (let jj = 1; jj <= m; jj++) {
      if (oldLines[ii - 1] === newLines[jj - 1]) {
        dp[ii][jj] = dp[ii - 1][jj - 1] + 1;
      } else {
        dp[ii][jj] = Math.max(dp[ii - 1][jj], dp[ii][jj - 1]);
      }
    }
  }

  // Backtrack to build diff lines
  let i = n, j = m;
  const temp: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      temp.push({ kind: "context", oldLine: i, newLine: j, text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      temp.push({ kind: "add", newLine: j, text: newLines[j - 1] });
      j--;
    } else {
      temp.push({ kind: "del", oldLine: i, text: oldLines[i - 1] });
      i--;
    }
  }
  temp.reverse();

  // 无变化 → 返回全部 context
  if (temp.every((l) => l.kind === "context")) return temp;

  // 只保留变化行 ± contextLines 范围内的行
  const kept = new Array(temp.length).fill(false);
  for (let k = 0; k < temp.length; k++) {
    if (temp[k].kind !== "context") {
      for (let c = Math.max(0, k - contextLines); c <= Math.min(temp.length - 1, k + contextLines); c++) {
        kept[c] = true;
      }
    }
  }

  const result: DiffLine[] = [];
  for (let k = 0; k < temp.length; k++) {
    if (kept[k]) result.push(temp[k]);
  }
  return result;
}

/** 统计 diff 结果 */
export function summarizeDiff(lines: DiffLine[]): { added: number; removed: number; context: number } {
  let added = 0, removed = 0, context = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
    else context++;
  }
  return { added, removed, context };
}

/** 将 hunks 格式(DiffContent.diff.hunks)转为 unified diff lines */
export function hunksToUnifiedLines(
  hunks: Array<{
    old: { start: number; lines: string[] };
    new: { start: number; lines: string[] };
  }>,
): DiffLine[] {
  const result: DiffLine[] = [];
  for (const h of hunks) {
    // Old lines (deletions)
    for (let i = 0; i < h.old.lines.length; i++) {
      result.push({ kind: "del", oldLine: h.old.start + i, text: h.old.lines[i] });
    }
    // New lines (additions)
    for (let i = 0; i < h.new.lines.length; i++) {
      result.push({ kind: "add", newLine: h.new.start + i, text: h.new.lines[i] });
    }
  }
  return result;
}
