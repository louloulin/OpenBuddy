import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { SidebarTabs } from "../components/index.js";

const tabs = [
  { id: "p1", name: "Alpha", lastOpenedAt: "2026-09-23T10:00:00Z", path: "/work/alpha", pending: 2 },
  { id: "p2", name: "Bravo", lastOpenedAt: "2026-09-22T10:00:00Z" },
  { id: "p3", name: "Charlie", lastOpenedAt: "2026-09-21T10:00:00Z" },
];

describe("SidebarTabs", () => {
  it("renders one tab per project", () => {
    render(<SidebarTabs tabs={tabs} activeId="p1" />);
    expect(screen.getByTestId("sidebar-tab-p1")).toBeTruthy();
    expect(screen.getByTestId("sidebar-tab-p2")).toBeTruthy();
    expect(screen.getByTestId("sidebar-tab-p3")).toBeTruthy();
  });

  it("marks the active tab via aria-selected", () => {
    render(<SidebarTabs tabs={tabs} activeId="p2" />);
    expect(screen.getByTestId("sidebar-tab-p2").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("sidebar-tab-p1").getAttribute("aria-selected")).toBeNull();
  });

  it("calls onActivate when a tab is clicked", () => {
    const fn = vi.fn();
    render(<SidebarTabs tabs={tabs} activeId="p1" onActivate={fn} />);
    fireEvent.click(screen.getByTestId("sidebar-tab-p2"));
    expect(fn).toHaveBeenCalledWith("p2");
  });

  it("calls onClose when the close button is clicked", () => {
    const fn = vi.fn();
    render(<SidebarTabs tabs={tabs} activeId="p1" onClose={fn} />);
    fireEvent.click(screen.getByTestId("sidebar-tab-close-p2"));
    expect(fn).toHaveBeenCalledWith("p2");
  });

  it("shows the pending badge", () => {
    render(<SidebarTabs tabs={tabs} activeId="p1" />);
    expect(screen.getByTestId("sidebar-tab-pending-p1").textContent).toBe("2");
  });

  it("sorts by recency by default", () => {
    render(<SidebarTabs tabs={tabs} activeId="p1" />);
    const items = screen.getAllByTestId(/^sidebar-tab-[a-z][0-9]+$/);
    expect(items[0].getAttribute("data-testid")).toBe("sidebar-tab-p1");
    expect(items[2].getAttribute("data-testid")).toBe("sidebar-tab-p3");
  });

  it("does not re-sort when sortBy=manual", () => {
    render(<SidebarTabs tabs={tabs} activeId="p1" sortBy="manual" />);
    const items = screen.getAllByTestId(/^sidebar-tab-[a-z][0-9]+$/);
    expect(items[0].getAttribute("data-testid")).toBe("sidebar-tab-p1");
    expect(items[1].getAttribute("data-testid")).toBe("sidebar-tab-p2");
    expect(items[2].getAttribute("data-testid")).toBe("sidebar-tab-p3");
  });

  it("calls onNewProject when the + button is clicked", () => {
    const fn = vi.fn();
    render(<SidebarTabs tabs={tabs} activeId="p1" onNewProject={fn} />);
    fireEvent.click(screen.getByTestId("sidebar-tab-new"));
    expect(fn).toHaveBeenCalled();
  });
});
