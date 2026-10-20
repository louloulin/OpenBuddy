/**
 * QueuedMessages —— composer 一等队列插槽(A1)的行为测试。
 *
 * 用真实 zustand store(seed 直塞 state,不走 action → 不触发持久化);
 * persist 用的 `@/lib/agent/pi-client` 整体替身(删除/暂停会触发 persist)。
 * useT 替身返回 key 本身 —— 文案正确性由 i18n 词表门禁负责,这里测接线。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/agent/pi-client", () => ({
  rendererStorageWrite: vi.fn(async () => ({ ok: true })),
  rendererStorageRemove: vi.fn(async () => ({ ok: true })),
  rendererStorageRead: vi.fn(async () => ({ ok: true, value: null })),
  rendererStorageList: vi.fn(async () => ({ ok: true, values: [] })),
}));
vi.mock("@openbuddy/ui-locale/client", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === "chat.queue.count" ? `queued:${params?.count}` : key,
  }),
}));

import { QueuedMessages } from "../QueuedMessages";
import { useMessageQueueStore, type QueueItem } from "@/stores/message-queue-store";

const SESSION = "s-queue";

function seed(items: Array<Partial<QueueItem>>): void {
  useMessageQueueStore.setState((prev) => ({
    queues: {
      ...prev.queues,
      [SESSION]: items.map((it, i) => ({
        id: it.id ?? `q-${i}`,
        text: it.text ?? "text",
        paused: it.paused ?? false,
        createdAt: it.createdAt ?? Date.now(),
      })),
    },
  }));
}

describe("QueuedMessages(composer 队列插槽)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMessageQueueStore.setState({ queues: {} });
  });

  it("空队列不渲染", () => {
    const { container } = render(<QueuedMessages sessionId={SESSION} />);
    expect(container.querySelector(".composer-queued")).toBeNull();
  });

  it("头部常显计数,一行一条(序号+摘要)", () => {
    seed([{ text: "第一条消息" }, { text: "第二条消息", paused: true }]);
    render(<QueuedMessages sessionId={SESSION} />);
    expect(screen.getByText("queued:2")).toBeInTheDocument();
    expect(screen.getByText("第一条消息")).toBeInTheDocument();
    expect(screen.getByText("第二条消息")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("删除:点 ✕ 后该行消失(store remove 生效)", () => {
    seed([{ text: "会留下的" }, { text: "会被删的" }]);
    const { container } = render(<QueuedMessages sessionId={SESSION} />);
    const rows = container.querySelectorAll("[data-queued-row]");
    fireEvent.click(rows[1].querySelector("button[aria-label='chat.queue.remove']")!);
    expect(useMessageQueueStore.getState().queues[SESSION]).toHaveLength(1);
    expect(useMessageQueueStore.getState().queues[SESSION][0].text).toBe("会留下的");
  });

  it("暂停/恢复切换 paused 态", () => {
    seed([{ text: "唯一一条" }]);
    render(<QueuedMessages sessionId={SESSION} />);
    fireEvent.click(screen.getByLabelText("chat.queue.pause"));
    expect(useMessageQueueStore.getState().queues[SESSION][0].paused).toBe(true);
    fireEvent.click(screen.getByLabelText("chat.queue.resume"));
    expect(useMessageQueueStore.getState().queues[SESSION][0].paused).toBe(false);
  });

  it("立即发送:先从队列移除再回调 onSendNow", () => {
    seed([{ text: "马上发我" }, { text: "还在排" }]);
    const onSendNow = vi.fn();
    render(<QueuedMessages sessionId={SESSION} onSendNow={onSendNow} />);
    const rows = screen.getAllByRole("option");
    fireEvent.click(rows[0].querySelector("button[aria-label='chat.queue.sendNow']")!);
    expect(onSendNow).toHaveBeenCalledWith("马上发我");
    const rest = useMessageQueueStore.getState().queues[SESSION];
    expect(rest).toHaveLength(1);
    expect(rest[0].text).toBe("还在排");
  });

  it("↑ 键盘导航经 useRowPanelNav 在行间移动焦点", () => {
    seed([{ text: "a" }, { text: "b" }]);
    const { container } = render(<QueuedMessages sessionId={SESSION} />);
    const rows = container.querySelectorAll<HTMLElement>("[data-queued-row]");
    rows[1].focus();
    const dock = container.querySelector(".composer-queued") as HTMLElement;
    fireEvent.keyDown(dock, { key: "ArrowUp" });
    expect(document.activeElement).toBe(rows[0]);
  });
});
