import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useSessionStore, type ChatMessage } from "@/stores/session-store";
import { ThemeProvider } from "@openbuddy/ui/ThemeProvider";
import { ChatView } from "../ChatView";

vi.mock("@openbuddy/client/ipc", () => ({
  invoke: vi.fn(async (command: string) => (command.endsWith("_list") || command === "list_dir" ? [] : null)),
  save: vi.fn(),
  listen: vi.fn(async () => () => {}),
}));

/** `turns` question/answer pairs → 2 × turns chat nodes. */
function transcript(turns: number): ChatMessage[] {
  return Array.from({ length: turns }, (_, i) => [
    { id: `u${i}`, role: "user" as const, complete: true, parts: [{ kind: "text" as const, text: `问题 ${i}` }] },
    { id: `a${i}`, role: "assistant" as const, complete: true, parts: [{ kind: "text" as const, text: `回答 ${i}` }] },
  ]).flat();
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  act(() => useSessionStore.setState({ sessionId: "long", messages: transcript(100), streaming: false, error: null }));
});

it("mounts only the newest nodes of a long session and the rest on demand", () => {
  const { container } = render(<ThemeProvider><ChatView onSend={vi.fn()} onCancel={vi.fn()} /></ThemeProvider>);
  // 200 nodes; the newest 30 are mounted.
  expect(container.querySelectorAll("[data-msg-ids]")).toHaveLength(30);
  expect(screen.getByText("回答 99")).toBeInTheDocument();
  expect(screen.queryByText("回答 0")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /显示更早的对话（还有 170 条）/ }));
  expect(container.querySelectorAll("[data-msg-ids]")).toHaveLength(60);
});

it("starts windowed again for another session and mounts find hits that are not rendered", async () => {
  const { container } = render(<ThemeProvider><ChatView onSend={vi.fn()} onCancel={vi.fn()} /></ThemeProvider>);
  act(() => useSessionStore.setState({ sessionId: "other", messages: transcript(40) }));
  expect(container.querySelectorAll("[data-msg-ids]")).toHaveLength(30);
  // Ctrl/Cmd+F → search an old answer: its turn is mounted and scrolled to.
  fireEvent.keyDown(window, { key: "f", ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText(/查找/), { target: { value: "回答 2" } });
  expect(await screen.findByText("回答 2")).toBeInTheDocument();
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
});
