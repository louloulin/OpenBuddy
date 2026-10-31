/**
 * P-E2 — 上下文压缩分隔标记。
 *
 * pi 在压缩完成后发 `pi/context-compacted`;useAgentSession 往转录里追加
 * 一条 `systemMarker: "compaction"` 的非会话消息。这里锁定渲染契约:
 * 它必须是分隔条,而不是一个空的「Buddy」气泡。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageItem } from "../MessageItem";

import type { ChatMessage } from "@/stores/session-store";

vi.mock("../../../../ui/openbuddy-ui-workbench/src/pdfjs-loader", () => ({
  loadPdfJs: () => Promise.reject(new Error("pdfjs unavailable")),
}));

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (state: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

function markerMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "marker-1",
    role: "assistant",
    parts: [],
    complete: true,
    systemMarker: "compaction",
    ...overrides,
  };
}

describe("MessageItem compaction marker", () => {
  it("renders a separator row instead of an empty assistant bubble", () => {
    const { container } = render(
      <MessageItem message={markerMessage()} streaming={false} />,
    );
    const marker = screen.getByTestId("context-compaction-marker");
    expect(marker).toHaveAttribute("role", "separator");
    expect(marker.textContent).toContain("上下文已压缩");
    expect(container.querySelector(".msg--assistant")).toBeNull();
    expect(container.querySelector(".msg__body")).toBeNull();
  });

  it("shows the optional detail beside the label", () => {
    render(
      <MessageItem
        message={markerMessage({ systemMarkerDetail: "12.4K tokens" })}
        streaming={false}
      />,
    );
    expect(
      screen.getByTestId("context-compaction-marker").textContent,
    ).toContain("12.4K tokens");
  });
});
