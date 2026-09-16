import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CapabilityVersionBadge, resolveBadgeRelation } from "../components/CapabilityVersionBadge";

afterEach(() => cleanup());

describe("resolveBadgeRelation", () => {
  it("maps version pairs to relations", () => {
    expect(resolveBadgeRelation({ version: "1.1.0", current: "1.0.0" })).toBe("upgrade");
    expect(resolveBadgeRelation({ version: "1.0.0", current: "1.1.0" })).toBe("downgrade");
    expect(resolveBadgeRelation({ version: "1.0.0", current: "1.0.0" })).toBe("same");
    expect(resolveBadgeRelation({ version: "2.0.0", current: "1.0.0", incompatible: true })).toBe(
      "incompatible",
    );
    expect(resolveBadgeRelation({ version: "2.0.0", current: "1.0.0", installing: true })).toBe(
      "unknown",
    );
  });
});

describe("CapabilityVersionBadge", () => {
  it("shows both versions and the relation label", () => {
    render(<CapabilityVersionBadge version="1.2.0" current="1.0.0" onUpgrade={() => {}} />);
    expect(screen.getByText("1.2.0")).toBeTruthy();
    expect(screen.getByText("← 1.0.0")).toBeTruthy();
    expect(screen.getByText("可升级")).toBeTruthy();
    expect(screen.getByTestId("version-upgrade")).toBeTruthy();
  });

  it("renders the rollback affordance only for downgrades", () => {
    const onRollback = vi.fn();
    render(<CapabilityVersionBadge version="1.0.0" current="2.0.0" onRollback={onRollback} />);
    const button = screen.getByTestId("version-rollback");
    fireEvent.click(button);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("version-upgrade")).toBeNull();
  });

  it("marks major upgrades as breaking", () => {
    render(<CapabilityVersionBadge version="2.0.0" current="1.4.0" onUpgrade={() => {}} />);
    expect(screen.getByText("破坏性升级")).toBeTruthy();
  });

  it("summarizes capabilities with risk tone", () => {
    render(
      <CapabilityVersionBadge
        version="1.0.0"
        capabilities={[
          { id: "shell.exec", risk: "high" },
          { id: "fs.read", risk: "low" },
        ]}
      />,
    );
    const risk = screen.getByText(/2 项能力/);
    expect(risk.textContent).toContain("高风险");
  });

  it("renders incompatible and compact variants", () => {
    const { rerender } = render(
      <CapabilityVersionBadge version="2.0.0" current="1.0.0" incompatible />,
    );
    expect(screen.getByText("版本不兼容")).toBeTruthy();
    rerender(<CapabilityVersionBadge compact version="2.0.0" current="1.0.0" incompatible />);
    expect(screen.getByText("2.0.0")).toBeTruthy();
    expect(screen.queryByText("版本不兼容")).toBeNull();
  });

  it("omits action buttons when no handler is provided", () => {
    render(<CapabilityVersionBadge version="1.2.0" current="1.0.0" />);
    expect(screen.queryByTestId("version-upgrade")).toBeNull();
  });

  it("renders kind chips when provided", () => {
    render(<CapabilityVersionBadge version="1.0.0" kinds={["plugin", "theme"]} />);
    expect(screen.getByText("插件")).toBeTruthy();
    expect(screen.getByText("主题")).toBeTruthy();
  });
});
