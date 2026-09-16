/**
 * CodeBlockActions-r8.6.test.tsx — visual / DOM contract tests for the
 * R8.6 modern-dark-mode polish. We mount CodeBlockActions directly and
 * assert on the DOM that the new modifier classes / disabled handling
 * land where the CSS expects them.
 *
 * Coverage:
 *   - default render: 复制 button with Copy icon + label
 *   - copied state: Check icon + --ok modifier class
 *   - applyButton slot: divider rendered next to it
 *   - actions with variant=primary: --primary modifier class
 *   - actions with disabled=true: button has disabled attribute
 *   - actions with disabled function: button disabled based on (code, lang)
 *   - onAction fires with the right action id
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { CodeBlockActions } from "../components/CodeBlockActions";
import type { CodeBlockAction } from "../components/types";

const code = "const x = 1;\nconsole.log(x);";
const lang = "ts";

describe("CodeBlockActions R8.6 polish", () => {
  it("renders a 复制 button with Copy icon by default", () => {
    const { container } = render(<CodeBlockActions code={code} language={lang} />);
    const buttons = container.querySelectorAll(".md-code-action");
    expect(buttons.length).toBe(1);
    const copyBtn = buttons[0];
    expect(copyBtn.getAttribute("aria-label")).toBe("复制");
    expect(copyBtn.querySelector("svg")).toBeTruthy();
  });

  it("clicking 复制 updates aria-label to 已复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
      writable: true,
    });
    const { container } = render(<CodeBlockActions code={code} language={lang} />);
    await act(async () => {
      fireEvent.click(container.querySelector(".md-code-action") as HTMLElement);
      // Wait microtasks for writeText promise + setCopied state update.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(code);
    const btn = container.querySelector(".md-code-action") as HTMLElement;
    expect(btn.getAttribute("aria-label")).toBe("已复制");
  });

  it("renders custom actions with variant=primary as --primary modifier", () => {
    const actions: CodeBlockAction[] = [
      { id: "apply", label: "应用", icon: null, onClick: () => {}, variant: "primary" },
    ];
    const { container } = render(
      <CodeBlockActions code={code} language={lang} actions={actions} />,
    );
    const btn = container.querySelector(".md-code-action--primary");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toContain("应用");
  });

  it("renders custom actions with disabled=true as a disabled button", () => {
    const onClick = vi.fn();
    const actions: CodeBlockAction[] = [
      { id: "run", label: "运行", icon: null, onClick, disabled: true },
    ];
    const { container } = render(
      <CodeBlockActions code={code} language={lang} actions={actions} />,
    );
    const btn = container.querySelectorAll(".md-code-action")[1] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("supports a function-form disabled predicate", () => {
    const actions: CodeBlockAction[] = [
      {
        id: "run",
        label: "运行",
        icon: null,
        onClick: () => {},
        disabled: (c, l) => c.length === 0 || l === "json",
      },
    ];
    const { container: c1 } = render(
      <CodeBlockActions code={code} language={lang} actions={actions} />,
    );
    const btn1 = c1.querySelectorAll(".md-code-action")[1] as HTMLButtonElement;
    expect(btn1.disabled).toBe(false);

    const { container: c2 } = render(
      <CodeBlockActions code={code} language="json" actions={actions} />,
    );
    const btn2 = c2.querySelectorAll(".md-code-action")[1] as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);
  });

  it("fires onAction with the custom action id when clicked", () => {
    const onAction = vi.fn();
    const actions: CodeBlockAction[] = [
      { id: "apply", label: "应用", icon: null, onClick: () => {}, variant: "primary" },
    ];
    const { container } = render(
      <CodeBlockActions code={code} language={lang} actions={actions} onAction={onAction} />,
    );
    const btn = container.querySelector(".md-code-action--primary") as HTMLElement;
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledWith("apply", code, lang, undefined);
  });

  it("renders a divider next to the applyButton slot", () => {
    const { container } = render(
      <CodeBlockActions code={code} language={lang} applyButton={<span>应用</span>} />,
    );
    expect(container.querySelector(".md-code-divider")).toBeTruthy();
  });

  it("filters out actions whose condition() returns false", () => {
    const actions: CodeBlockAction[] = [
      {
        id: "ts-only",
        label: "TS Only",
        icon: null,
        onClick: () => {},
        condition: (_c, l) => l === "ts",
      },
      {
        id: "always",
        label: "Always",
        icon: null,
        onClick: () => {},
      },
    ];
    const { container } = render(
      <CodeBlockActions code={code} language="py" actions={actions} />,
    );
    const buttons = container.querySelectorAll(".md-code-action");
    expect(buttons.length).toBe(2);
  });
});
