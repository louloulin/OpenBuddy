import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { WorkPanel, WorkPanelSection } from "../components/index.js";

describe("WorkPanel", () => {
  it("renders tabs for each section", () => {
    render(
      <WorkPanel
        sections={[
          { id: "a", title: "Alpha", slotId: "alpha" },
          { id: "b", title: "Beta", slotId: "beta" },
        ]}
        resolveSection={(id) => <div data-testid={`content-${id}`} />}
      />,
    );
    expect(screen.getByTestId("work-panel-tab-a")).toBeTruthy();
    expect(screen.getByTestId("work-panel-tab-b")).toBeTruthy();
  });

  it("shows the active section's content", () => {
    render(
      <WorkPanel
        sections={[
          { id: "a", title: "Alpha", slotId: "alpha" },
          { id: "b", title: "Beta", slotId: "beta" },
        ]}
        resolveSection={(id) => <div data-testid={`content-${id}`} />}
      />,
    );
    expect(screen.getByTestId("content-alpha")).toBeTruthy();
    expect(screen.queryByTestId("content-beta")).toBeNull();
  });

  it("switches content when a tab is clicked", () => {
    render(
      <WorkPanel
        sections={[
          { id: "a", title: "Alpha", slotId: "alpha" },
          { id: "b", title: "Beta", slotId: "beta" },
        ]}
        resolveSection={(id) => <div data-testid={`content-${id}`} />}
      />,
    );
    fireEvent.click(screen.getByTestId("work-panel-tab-b"));
    expect(screen.queryByTestId("content-alpha")).toBeNull();
    expect(screen.getByTestId("content-beta")).toBeTruthy();
  });

  it("shows the empty state when no sections are registered", () => {
    render(<WorkPanel sections={[]} resolveSection={() => null} />);
    expect(screen.getByTestId("work-panel-empty")).toBeTruthy();
  });

  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <WorkPanel
        sections={[{ id: "a", title: "Alpha", slotId: "alpha" }]}
        resolveSection={() => null}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("work-panel-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("WorkPanelSection", () => {
  it("renders title and children", () => {
    render(<WorkPanelSection title="My Section">Hello</WorkPanelSection>);
    expect(screen.getByText("My Section")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("sets data-tone attribute based on tone prop", () => {
    render(<WorkPanelSection title="Danger" tone="danger">x</WorkPanelSection>);
    expect(screen.getByTestId("work-panel-section-wrap").getAttribute("data-tone")).toBe("danger");
  });
});
