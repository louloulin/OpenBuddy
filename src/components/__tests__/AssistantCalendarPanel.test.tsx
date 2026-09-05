import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssistantCalendarPanel } from "@openbuddy/ui-workbench";

const { calendarList, propose, createSideEffect } = vi.hoisted(() => {
  const weekStart = new Date();
  weekStart.setHours(12, 0, 0, 0);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
  const eventStart = new Date(weekStart.getTime() + 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000);
  const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
  return {
  calendarList: vi.fn(async () => [{
  id: "cal-1",
  title: "团队同步",
  start: eventStart.toISOString(),
  end: eventEnd.toISOString(),
  allDay: false,
  status: "confirmed" as const,
  roomId: "personal-room",
  contextRefs: ["assistant:calendar"],
  attendees: [],
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  }]),
  propose: vi.fn(async () => ({ taskId: "calendar-task-1" })),
  createSideEffect: vi.fn(async () => ({})),
  };
});

vi.mock("@/lib/agent/pi-client", () => ({ calendarList }));
vi.mock("@/lib/agent/assistant-facade", () => ({ assistantFacade: { propose, createSideEffect } }));

describe("AssistantCalendarPanel", () => {
  it("shows local events and creates an event through the calendar capability", async () => {
    render(<AssistantCalendarPanel onToast={vi.fn()} />);
    expect(await screen.findByText("团队同步")).toBeInTheDocument();
    expect(screen.getByText(/外部同步：未配置/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建本地日程" }));
    fireEvent.change(screen.getByLabelText("日程标题"), { target: { value: "写方案" } });
    fireEvent.click(screen.getByRole("button", { name: "提交审批" }));

    await waitFor(() => expect(propose).toHaveBeenCalledWith(expect.objectContaining({ capability: "calendar:create", capabilityInput: expect.objectContaining({ title: "写方案", roomId: "personal-room", allDay: false }) })));
    expect(createSideEffect).toHaveBeenCalledWith(expect.objectContaining({ taskId: "calendar-task-1", capability: "calendar:create", action: "write:calendar" }));
  });
});
