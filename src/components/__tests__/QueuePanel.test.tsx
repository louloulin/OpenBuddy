import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueuePanel } from "../QueuePanel";
import { agentClearQueue } from "@/lib/agent-client";
import { usePiQueueStore } from "@/stores/pi-queue-store";
vi.mock("@/lib/agent-client", () => ({ agentClearQueue: vi.fn() }));

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
});
