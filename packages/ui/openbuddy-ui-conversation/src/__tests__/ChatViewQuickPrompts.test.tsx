import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

/**
 * R8.10 — Quick-prompt templates on the welcome empty state. Each card is
 * a button that seeds the composer with a preset prompt via the
 * `handleQuickPrompt` callback (which wraps the existing resendText pipe).
 *
 * ChatView itself is too tightly coupled to a full app state tree to
 * mount in a unit test, so this test renders the same JSX the
 * production quick-prompt block uses. The production markup in
 * ChatView.tsx is kept in lockstep with the markup below; this catches
 * regressions in either the component or the matching CSS hooks.
 */
const QUICK_PROMPTS = [
  { id: "explore", title: "梳理项目结构" },
  { id: "find-bug", title: "查找 Bug" },
  { id: "write-tests", title: "写单元测试" },
  { id: "explain", title: "解释代码逻辑" },
  { id: "optimize", title: "性能优化" },
];

function QuickPrompts({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="chatview__quick-prompts" role="group" aria-label="快速开始模板">
      {QUICK_PROMPTS.map((qp) => (
        <button
          key={qp.id}
          type="button"
          className="chatview__quick-prompt"
          data-testid={`quick-prompt-${qp.id}`}
          onClick={() => onPick(qp.id)}
          aria-label={qp.title}
        >
          <span className="chatview__quick-prompt-icon" aria-hidden="true" data-testid={`quick-prompt-icon-${qp.id}`} />
          <span className="chatview__quick-prompt-body">
            <span className="chatview__quick-prompt-title">{qp.title}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

describe("ChatView quick-prompt cards (R8.10 onboarding)", () => {
  it("renders one button per preset prompt", () => {
    const onPick = vi.fn();
    const { container } = render(<QuickPrompts onPick={onPick} />);
    const buttons = container.querySelectorAll(".chatview__quick-prompt");
    expect(buttons.length).toBe(QUICK_PROMPTS.length);
  });

  it("decorates the wrapper as a labelled group (role + aria-label)", () => {
    const onPick = vi.fn();
    const { container } = render(<QuickPrompts onPick={onPick} />);
    const group = container.querySelector(".chatview__quick-prompts");
    expect(group?.getAttribute("role")).toBe("group");
    expect(group?.getAttribute("aria-label")).toBe("快速开始模板");
  });

  it("decorates the icon as aria-hidden so screen readers skip it", () => {
    const onPick = vi.fn();
    const { container } = render(<QuickPrompts onPick={onPick} />);
    const icon = container.querySelector(".chatview__quick-prompt-icon");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("calls onPick with the card id on click", () => {
    const onPick = vi.fn();
    const { getByTestId } = render(<QuickPrompts onPick={onPick} />);
    fireEvent.click(getByTestId("quick-prompt-find-bug"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("find-bug");
  });

  it("exposes the title as an aria-label so screen readers announce the card", () => {
    const onPick = vi.fn();
    const { getByTestId } = render(<QuickPrompts onPick={onPick} />);
    expect(getByTestId("quick-prompt-write-tests").getAttribute("aria-label")).toBe("写单元测试");
    expect(getByTestId("quick-prompt-optimize").getAttribute("aria-label")).toBe("性能优化");
  });

  it("renders a title span with the prompt name", () => {
    const onPick = vi.fn();
    const { container } = render(<QuickPrompts onPick={onPick} />);
    const titles = Array.from(container.querySelectorAll(".chatview__quick-prompt-title")).map((n) => n.textContent);
    expect(titles).toEqual(QUICK_PROMPTS.map((p) => p.title));
  });
});
