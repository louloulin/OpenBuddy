/**
 * SafeMarkdownBody tests — Phase R3.0 (pi-web-alignment).
 *
 * Pins the oversized-content guard. Below threshold → normal Markdown.
 * Above threshold → reveal button + scrollable <pre>.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SafeMarkdownBody,
  MAX_MARKDOWN_CHARS,
} from "../SafeMarkdownBody";

describe("SafeMarkdownBody", () => {
  it("renders Markdown normally when payload is below the threshold", () => {
    const small = "hello world";
    const { container } = render(<SafeMarkdownBody>{small}</SafeMarkdownBody>);
    // No reveal button when content is small.
    expect(screen.queryByTestId("safe-md-reveal")).toBeNull();
    expect(screen.queryByTestId("safe-md-raw")).toBeNull();
    // The Markdown component should have rendered — its root <div> lives
    // somewhere under `container`.
    expect(container.firstChild).toBeTruthy();
  });

  it("shows a reveal button when payload exceeds the threshold", () => {
    const huge = "x".repeat(MAX_MARKDOWN_CHARS + 1);
    render(<SafeMarkdownBody>{huge}</SafeMarkdownBody>);
    const btn = screen.getByTestId("safe-md-reveal");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Large message/);
    // 100_001 bytes → Math.round(100001/1000) = 100 → "100 KB"
    expect(btn.textContent).toMatch(/100 KB/);
  });

  it("reveals the raw payload after clicking the reveal button", () => {
    const huge = "y".repeat(MAX_MARKDOWN_CHARS + 100);
    render(<SafeMarkdownBody>{huge}</SafeMarkdownBody>);
    fireEvent.click(screen.getByTestId("safe-md-reveal"));
    const raw = screen.getByTestId("safe-md-raw");
    expect(raw).toBeTruthy();
    expect(raw.querySelector("pre")?.textContent).toBe(huge);
  });

  it("respects the threshold prop override", () => {
    const payload = "z".repeat(50);
    render(<SafeMarkdownBody threshold={10}>{payload}</SafeMarkdownBody>);
    // 50 chars > threshold=10 → reveal button
    expect(screen.getByTestId("safe-md-reveal")).toBeTruthy();
  });

  it("formats small payloads without KB suffix", () => {
    render(<SafeMarkdownBody threshold={10}>{"a".repeat(5)}</SafeMarkdownBody>);
    // 5 chars < threshold=10 → no reveal button.
    expect(screen.queryByTestId("safe-md-reveal")).toBeNull();
  });

  it("uses i18n translator when provided", () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      key === "i18n.largeMessageReveal"
        ? `很大 — ${params?.size ?? ""}`
        : key;
    const huge = "a".repeat(MAX_MARKDOWN_CHARS + 1);
    render(
      <SafeMarkdownBody t={t as never}>{huge}</SafeMarkdownBody>,
    );
    expect(screen.getByTestId("safe-md-reveal").textContent).toContain("很大");
  });
});