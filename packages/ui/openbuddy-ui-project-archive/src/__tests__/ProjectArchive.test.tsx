import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { ProjectArchive } from "../components/index.js";

const items = [
  { id: "p1", name: "Acme", path: "/work/acme", archivedAt: "2026-08-01" },
  { id: "p2", name: "Bravo", path: "/work/bravo", archivedAt: "2026-09-15", reason: "owner moved" },
];

describe("ProjectArchive", () => {
  it("renders each archive row", () => {
    render(<ProjectArchive items={items} />);
    expect(screen.getByTestId("archive-p1")).toBeTruthy();
    expect(screen.getByTestId("archive-p2")).toBeTruthy();
  });

  it("filters by query", () => {
    render(<ProjectArchive items={items} />);
    const input = screen.getByTestId("archive-search");
    fireEvent.change(input, { target: { value: "bravo" } });
    expect(screen.getByTestId("archive-p2")).toBeTruthy();
    expect(screen.queryByTestId("archive-p1")).toBeNull();
  });

  it("shows the empty state when no items", () => {
    render(<ProjectArchive items={[]} />);
    expect(screen.getByText(/No archived projects yet/)).toBeTruthy();
  });

  it("calls onRestore", async () => {
    const fn = vi.fn(async () => {});
    render(<ProjectArchive items={items} onRestore={fn} />);
    fireEvent.click(screen.getByTestId("archive-restore-p1"));
    await waitFor(() => expect(fn).toHaveBeenCalledWith("p1"));
  });

  it("requires a confirm step before onDelete", async () => {
    const fn = vi.fn(async () => {});
    render(<ProjectArchive items={items} onDelete={fn} />);
    fireEvent.click(screen.getByTestId("archive-delete-p1"));
    expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("archive-confirm-p1"));
    await waitFor(() => expect(fn).toHaveBeenCalledWith("p1"));
  });

  it("calls onSearch on input change", () => {
    const fn = vi.fn();
    render(<ProjectArchive items={items} onSearch={fn} />);
    fireEvent.change(screen.getByTestId("archive-search"), { target: { value: "abc" } });
    expect(fn).toHaveBeenCalledWith("abc");
  });
});
