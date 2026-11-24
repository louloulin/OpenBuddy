import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusChips } from "../StatusChips";
import { statusPrefix, useStatusStore } from "@/shared/state/status-store";

beforeEach(() => {
  useStatusStore.setState({ scene: null, designStyle: "default", imageMode: null });
});

describe("状态 chip (G1-17)", () => {
  it("shows 设计风格 only in the design scene", () => {
    const { rerender } = render(<StatusChips showDesignStyle={false} showImageMode={false} />);
    expect(screen.queryByRole("button", { name: /设计风格/ })).toBeNull();
    rerender(<StatusChips showDesignStyle showImageMode={false} />);
    expect(screen.getByRole("button", { name: "设计风格：默认" })).toBeInTheDocument();
  });

  it("shows 补图方式 when the model takes images", () => {
    render(<StatusChips showDesignStyle={false} showImageMode />);
    expect(screen.getByRole("button", { name: "补图方式：默认" })).toBeInTheDocument();
  });

  it("picks a style, clears it, and writes the prompt prefix", () => {
    render(<StatusChips showDesignStyle showImageMode />);
    fireEvent.click(screen.getByRole("button", { name: "设计风格：默认" }));
    fireEvent.click(screen.getByRole("option", { name: /专业严谨/ }));
    expect(useStatusStore.getState().designStyle).toBe("professional");
    expect(statusPrefix("professional", null)).toBe("【风格：专业严谨】");

    fireEvent.click(screen.getByRole("button", { name: /取消选中设计风格/ }));
    expect(useStatusStore.getState().designStyle).toBe("default");
    expect(statusPrefix("default", null)).toBe("");
  });

  it("picks an image mode and prefixes both chips", () => {
    render(<StatusChips showDesignStyle showImageMode />);
    fireEvent.click(screen.getByRole("button", { name: "补图方式：默认" }));
    fireEvent.click(screen.getByRole("option", { name: /AI 生图/ }));
    expect(useStatusStore.getState().imageMode).toBe("ai");
    expect(statusPrefix("professional", "ai")).toBe("【风格：专业严谨 · 补图：AI 生图】");
  });
});
