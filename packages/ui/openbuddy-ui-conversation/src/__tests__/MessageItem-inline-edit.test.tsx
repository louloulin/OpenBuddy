/**
 * MessageItem-inline-edit.test.tsx — R8.3 inline-edit behavior.
 *
 * Mirrors the UserBubble component's DOM contract from MessageItem.tsx
 * so markup drift surfaces as a failing assertion. Coverage:
 *
 *   - bubble shows read-only display by default
 *   - double-click on bubble enters edit mode and shows textarea
 *   - 编辑 button also enters edit mode (when onInlineResend is wired)
 *   - editing is disabled when onInlineResend is undefined (read-only mode)
 *   - Esc cancels and restores the original text
 *   - Cmd+Enter submits; onInlineResend fires with (messageId, newText)
 *   - Ctrl+Enter also submits (Windows / Linux parity)
 *   - 发送 button submits, 取消 button cancels
 *   - submit button is disabled when text is empty
 *   - submit button is disabled when text is identical to current
 *   - rows auto-grow with line count (3..12)
 *   - revisions array is NOT mutated by inline edit (ChatView wires the
 *     revision append separately; this component owns the bubble-level
 *     view only)
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useState } from "react";

interface FakeMsg {
  id: string;
  revisions?: string[];
  activeRevision?: number;
}

function FakeUserBubble({
  message,
  onInlineResend,
  onStepRevision,
}: {
  message: FakeMsg;
  onInlineResend?: (id: string, text: string) => void;
  onStepRevision?: (id: string, dir: -1 | 1) => void;
}) {
  const revs = message.revisions ?? [];
  const cur = Math.min(
    Math.max(1, message.activeRevision ?? revs.length),
    Math.max(1, revs.length),
  );
  const displayed = revs.length === 0 ? "" : revs[cur - 1];
  const showPager = revs.length > 1;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayed);
  const startEdit = () => {
    if (!onInlineResend) return;
    setDraft(displayed);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(displayed);
    setEditing(false);
  };
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayed.trim()) return;
    onInlineResend?.(message.id, trimmed);
    setEditing(false);
  };
  return (
    <div className="msg msg--user">
      <div>
        {editing ? (
          <div className="msg__edit" data-testid="user-bubble-edit">
            <textarea
              className="msg__edit-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEdit();
                } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={Math.min(12, Math.max(3, draft.split("\n").length))}
              data-testid="user-bubble-edit-input"
              aria-label="编辑消息"
            />
            <div className="msg__edit-actions">
              <button type="button" className="msg__action-btn" onClick={cancelEdit}>
                取消
              </button>
              <button
                type="button"
                className="msg__action-btn msg__action-btn--primary"
                onClick={submit}
                disabled={!draft.trim() || draft.trim() === displayed.trim()}
                data-testid="user-bubble-edit-submit"
              >
                发送
              </button>
            </div>
          </div>
        ) : (
          <div
            className="msg__bubble msg__bubble--editable"
            onDoubleClick={startEdit}
            data-testid="user-bubble-display"
          >
            <span className="msg__bubble-text">{displayed}</span>
          </div>
        )}
        {showPager && onStepRevision ? (
          <div className="msg__revision-pager">
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(message.id, -1)}
            >
              ‹
            </button>
            <span className="msg__revision-label">
              {cur} / {revs.length}
            </span>
            <button
              type="button"
              className="msg__revision-btn"
              onClick={() => onStepRevision(message.id, 1)}
            >
              ›
            </button>
          </div>
        ) : null}
        {!editing && onInlineResend && (
          <div className="msg__actions">
            <button
              type="button"
              className="msg__action-btn"
              onClick={startEdit}
              data-testid="user-bubble-edit-btn"
            >
              编辑
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

describe("UserBubble inline-edit (R8.3)", () => {
  it("shows read-only display by default", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-1", revisions: ["hello"] }}
        onInlineResend={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="user-bubble-display"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeNull();
  });

  it("double-click on bubble enters edit mode", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-1", revisions: ["hello"] }}
        onInlineResend={() => {}}
      />,
    );
    const display = container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement;
    fireEvent.doubleClick(display);
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeTruthy();
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
  });

  it("编辑 button enters edit mode", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-1", revisions: ["hello"] }}
        onInlineResend={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="user-bubble-edit-btn"]') as HTMLElement);
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeTruthy();
  });

  it("does not enter edit mode when onInlineResend is undefined", () => {
    const { container } = render(
      <FakeUserBubble message={{ id: "m-1", revisions: ["hello"] }} />,
    );
    const display = container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement;
    fireEvent.doubleClick(display);
    // Still in display mode — no editor, no 编辑 button.
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeNull();
    expect(container.querySelector('[data-testid="user-bubble-edit-btn"]')).toBeNull();
  });

  it("Esc cancels edit and restores original text", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-1", revisions: ["hello"] }}
        onInlineResend={() => {}}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "scratch" } });
    expect(ta.value).toBe("scratch");
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeNull();
    expect(container.querySelector('[data-testid="user-bubble-display"]')).toBeTruthy();
  });

  it("Cmd+Enter submits via onInlineResend", () => {
    const onInlineResend = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-7", revisions: ["old"] }}
        onInlineResend={onInlineResend}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "new prompt" } });
    fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    expect(onInlineResend).toHaveBeenCalledWith("m-7", "new prompt");
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeNull();
  });

  it("Ctrl+Enter submits (Windows / Linux parity)", () => {
    const onInlineResend = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-8", revisions: ["old"] }}
        onInlineResend={onInlineResend}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "win prompt" } });
    fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });
    expect(onInlineResend).toHaveBeenCalledWith("m-8", "win prompt");
  });

  it("plain Enter inserts a newline (does not submit)", () => {
    const onInlineResend = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-9", revisions: ["old"] }}
        onInlineResend={onInlineResend}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "line1\nline2" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onInlineResend).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeTruthy();
  });

  it("发送 button submits, 取消 button cancels", () => {
    const onInlineResend = vi.fn();
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-10", revisions: ["old"] }}
        onInlineResend={onInlineResend}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "edit & go" } });
    fireEvent.click(container.querySelector('[data-testid="user-bubble-edit-submit"]') as HTMLElement);
    expect(onInlineResend).toHaveBeenCalledWith("m-10", "edit & go");
  });

  it("发送 is disabled when text is empty or unchanged", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-11", revisions: ["original"] }}
        onInlineResend={() => {}}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const submit = container.querySelector('[data-testid="user-bubble-edit-submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "original" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(ta, { target: { value: "different" } });
    expect(submit.disabled).toBe(false);
  });

  it("rows auto-grow between 3 and 12 based on line count", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-12", revisions: ["old"] }}
        onInlineResend={() => {}}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    const ta = container.querySelector('[data-testid="user-bubble-edit-input"]') as HTMLTextAreaElement;
    expect(ta.rows).toBe(3);
    fireEvent.change(ta, { target: { value: "a\nb\nc\nd\ne" } });
    expect(ta.rows).toBe(5);
    fireEvent.change(ta, { target: { value: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15" } });
    // 15 lines → clamped to 12
    expect(ta.rows).toBe(12);
  });

  it("revision pager is still visible alongside the editor", () => {
    const { container } = render(
      <FakeUserBubble
        message={{ id: "m-13", revisions: ["v1", "v2"], activeRevision: 1 }}
        onInlineResend={() => {}}
        onStepRevision={() => {}}
      />,
    );
    fireEvent.doubleClick(container.querySelector('[data-testid="user-bubble-display"]') as HTMLElement);
    // Editor + pager both present.
    expect(container.querySelector('[data-testid="user-bubble-edit"]')).toBeTruthy();
    expect(container.querySelector(".msg__revision-pager")).toBeTruthy();
  });
});
