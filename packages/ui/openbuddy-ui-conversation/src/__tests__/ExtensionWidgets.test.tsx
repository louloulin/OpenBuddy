import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ExtensionWidgets, widgetBodyText } from "../ExtensionWidgets";

describe("ExtensionWidgets — extension UI cards (phase 5)", () => {
  const widgets = [
    {
      id: "w1",
      pluginId: "pi-goal-list-loop-audit",
      title: "目标循环审计",
      body: "检测到 3 个待办目标",
      fields: [
        { key: "目标数", value: "3" },
        { key: "状态", value: "进行中" },
      ],
      actions: [
        { id: "view", label: "查看", kind: "primary" as const },
        { id: "dismiss", label: "忽略", kind: "secondary" as const },
      ],
    },
  ];

  it("renders nothing when there are no widgets", () => {
    const { container } = render(<ExtensionWidgets widgets={[]} />);
    expect(container.querySelector(".extension-widgets")).toBeNull();
  });

  it("renders widget title, body, fields, and actions", () => {
    render(<ExtensionWidgets widgets={widgets} />);
    expect(screen.getByTestId("extension-widget-w1")).toBeInTheDocument();
    expect(screen.getByText("目标循环审计")).toBeInTheDocument();
    expect(screen.getByText("检测到 3 个待办目标")).toBeInTheDocument();
    expect(screen.getByText("目标数")).toBeInTheDocument();
    expect(screen.getByText("查看")).toBeInTheDocument();
  });

  it("calls onAction with widgetId and actionId", () => {
    const onAction = vi.fn();
    render(<ExtensionWidgets widgets={widgets} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("extension-widget-action-w1-view"));
    expect(onAction).toHaveBeenCalledWith("w1", "view");
  });

  it("calls onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<ExtensionWidgets widgets={widgets} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("extension-widget-dismiss-w1"));
    expect(onDismiss).toHaveBeenCalledWith("w1");
  });

  it("widgetBodyText flattens title/body/fields", () => {
    const text = widgetBodyText(widgets[0]!);
    expect(text).toContain("目标循环审计");
    expect(text).toContain("目标数: 3");
  });
});
