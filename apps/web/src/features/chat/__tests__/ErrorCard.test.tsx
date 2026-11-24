import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorCard } from "../ErrorCard";

describe("ErrorCard actions (G1-28)", () => {
  it("offers in-place compaction for a context overflow", () => {
    const onCompact = vi.fn();
    render(<ErrorCard error="prompt is too long: context length exceeded" onCompact={onCompact} />);
    fireEvent.click(screen.getByRole("button", { name: "压缩上下文" }));
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("sends auth failures to the model settings", () => {
    render(<ErrorCard error="401 Unauthorized: invalid api key" />);
    expect(screen.getByRole("button", { name: "去设置" })).toBeInTheDocument();
  });

  it("keeps retry for a plain network failure", () => {
    const onRetry = vi.fn();
    render(<ErrorCard error="fetch failed: econnrefused" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
