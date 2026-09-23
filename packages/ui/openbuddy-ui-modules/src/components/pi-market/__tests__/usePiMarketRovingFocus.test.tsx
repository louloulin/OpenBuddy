import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { usePiMarketRovingFocus } from "../usePiMarketRovingFocus";

afterEach(() => cleanup());

interface Row {
  id: string;
  repoUrl?: string;
  npmUrl?: string;
  installCommand?: string;
}

const ROWS: Row[] = [
  { id: "a", repoUrl: "https://github.com/a/a", npmUrl: "https://npmjs.com/a", installCommand: "pi install a" },
  { id: "b", repoUrl: "https://github.com/b/b", npmUrl: "https://npmjs.com/b", installCommand: "pi install b" },
  { id: "c", repoUrl: "https://github.com/c/c", npmUrl: "https://npmjs.com/c", installCommand: "pi install c" },
];

function fireKey(target: EventTarget, key: string, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

interface HarnessProps {
  rows: Row[];
  onActivate?: (entry: Row) => void;
  onCopy?: (entry: Row) => void;
  onOpenLink?: (entry: Row, url: string) => void;
  enabled?: boolean;
  onReady?: (api: ReturnType<typeof usePiMarketRovingFocus<Row>>) => void;
}

function Harness({ rows, onActivate, onCopy, onOpenLink, enabled, onReady }: HarnessProps) {
  const api = usePiMarketRovingFocus({
    entries: rows,
    enabled,
    onActivate,
    onCopy,
    onOpenLink,
  });
  if (onReady) onReady(api);
  return (
    <div ref={api.containerRef as React.RefObject<HTMLDivElement>}>
      {rows.map((row) => (
        <article key={row.id} data-row-id={row.id} ref={api.registerCard(row.id)} />
      ))}
    </div>
  );
}

describe("usePiMarketRovingFocus", () => {
  it("j moves active down (none → first → next → ...)", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "j");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBe("b");
  });

  it("k moves active up (j then k should land on a)", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "k");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBe("a");
  });

  it("ArrowDown / ArrowUp map to j / k", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    // ArrowDown 两次:null → a → b
    fireKey(window, "ArrowDown");
    fireKey(window, "ArrowDown");
    {
      const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
      expect(api.activeId).toBe("b");
    }
    // ArrowUp 一次:b → a
    fireKey(window, "ArrowUp");
    {
      const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
      expect(api.activeId).toBe("a");
    }
  });

  it("Home jumps to first, End jumps to last", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    fireKey(window, "End");
    fireKey(window, "Home");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBe("a");
  });

  it("Enter triggers onActivate for the active row", () => {
    const onActivate = vi.fn();
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onActivate={onActivate} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "Enter");
    expect(onActivate).toHaveBeenCalledWith(ROWS[0]);
  });

  it("c triggers onCopy for the active row", () => {
    const onCopy = vi.fn();
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onCopy={onCopy} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "j");
    fireKey(window, "c");
    expect(onCopy).toHaveBeenCalledWith(ROWS[1]);
  });

  it("o triggers onOpenLink with repoUrl first, npmUrl fallback", () => {
    const onOpenLink = vi.fn();
    const onReady = vi.fn();
    const rows: Row[] = [
      { id: "x", repoUrl: "https://r", installCommand: "x" },
      { id: "y", npmUrl: "https://n", installCommand: "y" },
      { id: "z", installCommand: "z" },
    ];
    render(<Harness rows={rows} onOpenLink={onOpenLink} onReady={onReady} />);
    // x: 先 j 激活,再 o
    fireKey(window, "j");
    fireKey(window, "o");
    expect(onOpenLink).toHaveBeenLastCalledWith(rows[0], "https://r");
    // y: 再 j → active=y,再 o
    fireKey(window, "j");
    fireKey(window, "o");
    expect(onOpenLink).toHaveBeenLastCalledWith(rows[1], "https://n");
    // z has no link — onOpenLink should NOT be called
    fireKey(window, "j");
    const beforeCalls = onOpenLink.mock.calls.length;
    fireKey(window, "o");
    expect(onOpenLink.mock.calls.length).toBe(beforeCalls);
  });

  it("ignores keys when target is INPUT / TEXTAREA / contenteditable", () => {
    const onReady = vi.fn();
    const { container } = render(
      <div>
        <Harness rows={ROWS} onReady={onReady} />
        <input data-testid="host-input" />
      </div>,
    );
    const input = container.querySelector('[data-testid="host-input"]') as HTMLInputElement;
    fireKey(input, "j");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBeNull();
  });

  it("ignores keys when modifier keys are pressed", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    fireKey(window, "j", { metaKey: true });
    fireKey(window, "j", { ctrlKey: true });
    fireKey(window, "j", { altKey: true });
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBeNull();
  });

  it("drops activeId when the active row disappears from entries", () => {
    const onReady = vi.fn();
    const { rerender } = render(<Harness rows={ROWS} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "j");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBe("b");
    rerender(<Harness rows={[ROWS[0]]} onReady={onReady} />);
    const api2 = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api2.activeId).toBeNull();
  });

  it("clamps activeId movement at the bounds", () => {
    const onReady = vi.fn();
    render(<Harness rows={ROWS} onReady={onReady} />);
    // 没有 active,j → 0
    fireKey(window, "j");
    // k → 不该变负,clamp 到 0
    fireKey(window, "k");
    fireKey(window, "k");
    const api = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api.activeId).toBe("a");
    // End → 最后
    fireKey(window, "End");
    // j → clamp 到最后
    fireKey(window, "j");
    const api2 = onReady.mock.calls.at(-1)?.[0] as ReturnType<typeof usePiMarketRovingFocus<Row>>;
    expect(api2.activeId).toBe("c");
  });

  it("does nothing when entries list is empty", () => {
    const onActivate = vi.fn();
    const onReady = vi.fn();
    render(<Harness rows={[]} onActivate={onActivate} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "Enter");
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("disabled (enabled=false) prevents all key handling", () => {
    const onActivate = vi.fn();
    const onReady = vi.fn();
    render(<Harness rows={ROWS} enabled={false} onActivate={onActivate} onReady={onReady} />);
    fireKey(window, "j");
    fireKey(window, "Enter");
    expect(onActivate).not.toHaveBeenCalled();
  });
});
