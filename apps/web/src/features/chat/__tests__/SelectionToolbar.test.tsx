import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SelectionToolbar } from "../chat-view/SelectionToolbar";

const renderToolbar = (overrides: Partial<Parameters<typeof SelectionToolbar>[0]> = {}) => {
  const props = {
    selection: { text: "selected", top: 100, left: 200 },
    onAsk: vi.fn(),
    onQuote: vi.fn(),
    onCopy: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<SelectionToolbar {...props} />);
  return props;
};

describe("SelectionToolbar (G1-22)", () => {
  it("offers ask / quote / copy and keeps the selection on mousedown", () => {
    const props = renderToolbar();
    const toolbar = screen.getByRole("toolbar", { name: "选中文字操作" });
    expect(fireEvent.mouseDown(toolbar)).toBe(false); // preventDefault keeps the DOM selection
    fireEvent.click(screen.getByRole("button", { name: "问这段" }));
    fireEvent.click(screen.getByRole("button", { name: "引用到输入框" }));
    fireEvent.click(screen.getByRole("button", { name: "复制选中文字" }));
    expect(props.onAsk).toHaveBeenCalledOnce();
    expect(props.onQuote).toHaveBeenCalledOnce();
    expect(props.onCopy).toHaveBeenCalledOnce();
  });

  it("closes on Escape from inside the toolbar", () => {
    const props = renderToolbar();
    fireEvent.keyDown(screen.getByRole("button", { name: "问这段" }), { key: "Escape" });
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });
});
