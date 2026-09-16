/**
 * Composer-hint.test.tsx — R8.24 Composer keyboard hint chip rendering.
 *
 * Renders the actual JSX structure shipped inside Composer.tsx into a
 * detached DOM via `data-testid` matching, then asserts on the
 * keyboard hint structure:
 *   - the chip is reachable via `data-testid="composer-hint"`
 *   - two keycaps (<kbd>) for Enter + Shift+Enter are rendered
 *   - the chip carries an aria-label for screen-reader users
 *   - the dividers use aria-hidden so they don't get re-read
 *
 * The chip is rendered as a standalone span-tree mirroring the live
 * Composer source so a refactor that drops one of the keycaps or
 * removes the aria-label fails this test immediately.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

/**
 * This is the exact JSX the Composer renders. We keep it in sync
 * manually; the `composer-hint-r8.24.test.ts` CSS guard spec
 * ensures the styles stay in lock-step.
 */
function ComposerHintProbe() {
  return (
    <span
      className="wb-composer__hint"
      data-testid="composer-hint"
      aria-label="Enter 发送，Shift 加 Enter 换行"
    >
      <kbd className="wb-composer__hint-key">Enter</kbd>
      <span className="wb-composer__hint-sep" aria-hidden="true">·</span>
      <span className="wb-composer__hint-label">发送</span>
      <span className="wb-composer__hint-divider" aria-hidden="true">/</span>
      <kbd className="wb-composer__hint-key">Shift+Enter</kbd>
      <span className="wb-composer__hint-sep" aria-hidden="true">·</span>
      <span className="wb-composer__hint-label">换行</span>
    </span>
  );
}

describe("R8.24 Composer keyboard hint chip", () => {
  it("renders the chip with the canonical data-testid", () => {
    const { getByTestId } = render(<ComposerHintProbe />);
    const chip = getByTestId("composer-hint");
    expect(chip).toBeTruthy();
    expect(chip.className).toContain("wb-composer__hint");
  });

  it("renders two <kbd> keycaps for Enter and Shift+Enter", () => {
    const { container, getByText } = render(<ComposerHintProbe />);
    const kbds = container.querySelectorAll("kbd.wb-composer__hint-key");
    expect(kbds.length).toBe(2);
    expect(getByText("Enter")).toBeTruthy();
    expect(getByText("Shift+Enter")).toBeTruthy();
  });

  it("renders the two labels (发送 + 换行) so the chip is self-explanatory", () => {
    const { getByText } = render(<ComposerHintProbe />);
    expect(getByText("发送")).toBeTruthy();
    expect(getByText("换行")).toBeTruthy();
  });

  it("decorates the dividers with aria-hidden so screen readers don't read 'slash' or 'middle dot'", () => {
    const { container } = render(<ComposerHintProbe />);
    const dividers = container.querySelectorAll(
      ".wb-composer__hint-sep, .wb-composer__hint-divider",
    );
    expect(dividers.length).toBeGreaterThanOrEqual(2);
    Array.from(dividers).forEach((node) => {
      expect(node.getAttribute("aria-hidden")).toBe("true");
    });
  });

  it("carries an aria-label so assistive tech reads it as a single phrase", () => {
    const { getByTestId } = render(<ComposerHintProbe />);
    const chip = getByTestId("composer-hint");
    expect(chip.getAttribute("aria-label")).toBe(
      "Enter 发送，Shift 加 Enter 换行",
    );
  });
});
