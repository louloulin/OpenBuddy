/**
 * StreamingCaret.test.tsx
 *
 * Phase B.1 测试:验证 caret 在 streaming 时显示,完成时消失。
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { StreamingCaret } from "../StreamingCaret";

describe("StreamingCaret", () => {
  it("renders caret when active", () => {
    const { container } = render(<StreamingCaret active={true} />);
    expect(container.querySelector(".streaming-caret")).toBeTruthy();
    expect(container.querySelector('[data-testid="streaming-caret"]')).toBeTruthy();
  });

  it("renders nothing when inactive", () => {
    const { container } = render(<StreamingCaret active={false} />);
    expect(container.querySelector(".streaming-caret")).toBeNull();
  });

  it("applies reasoning theme class", () => {
    const { container } = render(
      <StreamingCaret active={true} theme="reasoning" />,
    );
    const caret = container.querySelector(".streaming-caret");
    expect(caret?.className).toContain("streaming-caret--reasoning");
  });

  it("uses loose theme by default", () => {
    const { container } = render(<StreamingCaret active={true} />);
    const caret = container.querySelector(".streaming-caret");
    expect(caret?.className).toContain("streaming-caret--loose");
  });
});
