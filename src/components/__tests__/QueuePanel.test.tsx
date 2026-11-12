import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueuePanel } from "../QueuePanel";
import { agentClearQueue, agentGetQueue } from "@/lib/agent-client";
vi.mock("@/lib/agent-client", () => ({ agentGetQueue: vi.fn(), agentClearQueue: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(agentGetQueue).mockResolvedValue({ steering: ["steer item"], followUp: ["next turn"] }); });
describe("Pi queue panel", () => {
  it("shows real steering and follow-up queues as distinct modes", async () => {
    render(<QueuePanel sessionId="A" />);
    expect(await screen.findByText("steer item")).toBeInTheDocument();
    expect(screen.getByText("next turn")).toBeInTheDocument();
    expect(screen.getByText(/下一工具边界引导/)).toBeInTheDocument();
    expect(screen.getByText(/回复完成后继续/)).toBeInTheDocument();
  });
  it("only clears displayed items after the backend confirms its actual queue", async () => {
    vi.mocked(agentClearQueue).mockResolvedValue({ steering: ["steer item"], followUp: ["next turn"] });
    render(<QueuePanel sessionId="A" />); await screen.findByText("steer item");
    vi.mocked(agentGetQueue).mockResolvedValue({ steering: [], followUp: [] });
    fireEvent.click(screen.getByRole("button", { name: "清空 Pi 队列" }));
    await waitFor(() => expect(screen.queryByText("steer item")).toBeNull());
    expect(agentClearQueue).toHaveBeenCalledWith("A");
  });
  it("keeps queue items visible and allows retry when clearing fails", async () => {
    vi.mocked(agentClearQueue).mockRejectedValue(new Error("busy"));
    render(<QueuePanel sessionId="A" />); await screen.findByText("steer item");
    fireEvent.click(screen.getByRole("button", { name: "清空 Pi 队列" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("busy");
    expect(screen.getByText("steer item")).toBeInTheDocument();
  });
});
