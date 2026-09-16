import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Resizable, clampWidth } from "../components/Resizable";

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => cleanup());

function pointerEvent(type: string, clientX: number, pointerId = 1) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX, pointerId });
  return ev;
}

describe("@openbuddy/ui-primitives/Resizable", () => {
  it("renders the handle with separator semantics and aria bounds", () => {
    render(
      <Resizable min={200} max={400} defaultWidth={280}>
        <div>content</div>
      </Resizable>,
    );
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    expect(handle.getAttribute("aria-valuemin")).toBe("200");
    expect(handle.getAttribute("aria-valuemax")).toBe("400");
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
  });

  it("applies the default width to the wrapper", () => {
    const { container } = render(
      <Resizable min={200} max={400} defaultWidth={312}>
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe("312px");
  });

  it("persists the width to localStorage on drag end", () => {
    const { container } = render(
      <Resizable
        min={200}
        max={400}
        defaultWidth={280}
        storageKey="test.sidebar.width"
      >
        <div>content</div>
      </Resizable>,
    );
    const handle = screen.getByRole("separator");
    const wrapper = container.firstElementChild as HTMLElement;
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 100));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 160));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", 160));
    });
    expect(window.localStorage.getItem("test.sidebar.width")).toBe("340");
    expect(wrapper.style.width).toBe("340px");
  });

  it("clamps the width to [min, max]", () => {
    const { container } = render(
      <Resizable min={200} max={400} defaultWidth={280}>
        <div>content</div>
      </Resizable>,
    );
    const handle = screen.getByRole("separator");
    const wrapper = container.firstElementChild as HTMLElement;
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 100));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 10000));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", 10000));
    });
    expect(wrapper.style.width).toBe("400px");
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerdown", 100));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", -10000));
    });
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", -10000));
    });
    expect(wrapper.style.width).toBe("200px");
  });

  it("supports keyboard resizing with arrow keys", () => {
    const { container } = render(
      <Resizable min={200} max={400} defaultWidth={280}>
        <div>content</div>
      </Resizable>,
    );
    const handle = screen.getByRole("separator");
    const wrapper = container.firstElementChild as HTMLElement;
    act(() => {
      fireEvent.keyDown(handle, { key: "ArrowRight" });
    });
    expect(wrapper.style.width).toBe("288px");
    act(() => {
      fireEvent.keyDown(handle, { key: "End" });
    });
    expect(wrapper.style.width).toBe("400px");
    act(() => {
      fireEvent.keyDown(handle, { key: "Home" });
    });
    expect(wrapper.style.width).toBe("200px");
  });

  it("rehydrates the stored width on a fresh mount", () => {
    window.localStorage.setItem("test.persist.width", "333");
    const { container } = render(
      <Resizable
        min={200}
        max={400}
        defaultWidth={280}
        storageKey="test.persist.width"
      >
        <div>content</div>
      </Resizable>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.width).toBe("333px");
  });

  it("omits the handle when disabled", () => {
    render(
      <Resizable disabled>
        <div>content</div>
      </Resizable>,
    );
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("clampWidth clamps to the range", () => {
    expect(clampWidth(50, 200, 400)).toBe(200);
    expect(clampWidth(300, 200, 400)).toBe(300);
    expect(clampWidth(900, 200, 400)).toBe(400);
  });
});
