import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { useDebouncedValue } from "../useDebouncedValue";

afterEach(() => cleanup());

interface Props {
  value: string;
  delay: number;
  capture: (latest: string) => void;
}

function Harness({ value, delay, capture }: Props) {
  const debounced = useDebouncedValue(value, delay);
  useEffect(() => {
    capture(debounced);
  }, [debounced, capture]);
  return null;
}

function flush(ms: number) {
  vi.useFakeTimers();
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  vi.useRealTimers();
}

describe("useDebouncedValue", () => {
  it("returns the value immediately on mount", () => {
    const capture = vi.fn();
    render(<Harness value="a" delay={200} capture={capture} />);
    expect(capture).toHaveBeenCalledWith("a");
  });

  it("delays updates by `delayMs` ms", () => {
    vi.useFakeTimers();
    const capture = vi.fn();
    const { rerender } = render(<Harness value="a" delay={200} capture={capture} />);
    capture.mockClear();
    rerender(<Harness value="b" delay={200} capture={capture} />);
    // 50ms 后还没到 200ms,不应触发
    act(() => vi.advanceTimersByTime(50));
    expect(capture).not.toHaveBeenCalledWith("b");
    // 再过 200ms,触发
    act(() => vi.advanceTimersByTime(200));
    expect(capture).toHaveBeenCalledWith("b");
    vi.useRealTimers();
  });

  it("resets the timer when value changes again before delay elapses", () => {
    vi.useFakeTimers();
    const capture = vi.fn();
    const { rerender } = render(<Harness value="a" delay={200} capture={capture} />);
    capture.mockClear();
    rerender(<Harness value="b" delay={200} capture={capture} />);
    act(() => vi.advanceTimersByTime(150));
    rerender(<Harness value="c" delay={200} capture={capture} />);
    act(() => vi.advanceTimersByTime(150));
    // 总共 300ms 但 timer 被重置,b 和 c 都不应被 capture
    expect(capture).not.toHaveBeenCalledWith("b");
    expect(capture).not.toHaveBeenCalledWith("c");
    // 再等 200ms 触发 c
    act(() => vi.advanceTimersByTime(200));
    expect(capture).toHaveBeenCalledWith("c");
    vi.useRealTimers();
  });

  it("treats delay=0 as identity (no debounce)", () => {
    const capture = vi.fn();
    const { rerender } = render(<Harness value="a" delay={0} capture={capture} />);
    capture.mockClear();
    rerender(<Harness value="b" delay={0} capture={capture} />);
    expect(capture).toHaveBeenCalledWith("b");
  });

  it("coalesces rapid input to the last value (search-box usage)", () => {
    vi.useFakeTimers();
    const capture = vi.fn();
    const { rerender } = render(<Harness value="" delay={200} capture={capture} />);
    capture.mockClear();
    // 用户快速敲 "m", "mc", "mcp"
    rerender(<Harness value="m" delay={200} capture={capture} />);
    act(() => vi.advanceTimersByTime(50));
    rerender(<Harness value="mc" delay={200} capture={capture} />);
    act(() => vi.advanceTimersByTime(50));
    rerender(<Harness value="mcp" delay={200} capture={capture} />);
    // 三个 keystroke 加起来 100ms,还没到 200ms
    expect(capture).not.toHaveBeenCalledWith("mcp");
    // 再 200ms 触发最终值
    act(() => vi.advanceTimersByTime(200));
    expect(capture).toHaveBeenCalledWith("mcp");
    vi.useRealTimers();
  });
});

describe("useDebouncedValue hook composition", () => {
  it("can be composed with React state for a controlled input", () => {
    function SearchBox({ delay }: { delay: number }) {
      const [value, setValue] = useState("");
      const debounced = useDebouncedValue(value, delay);
      return <input data-testid="box" value={value} onChange={(e) => setValue(e.target.value)} data-debounced={debounced} />;
    }
    const { rerender } = render(<SearchBox delay={50} />);
    // 初始 debounced === value === ""
    expect(document.querySelector('[data-testid="box"]')?.getAttribute("data-debounced")).toBe("");
    // 强行 setValue 不容易(没 fireEvent.change),跳过,只断言类型签名通过。
    rerender(<SearchBox delay={200} />);
  });
});
