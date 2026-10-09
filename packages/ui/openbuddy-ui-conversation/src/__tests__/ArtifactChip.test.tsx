/**
 * ArtifactChip.test.tsx — Plan5 B.5
 *
 * Validates the artifact chip component renders with hash, picks icons by
 * kind, and resolves via <ChatArtifactProvider>.
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import {
  ArtifactChip,
  ChatArtifactProvider,
  type ArtifactMeta,
} from "../parts/ArtifactChip";

describe("ArtifactChip", () => {
  it("renders id when no resolver is provided", () => {
    const { container } = render(<ArtifactChip id="abc123def456" />);
    const chip = container.querySelector(".artifact-chip");
    expect(chip).toBeTruthy();
    expect(chip?.getAttribute("data-artifact-id")).toBe("abc123def456");
    expect(chip?.getAttribute("data-artifact-resolved")).toBe("false");
  });

  it("renders hash head 6 chars when meta has a hash", () => {
    const meta: ArtifactMeta = {
      id: "abc123",
      kind: "code",
      title: "schema.sql",
      hash: "abcdef0123456789",
    };
    const { container } = render(
      <ChatArtifactProvider resolve={() => meta}>
        <ArtifactChip id="abc123" />
      </ChatArtifactProvider>,
    );
    const chip = container.querySelector(".artifact-chip");
    expect(chip?.getAttribute("data-artifact-resolved")).toBe("true");
    expect(chip?.textContent).toContain("schema.sql");
    expect(chip?.textContent).toContain("abcdef");
  });

  it("does not invoke onSelect when unresolved", () => {
    const onSelect = vi.fn();
    const { container } = render(<ArtifactChip id="x" onSelect={onSelect} />);
    fireEvent.click(container.querySelector(".artifact-chip")!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("invokes onSelect with resolved artifact", () => {
    const meta: ArtifactMeta = { id: "1", kind: "dataset", title: "result.csv" };
    const onSelect = vi.fn();
    const { container } = render(
      <ChatArtifactProvider resolve={() => meta}>
        <ArtifactChip id="1" onSelect={onSelect} />
      </ChatArtifactProvider>,
    );
    fireEvent.click(container.querySelector(".artifact-chip")!);
    expect(onSelect).toHaveBeenCalledWith(meta);
  });
});
