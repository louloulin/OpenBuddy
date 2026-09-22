import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { ToolCallCard } from "../ToolCallCard";
import type { ToolCallView } from "@/stores/session-store";

function baseTc(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc-1",
    title: "ls -la /tmp",
    kind: "bash",
    status: "completed",
    content: [],
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_200,
    ...overrides,
  };
}

describe("inspect", () => {
  it("renders", () => {
    const { container } = render(<ToolCallCard tc={baseTc()} />);
    console.log(container.innerHTML);
  });
});
