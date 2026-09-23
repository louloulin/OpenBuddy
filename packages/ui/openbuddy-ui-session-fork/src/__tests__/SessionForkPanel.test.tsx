import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { SessionForkPanel } from "../components/index.js";

const forks = [
  { id: "f0", parentId: null, label: "Original", createdAt: "2026-09-20", messageCount: 12 },
  { id: "f1", parentId: "f0", label: "Variant A", createdAt: "2026-09-21", fromLineNo: 5, messageCount: 4 },
  { id: "f2", parentId: "f0", label: "Variant B", createdAt: "2026-09-22", fromLineNo: 8, messageCount: 6 },
  { id: "f3", parentId: "f1", label: "A-deep", createdAt: "2026-09-23", messageCount: 2 },
];

describe("SessionForkPanel", () => {
  it("renders all fork nodes", () => {
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" />);
    expect(screen.getByTestId("fork-f0")).toBeTruthy();
    expect(screen.getByTestId("fork-f1")).toBeTruthy();
    expect(screen.getByTestId("fork-f2")).toBeTruthy();
    expect(screen.getByTestId("fork-f3")).toBeTruthy();
  });

  it("marks the active fork", () => {
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f2" />);
    expect(screen.getByTestId("fork-f2").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("fork-f0").getAttribute("data-active")).toBeNull();
  });

  it("calls onSelectFork when a fork is clicked", () => {
    const fn = vi.fn();
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" onSelectFork={fn} />);
    fireEvent.click(screen.getByTestId("fork-f1").querySelector('[role="treeitem"]')!);
    expect(fn).toHaveBeenCalledWith("f1");
  });

  it("calls onCreateFork with the parsed line number", () => {
    const fn = vi.fn();
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" onCreateFork={fn} />);
    fireEvent.change(screen.getByTestId("fork-create-line"), { target: { value: "12" } });
    fireEvent.click(screen.getByTestId("fork-create-btn"));
    expect(fn).toHaveBeenCalledWith(12);
  });

  it("does not fire onCreateFork for invalid input", () => {
    const fn = vi.fn();
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" onCreateFork={fn} />);
    fireEvent.click(screen.getByTestId("fork-create-btn"));
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls onDeleteFork with the fork id", () => {
    const fn = vi.fn();
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" onDeleteFork={fn} />);
    fireEvent.click(screen.getByTestId("fork-delete-f1"));
    expect(fn).toHaveBeenCalledWith("f1");
  });

  it("does not render delete on the root fork", () => {
    render(<SessionForkPanel rootSessionId="abc" forks={forks} activeForkId="f0" onDeleteFork={() => {}} />);
    expect(screen.queryByTestId("fork-delete-f0")).toBeNull();
  });
});
