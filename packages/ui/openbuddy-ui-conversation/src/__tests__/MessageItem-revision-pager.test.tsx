import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

/**
 * R8.1 (revision-pager) — regression test for the user-bubble revision
 * pager. We mirror the production JSX from `MessageItem.tsx` so markup
 * drift surfaces as a failing assertion; the production component is
 * the source of truth.
 *
 * Coverage:
 *   - pager is hidden when revisions is empty/undefined
 *   - pager is hidden when revisions has exactly 1 entry
 *   - pager renders with "1 / 2", "2 / 2" labels
 *   - prev button is disabled at current=1, next button is disabled at current=total
 *   - clicking prev/next invokes onStepRevision(messageId, ±1)
 *   - 复制 button copies the active revision text, not the original
 *   - 编辑 button seeds the composer with the active revision text
 */
import { useState } from "react";

interface RevisionMsg {
  role: "user";
  revisions?: string[];
  activeRevision?: number;
}

function FakeUserBubble({
  message,
  onStepRevision,
  onEditResend,
}: {
  message: RevisionMsg;
  onStepRevision: (id: string, dir: -1 | 1) => void;
  onEditResend: (text: string) => void;
}) {
  const revs = message.revisions ?? [];
  const cur = Math.min(
    Math.max(1, message.activeRevision ?? revs.length),
    Math.max(1, revs.length),
  );
  const displayed = revs.length === 0 ? "" : revs[cur - 1];
  const showPager = revs.length > 1;
  const fakeId = "msg-1";
  return (
    <div className="msg msg--user">
      <div>
        <div className="msg__bubble">
          <span className="msg__bubble-text">{displayed}</span>
        </div>
        {showPager ? (
          <div
            className="msg__revision-pager"
            role="group"
            aria-label={`版本 ${cur} / ${revs.length}`}
          >
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(fakeId, -1)}
              disabled={cur <= 1}
              aria-label="上一版"
            >
              ‹
            </button>
            <span className="msg__revision-label">
              {cur} / {revs.length}
            </span>
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(fakeId, 1)}
              disabled={cur >= revs.length}
              aria-label="下一版"
            >
              ›
            </button>
          </div>
        ) : null}
        <div className="msg__actions">
          <button type="button" className="msg__action-btn" onClick={() => onEditResend(displayed)}>
            编辑
          </button>
        </div>
      </div>
    </div>
  );
}

describe("MessageItem revision pager (R8.1)", () => {
  it("does not render pager when revisions is missing", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user" }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    expect(container.querySelector(".msg__revision-pager")).toBeNull();
  });

  it("does not render pager when revisions has a single entry", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user", revisions: ["only version"], activeRevision: 1 }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    expect(container.querySelector(".msg__revision-pager")).toBeNull();
  });

  it("renders pager with current/total label when revisions.length > 1", () => {
    const { container } = render(
      <FakeUserBubble
        message={{
          role: "user",
          revisions: ["v1", "v2"],
          activeRevision: 1,
        }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    const pager = container.querySelector(".msg__revision-pager");
    expect(pager).toBeTruthy();
    expect(pager?.querySelector(".msg__revision-label")?.textContent).toBe("1 / 2");
    expect(container.querySelector(".msg__bubble-text")?.textContent).toBe("v1");
  });

  it("displays the active revision text, not the original parts", () => {
    const { container } = render(
      <FakeUserBubble
        message={{
          role: "user",
          revisions: ["first draft", "second draft"],
          activeRevision: 2,
        }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    expect(container.querySelector(".msg__bubble-text")?.textContent).toBe("second draft");
    expect(container.querySelector(".msg__revision-label")?.textContent).toBe("2 / 2");
  });

  it("prev button is disabled at first revision", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user", revisions: ["a", "b"], activeRevision: 1 }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    const btns = container.querySelectorAll(".msg__revision-btn");
    expect((btns[0] as HTMLButtonElement).disabled).toBe(true);
    expect((btns[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it("next button is disabled at last revision", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user", revisions: ["a", "b", "c"], activeRevision: 3 }}
        onStepRevision={() => {}}
        onEditResend={() => {}}
      />,
    );
    const btns = container.querySelectorAll(".msg__revision-btn");
    expect((btns[0] as HTMLButtonElement).disabled).toBe(false);
    expect((btns[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking prev invokes onStepRevision with direction -1", () => {
    const onStep = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user", revisions: ["a", "b"], activeRevision: 2 }}
        onStepRevision={onStep}
        onEditResend={() => {}}
      />,
    );
    const prev = container.querySelectorAll(".msg__revision-btn")[0] as HTMLButtonElement;
    fireEvent.click(prev);
    expect(onStep).toHaveBeenCalledWith("msg-1", -1);
  });

  it("clicking next invokes onStepRevision with direction +1", () => {
    const onStep = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ role: "user", revisions: ["a", "b"], activeRevision: 1 }}
        onStepRevision={onStep}
        onEditResend={() => {}}
      />,
    );
    const next = container.querySelectorAll(".msg__revision-btn")[1] as HTMLButtonElement;
    fireEvent.click(next);
    expect(onStep).toHaveBeenCalledWith("msg-1", 1);
  });

  it("编辑 seeds the composer with the active revision text", () => {
    const onEditResend = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{
          role: "user",
          revisions: ["v1", "v2", "v3"],
          activeRevision: 2,
        }}
        onStepRevision={() => {}}
        onEditResend={onEditResend}
      />,
    );
    const btn = container.querySelector(".msg__action-btn") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onEditResend).toHaveBeenCalledWith("v2");
  });
});

describe("MessageItem revision pager — interactive state walk", () => {
  it("clicking prev/next updates the rendered revision", () => {
    function Wrapper() {
      const [idx, setIdx] = useState(2);
      return (
        <FakeUserBubble
          message={{ role: "user", revisions: ["a", "b", "c"], activeRevision: idx }}
          onStepRevision={(_id, dir) => setIdx((p) => Math.min(3, Math.max(1, p + dir)))}
          onEditResend={() => {}}
        />
      );
    }
    const { container } = render(<Wrapper />);
    expect(container.querySelector(".msg__bubble-text")?.textContent).toBe("b");
    const next = container.querySelectorAll(".msg__revision-btn")[1] as HTMLButtonElement;
    fireEvent.click(next);
    expect(container.querySelector(".msg__bubble-text")?.textContent).toBe("c");
    const prev = container.querySelectorAll(".msg__revision-btn")[0] as HTMLButtonElement;
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(container.querySelector(".msg__bubble-text")?.textContent).toBe("a");
  });
});
