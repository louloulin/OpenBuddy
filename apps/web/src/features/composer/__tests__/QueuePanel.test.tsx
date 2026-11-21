import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueuePanel } from "../QueuePanel";
import { agentClearQueue, agentSetQueue } from "@openbuddy/client/agent-client";
import { usePiQueueStore } from "@/features/composer/state/pi-queue-store";
vi.mock("@openbuddy/client/agent-client", () => ({ agentClearQueue: vi.fn(), agentSetQueue: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  act(() => usePiQueueStore.getState().apply("A", { steering: ["steer item"], followUp: ["next turn"] }));
});

describe("Pi queue panel", () => {
  it("shows the engine's steering and follow-up queues as distinct kinds", () => {
    render(<QueuePanel sessionId="A" />);
    expect(screen.getByText("steer item")).toBeInTheDocument();
    expect(screen.getByText("next turn")).toBeInTheDocument();
    expect(screen.getByText("插话")).toBeInTheDocument();
    expect(screen.getByText("待发送")).toBeInTheDocument();
    expect(screen.getByText(/排队中的消息 2/)).toBeInTheDocument();
  });

  it("renders nothing for another session or an empty queue", () => {
    const { container } = render(<QueuePanel sessionId="B" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("follows queue_update pushes from the engine", () => {
    render(<QueuePanel sessionId="A" />);
    act(() => usePiQueueStore.getState().apply("A", { steering: [], followUp: ["only one"] }));
    expect(screen.queryByText("steer item")).toBeNull();
    expect(screen.getByText("only one")).toBeInTheDocument();
  });

  it("clears the displayed items once the engine confirms", async () => {
    vi.mocked(agentClearQueue).mockResolvedValue({ steering: ["steer item"], followUp: ["next turn"] });
    render(<QueuePanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "全部撤回" }));
    await waitFor(() => expect(screen.queryByText("steer item")).toBeNull());
    expect(agentClearQueue).toHaveBeenCalledWith("A");
  });

  it("keeps queue items visible and shows the error when clearing fails", async () => {
    vi.mocked(agentClearQueue).mockRejectedValue(new Error("busy"));
    render(<QueuePanel sessionId="A" />);
    fireEvent.click(screen.getByRole("button", { name: "全部撤回" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("steer item")).toBeInTheDocument();
  });

  it("keeps queued attachments when a row moves (pii W1.8)", async () => {
    vi.mocked(agentSetQueue).mockResolvedValue({ steering: ["第二条"], followUp: ["第一条"] });
    act(() => usePiQueueStore.getState().applyEnqueued("A", { steering: [], followUp: ["第一条", "第二条"] }, "第二条", [{ path: "/tmp/shot.png" }], "followUp"));
    render(<QueuePanel sessionId="A" />);
    expect(screen.getByText("图 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上移：第二条" }));
    await waitFor(() => expect(agentSetQueue).toHaveBeenLastCalledWith(
      "A",
      [],
      [{ text: "第二条", attachments: [{ path: "/tmp/shot.png" }] }, "第一条"],
    ));
  });

  it("edits, sends now, moves and withdraws single rows (U4.5)", async () => {
    vi.mocked(agentSetQueue).mockImplementation(async (_sid, steering, followUp) => ({
      steering: steering.map((item) => (typeof item === "string" ? item : item.text)),
      followUp: followUp.map((item) => (typeof item === "string" ? item : item.text)),
    }));
    act(() => usePiQueueStore.getState().apply("A", { steering: [], followUp: ["第一条", "第二条", "第三条"] }));
    const onEdit = vi.fn();
    render(<QueuePanel sessionId="A" onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: "立即插话：第二条" }));
    await waitFor(() => expect(agentSetQueue).toHaveBeenLastCalledWith("A", ["第二条"], ["第一条", "第三条"]));
    fireEvent.click(await screen.findByRole("button", { name: "上移：第三条" }));
    await waitFor(() => expect(agentSetQueue).toHaveBeenLastCalledWith("A", ["第二条"], ["第三条", "第一条"]));
    fireEvent.click(await screen.findByRole("button", { name: "编辑：第一条" }));
    expect(onEdit).toHaveBeenCalledWith("第一条");
    await waitFor(() => expect(agentSetQueue).toHaveBeenLastCalledWith("A", ["第二条"], ["第三条"]));
    fireEvent.click(await screen.findByRole("button", { name: "撤回：第二条" }));
    await waitFor(() => expect(screen.queryByText("第二条")).toBeNull());
    expect(screen.getByText("排队中的消息 1")).toBeInTheDocument();
  });
});
