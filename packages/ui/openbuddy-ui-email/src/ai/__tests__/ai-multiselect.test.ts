import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiMultiSelect } from "../hooks/ai-multiselect";

describe("useAiMultiSelect", () => {
  it("starts with 0 selected", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: [], allIds: ["a", "b", "c"], onChange }));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("handleSingleSelect sets one id", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: [], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleSingleSelect("b"));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("handleSingleSelect on already-selected clears", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["b"], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleSingleSelect("b"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("handleToggleSelect adds when not selected", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["a"], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleToggleSelect("b"));
    expect(onChange).toHaveBeenCalledWith(["a", "b"]);
  });

  it("handleToggleSelect removes when selected", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["a", "b"], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleToggleSelect("a"));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("handleRangeSelect picks all in range", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["a"], allIds: ["a", "b", "c", "d", "e"], onChange }));
    act(() => result.current.handleRangeSelect("d"));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["a", "b", "c", "d"]));
  });

  it("handleRangeSelect backward range", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["d"], allIds: ["a", "b", "c", "d", "e"], onChange }));
    act(() => result.current.handleRangeSelect("b"));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["b", "c", "d"]));
  });

  it("handleRangeSelect with empty allIds just selects one", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: [], allIds: [], onChange }));
    act(() => result.current.handleRangeSelect("x"));
    expect(onChange).toHaveBeenCalledWith(["x"]);
  });

  it("handleSelectAll selects all ids", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: [], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleSelectAll());
    expect(onChange).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("handleClearSelection empties", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useAiMultiSelect({ selectedIds: ["a", "b"], allIds: ["a", "b", "c"], onChange }));
    act(() => result.current.handleClearSelection());
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
