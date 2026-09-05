/**
 * host-modules/pagination.ts — 纯函数分页工具。
 *
 * Stage F-1: 从 agent-host.ts:441-453 抽出。`paginateHistoryEntries` 是
 * IPC 文件 (`ipc/index.ts`) 唯一从外部消费的符号,保留 re-export 在
 * agent-host.ts,实现迁到这里。
 */
const DEFAULT_HISTORY_MAX_MESSAGES = 50;

export function paginateHistoryEntries<T>(
  entries: readonly T[],
  beforeSeq?: number,
  maxMessages?: number,
): { entries: T[]; hasMore: boolean } {
  const effectiveLimit =
    Number.isSafeInteger(maxMessages) && (maxMessages as number) > 0
      ? (maxMessages as number)
      : DEFAULT_HISTORY_MAX_MESSAGES;
  const window =
    beforeSeq === undefined
      ? [...entries]
      : entries.filter((entry) => {
          const sequence =
            (entry as { seq?: unknown; sequence?: unknown }).seq ??
            (entry as { seq?: unknown; sequence?: unknown }).sequence;
          return (
            typeof sequence === "number" &&
            Number.isSafeInteger(sequence) &&
            sequence < beforeSeq
          );
        });
  if (window.length <= effectiveLimit) return { entries: window, hasMore: false };
  return { entries: window.slice(-effectiveLimit), hasMore: true };
}