/**
 * CitationChip.test.tsx — Plan5 B.5
 *
 * Validates the citation chip component renders, falls back to id when no
 * resolver is provided, and resolves via <ChatCitationProvider>.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  CitationChip,
  ChatCitationProvider,
  type Citation,
} from "../parts/CitationChip";

describe("CitationChip", () => {
  it("renders sourceId when no resolver is provided", () => {
    const { container } = render(<CitationChip sourceId="doc-1" />);
    const chip = container.querySelector(".citation-chip");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("data-citation-id")).toBe("doc-1");
    expect(chip?.getAttribute("data-citation-resolved")).toBe("false");
    expect(chip?.textContent).toContain("doc-1");
  });

  it("resolves title via ChatCitationProvider", () => {
    const { container } = render(
      <ChatCitationProvider
        resolve={(id) => (id === "doc-1" ? { id, title: "设计文档" } : undefined)}
      >
        <CitationChip sourceId="doc-1" />
      </ChatCitationProvider>,
    );
    const chip = container.querySelector(".citation-chip");
    expect(chip?.getAttribute("data-citation-resolved")).toBe("true");
    expect(chip?.textContent).toContain("设计文档");
  });

  it("does not invoke onSelect when unresolved", () => {
    const onSelect = vi.fn();
    const { container } = render(<CitationChip sourceId="x" onSelect={onSelect} />);
    fireEvent.click(container.querySelector(".citation-chip")!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("invokes onSelect with resolved citation", () => {
    const onSelect = vi.fn();
    const resolved: Citation = { id: "doc-1", title: "设计文档", locator: "p.12" };
    const { container } = render(
      <ChatCitationProvider resolve={() => resolved}>
        <CitationChip sourceId="doc-1" onSelect={onSelect} />
      </ChatCitationProvider>,
    );
    fireEvent.click(container.querySelector(".citation-chip")!);
    expect(onSelect).toHaveBeenCalledWith(resolved);
  });

  it("title attribute includes locator when resolved", () => {
    const { container } = render(
      <ChatCitationProvider
        resolve={() => ({ id: "doc-1", title: "设计文档", locator: "p.12" })}
      >
        <CitationChip sourceId="doc-1" />
      </ChatCitationProvider>,
    );
    const chip = container.querySelector(".citation-chip");
    expect(chip?.getAttribute("title")).toContain("p.12");
  });
});
