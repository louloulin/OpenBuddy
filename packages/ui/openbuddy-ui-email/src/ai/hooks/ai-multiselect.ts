/**
 * useAiMultiSelect — 多选状态 hook。
 *
 * 第 3 周改进(P2-3):用户可多选线程 → 一键 plan 全部。
 *
 * 设计:简化实现 — store-based(共享给列表与 AiInboxShell 的批量计划条)。
 *   - Cmd/Ctrl+click → toggle 单条
 *   - Shift+click → range select(从 anchor 到 click)
 *   - 普通 click → 清空多选
 *   - Esc → 清空多选
 */
import { useCallback, useMemo } from "react";

export interface UseMultiSelectArgs {
  selectedIds: string[];
  allIds: string[];
  onChange: (selected: string[]) => void;
}

export interface MultiSelectHandlers {
  /** 普通 click → 单选。 */
  handleSingleSelect(threadId: string): void;
  /** Ctrl/Meta + click → toggle。 */
  handleToggleSelect(threadId: string): void;
  /** Shift + click → range(从 anchor 到 click)。 */
  handleRangeSelect(threadId: string): void;
  /** 全选。 */
  handleSelectAll(): void;
  /** 清空。 */
  handleClearSelection(): void;
  isSelected(threadId: string): boolean;
  /** 计算的便捷数据。 */
  selectedCount: number;
}

export function useAiMultiSelect({ selectedIds, allIds, onChange }: UseMultiSelectArgs): MultiSelectHandlers {
  const handleClearSelection = useCallback(() => onChange([]), [onChange]);
  const handleSelectAll = useCallback(() => onChange(allIds), [allIds, onChange]);

  const handleSingleSelect = useCallback((threadId: string) => {
    onChange(selectedIds.includes(threadId) ? [] : [threadId]);
  }, [selectedIds, onChange]);

  const handleToggleSelect = useCallback((threadId: string) => {
    onChange(selectedIds.includes(threadId)
      ? selectedIds.filter((id) => id !== threadId)
      : [...selectedIds, threadId]);
  }, [selectedIds, onChange]);

  const handleRangeSelect = useCallback((threadId: string) => {
    if (allIds.length === 0) return onChange([threadId]);
    const anchor = selectedIds[selectedIds.length - 1] ?? allIds[0]!;
    const anchorIdx = allIds.indexOf(anchor);
    const targetIdx = allIds.indexOf(threadId);
    if (anchorIdx === -1 || targetIdx === -1) return onChange([threadId]);
    const [from, to] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    const range = allIds.slice(from, to + 1);
    // 合并到已有 selectedIds
    const merged = Array.from(new Set([...selectedIds, ...range]));
    onChange(merged);
  }, [selectedIds, allIds, onChange]);

  const isSelected = useCallback(
    (threadId: string) => selectedIds.includes(threadId),
    [selectedIds],
  );

  return useMemo(() => ({
    handleSingleSelect,
    handleToggleSelect,
    handleRangeSelect,
    handleSelectAll,
    handleClearSelection,
    isSelected,
    selectedCount: selectedIds.length,
  }), [handleSingleSelect, handleToggleSelect, handleRangeSelect, handleSelectAll, handleClearSelection, isSelected, selectedIds.length]);
}
