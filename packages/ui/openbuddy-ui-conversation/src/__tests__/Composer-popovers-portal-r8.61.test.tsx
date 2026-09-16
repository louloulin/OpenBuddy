/**
 * R8.61 - Chat-input autocomplete popovers must render OUTSIDE the composer
 * so they are never clipped by `.wb-composer`'s `overflow: hidden` and
 * never covered by the composer footer toolbar (+/skills/file row).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MentionPicker } from "../MentionPicker";

function MentionPickerProbe(props: { anchorRect?: DOMRect | null; open?: boolean }) {
  return (
    <div className="wb-composer">
      <textarea className="wb-composer__input" rows={1} defaultValue="@" />
      <MentionPicker
        open={props.open ?? true}
        query=""
        cwd="/tmp"
        anchorRect={props.anchorRect ?? null}
        onSelect={() => {}}
        onDismiss={() => {}}
      />
    </div>
  );
}

describe("R8.61 MentionPicker portal positioning", () => {
  it("renders outside .wb-composer (to document.body) so overflow:hidden cannot clip it", () => {
    const { container } = render(<MentionPickerProbe />);
    const composer = container.querySelector(".wb-composer");
    expect(composer).toBeTruthy();
    const picker = document.querySelector(".mention-picker");
    expect(picker).toBeTruthy();
    expect(composer!.contains(picker)).toBe(false);
    expect(document.body.contains(picker)).toBe(true);
  });

  it("uses position: fixed with z-index >= 1000 anchored from DOMRect", () => {
    const rect = new DOMRect(120, 480, 600, 40);
    render(<MentionPickerProbe anchorRect={rect} />);
    const picker = document.querySelector(".mention-picker") as HTMLElement;
    expect(picker).toBeTruthy();
    const s = picker.style;
    expect(s.position).toBe("fixed");
    expect(Number.parseInt(s.zIndex, 10)).toBeGreaterThanOrEqual(1000);
    expect(s.top).toBe(`${rect.top - 340}px`);
    expect(s.left).toBe(`${rect.left}px`);
  });

  it("hides itself when anchorRect is null", () => {
    render(<MentionPickerProbe anchorRect={null} open={true} />);
    const picker = document.querySelector(".mention-picker") as HTMLElement;
    expect(picker).toBeTruthy();
    expect(picker.style.display).toBe("none");
  });
});
