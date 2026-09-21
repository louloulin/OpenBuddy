import { describe, expect, it, vi, beforeEach} from "vitest";
import { swrCacheInternal } from "../hooks/useSwrCache";
import { fireEvent, render, screen } from "@testing-library/react";
import { AiMessageList, type AiMessage } from "../components/AiMessageList";

const messages: AiMessage[] = [
  {
    id: "m1",
    from: { name: "Lin", address: "lin@x" },
    date: "2026-09-21T09:00:00Z",
    text: "Hi, please confirm Q4 roadmap.",
    unread: true,
    attachments: [],
  },
  {
    id: "m2",
    from: { name: "Lin", address: "lin@x" },
    date: "2026-09-21T10:00:00Z",
    html: "<p>Thanks!</p>",
    unread: false,
    attachments: [{ id: "a1", name: "q4.pdf", mimeType: "application/pdf", size: 1024 }],
    unsubscribeLinks: ["https://example.com/unsub"],
  },
];

beforeEach(() => { swrCacheInternal.reset(); });
describe("AiMessageList", () => {
  it("renders text and html safely", () => {
    render(<AiMessageList messages={messages} />);
    expect(screen.getByText("Hi, please confirm Q4 roadmap.")).toBeTruthy();
    // HTML is sanitized — no raw script tags allowed
    expect(screen.getByText("Thanks!")).toBeTruthy();
  });

  it("marks current message by messageIndex", () => {
    const { container } = render(<AiMessageList messages={messages} messageIndex={1} />);
    const current = container.querySelector(".ai-message.is-current");
    expect(current?.getAttribute("data-message-id")).toBe("m2");
  });

  it("renders attachments and downloads on click", () => {
    const onDownload = vi.fn();
    render(<AiMessageList messages={messages} onDownloadAttachment={onDownload} />);
    fireEvent.click(screen.getByRole("button", { name: /q4.pdf/ }));
    expect(onDownload).toHaveBeenCalledWith("m2", "a1");
  });

  it("renders unsubscribe button when links present", () => {
    const onUnsubscribe = vi.fn();
    render(<AiMessageList messages={messages} onUnsubscribe={onUnsubscribe} />);
    fireEvent.click(screen.getByRole("button", { name: /退订/ }));
    expect(onUnsubscribe).toHaveBeenCalledWith(messages[1]);
  });

  it("disables unsubscribe when canManageOperation returns false", () => {
    render(<AiMessageList messages={messages} canManageOperation={() => false} />);
    expect(screen.getByRole("button", { name: /退订/ })).toBeDisabled();
  });

  it("disables unsubscribe when no callback provided", () => {
    render(<AiMessageList messages={messages} />);
    expect(screen.getByRole("button", { name: /退订/ })).toBeDisabled();
  });

  it("renders empty placeholder when no messages", () => {
    render(<AiMessageList messages={[]} />);
    expect(screen.getByText(/无消息/)).toBeTruthy();
  });

  it("renders body fallback for messages with neither html nor text", () => {
    render(<AiMessageList messages={[{ ...messages[0]!, text: undefined }]} />);
    expect(screen.getByText(/无正文/)).toBeTruthy();
  });
});
