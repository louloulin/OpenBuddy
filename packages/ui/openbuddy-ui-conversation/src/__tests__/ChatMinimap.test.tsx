import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatMinimap, minimapColor } from "../ChatMinimap";

describe("ChatMinimap — long-conversation navigation map (phase 5)", () => {
  const segments = [
    { id: "u1", kind: "user" as const, label: "问题" },
    { id: "a1", kind: "assistant" as const, label: "回答" },
    { id: "t1", kind: "tool" as const, label: "工具调用" },
    { id: "c1", kind: "compaction" as const, label: "压缩" },
  ];

  it("renders one block per segment", () => {
    render(<ChatMinimap segments={segments} />);
    expect(screen.getByTestId("chat-minimap")).toBeInTheDocument();
    for (const s of segments) {
      expect(screen.getByTestId(`chat-minimap-block-${s.id}`)).toBeInTheDocument();
    }
  });

  it("renders nothing when there are no segments", () => {
    const { container } = render(<ChatMinimap segments={[]} />);
    expect(container.querySelector(".chat-minimap")).toBeNull();
  });

  it("marks the active segment with aria-current", () => {
    render(<ChatMinimap segments={segments} activeId="a1" />);
    const active = screen.getByTestId("chat-minimap-block-a1");
    expect(active.getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("chat-minimap-block-u1").getAttribute("aria-current")).toBeNull();
  });

  it("calls onJump with the segment id on click", () => {
    const onJump = vi.fn();
    render(<ChatMinimap segments={segments} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("chat-minimap-block-t1"));
    expect(onJump).toHaveBeenCalledWith("t1");
  });

  it("maps each kind to a distinct --wb-* color token", () => {
    const kinds = ["user", "assistant", "tool", "system", "compaction", "branch"] as const;
    const colors = kinds.map((k) => minimapColor(k));
    expect(new Set(colors).size).toBe(kinds.length);
    expect(colors[0]).toContain("var(--wb-");
  });
});
