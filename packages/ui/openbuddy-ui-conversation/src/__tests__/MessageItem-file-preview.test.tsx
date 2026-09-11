import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/stores/session-store";

vi.mock("@/lib/runtime/renderer-plugin-runtime", () => ({
  useRendererContributions: () => [],
  useRendererSlot: () => [],
}));

vi.mock("@openbuddy/ui-theme/client", () => ({
  useThemeSnapshot: (selector: (state: { current: () => string }) => unknown) =>
    selector({ current: () => "light" }),
}));

import { MessageItem } from "../MessageItem";

function message(role: ChatMessage["role"], parts: ChatMessage["parts"]): ChatMessage {
  return { id: `${role}-1`, role, parts, complete: true };
}

describe("MessageItem file parts", () => {
  it("renders a user PDF file part through FilePreview with a complete data URL", () => {
    const { container } = render(
      <MessageItem
        message={message("user", [
          {
            kind: "file",
            name: "brief.pdf",
            mediaType: "application/pdf",
            data: "cGRm",
          },
        ])}
        streaming={false}
      />,
    );

    const preview = container.querySelector(".file-preview--pdf");
    const iframe = container.querySelector(".file-preview--pdf iframe");
    expect(preview).not.toBeNull();
    expect(iframe).toHaveAttribute("src", "data:application/pdf;base64,cGRm");
    expect(iframe).toHaveAttribute("title", "brief.pdf");
  });

  it("keeps an existing data URL unchanged and preserves the filename", () => {
    const content = "data:application/pdf;base64,cGRm";
    const { container } = render(
      <MessageItem
        message={message("assistant", [
          {
            kind: "file",
            name: "report.pdf",
            mediaType: "application/pdf",
            data: content,
          },
        ])}
        streaming={false}
      />,
    );

    expect(container.querySelector(".file-preview__name")).toHaveTextContent("report.pdf");
    expect(container.querySelector("iframe")).toHaveAttribute("src", content);
  });

  it("renders multiple office attachments in transcript order", () => {
    const { container } = render(
      <MessageItem
        message={message("user", [
          { kind: "file", name: "notes.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: "not-a-zip" },
          { kind: "file", name: "data.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data: "not-a-zip" },
          { kind: "file", name: "deck.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: "not-a-zip" },
        ])}
        streaming={false}
      />,
    );

    expect(Array.from(container.querySelectorAll(".file-preview__name")).map((node) => node.textContent)).toEqual([
      "notes.docx",
      "data.xlsx",
      "deck.pptx",
    ]);
    expect(container.querySelectorAll(".file-preview--doc")).toHaveLength(3);
  });

  it("uses safe fallback metadata for an empty MIME and filename", () => {
    const { container } = render(
      <MessageItem
        message={message("user", [
          { kind: "file", name: "", mediaType: "", data: "" },
        ])}
        streaming={false}
      />,
    );

    expect(container.querySelector(".file-preview--binary")).not.toBeNull();
    expect(container.querySelector(".file-preview__name")).toHaveTextContent("attachment");
  });
});
