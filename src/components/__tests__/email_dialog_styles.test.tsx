import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ConfirmDialog } from "@openbuddy/ui-dialogs";
import { PromptDialog } from "@openbuddy/ui-dialogs";
import { ModalIcon } from "@openbuddy/ui-dialogs";

/**
 * Style contract: every dialog surface must use the workbuddy-style class
 * hierarchy so the workbuddy CSS in `src/styles/app.css` applies the modern
 * gradient + shadow + tone-aware styling.
 */
describe("Email dialog styles (workbuddy design system)", () => {
  it("ConfirmDialog uses request-modal CSS hook", () => {
    const { container } = render(
      <ConfirmDialog open title="移入垃圾箱" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const modal = container.querySelector(".request-modal");
    expect(modal).toBeTruthy();
    expect(modal?.className).toMatch(/request-modal--confirm/);
  });

  it("ConfirmDialog applies tone modifier (info / warning / danger)", () => {
    const cases: Array<["info" | "warning" | "danger", string]> = [
      ["info", "request-modal--info"],
      ["warning", "request-modal--warning"],
      ["danger", "request-modal--danger"],
    ];
    for (const [tone, expectedClass] of cases) {
      const { container } = render(
        <ConfirmDialog open title="t" tone={tone} onConfirm={() => {}} onCancel={() => {}} />,
      );
      const modal = container.querySelector(".request-modal");
      expect(modal?.className, `tone=${tone}`).toContain(expectedClass);
    }
  });

  it("PromptDialog uses request-modal--prompt CSS hook with input/textarea", () => {
    const { container } = render(
      <PromptDialog open title="添加标签" placeholder="重要客户" onConfirm={() => {}} onCancel={() => {}} />,
    );
    const modal = container.querySelector(".request-modal--prompt");
    expect(modal).toBeTruthy();
    const input = container.querySelector("input.request-modal__input");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement)?.placeholder).toBe("重要客户");
  });

  it("ModalIcon uses SVG (no raw ?/! characters)", () => {
    const { container } = render(<ModalIcon tone="danger" />);
    const html = container.innerHTML;
    // Must be SVG, not character glyphs
    expect(html).toContain("<svg");
    // Triangular shape marker (only danger/warning tones)
    expect(html).toMatch(/M12 3 L22 20 L2 20 Z/);
    // No raw question-mark or exclamation glyph (workbuddy uses SVG icons, not text)
    expect(html).not.toMatch(/^\?|>\?</);
  });

  it("ConfirmDialog buttons use btn--primary / btn--danger classes", () => {
    const { container: c1 } = render(
      <ConfirmDialog open title="t" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(c1.querySelector("button.btn--primary")).toBeTruthy();

    const { container: c2 } = render(
      <ConfirmDialog open title="t" tone="danger" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(c2.querySelector("button.btn--danger")).toBeTruthy();
  });

  it("Dialog aria roles match workbuddy a11y expectations", () => {
    const { container: c1 } = render(
      <ConfirmDialog open title="移入垃圾箱" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(c1.querySelector('[role="alertdialog"]')).toBeTruthy();

    const { container: c2 } = render(
      <PromptDialog open title="添加标签" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(c2.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("Dialog has eyebrow + title layout (workbuddy-style hierarchy)", () => {
    const { container } = render(
      <ConfirmDialog open title="移入垃圾箱" tone="danger" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.querySelector(".request-modal__eyebrow")).toBeTruthy();
    expect(container.querySelector(".request-modal__title")?.textContent).toBe("移入垃圾箱");
  });

  it("PromptDialog hint/error renders inline beneath the input", () => {
    const { container } = render(
      <PromptDialog
        open
        title="t"
        hint="提示：标签会同步到你的邮箱账户"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector(".request-modal__hint-inline")?.textContent).toBe("提示：标签会同步到你的邮箱账户");
  });
});
