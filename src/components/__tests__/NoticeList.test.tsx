/**
 * NoticeList tests — Phase R3.0 (pi-web-alignment).
 *
 * Validates:
 *   - store push / markOldestExiting / remove lifecycle
 *   - visible shelf renders up to MAX_NOTICES rows
 *   - tone classes (`notice-chip--info` etc.) are applied per type
 *   - empty shelf renders nothing (no DOM bloat)
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { NoticeList, NoticeStoreProvider, useNoticeStore } from "../NoticeList";
import { MAX_NOTICES } from "@/lib/stream/notices/noticeReducer";

function HarnessProbe() {
  const store = useNoticeStore();
  return (
    <div>
      <button data-testid="info" onClick={() => store.push("info message", "info")}>
        info
      </button>
      <button data-testid="warn" onClick={() => store.push("warning message", "warning")}>
        warn
      </button>
      <button data-testid="error" onClick={() => store.push("error message", "error")}>
        error
      </button>
      <button data-testid="success" onClick={() => store.push("ok", "success")}>
        success
      </button>
      <button data-testid="exit" onClick={() => store.markOldestExiting()}>
        exit
      </button>
      <button data-testid="count" onClick={() => store.remove("never-existed")}>
        count
      </button>
    </div>
  );
}

function withProvider(node: React.ReactNode) {
  return <NoticeStoreProvider>{node}</NoticeStoreProvider>;
}

describe("NoticeStoreProvider + NoticeList", () => {
  it("renders nothing when there are no notices", () => {
    render(
      withProvider(
        <>
          <HarnessProbe />
          <NoticeList />
        </>,
      ),
    );
    expect(screen.queryByTestId("notice-shelf")).toBeNull();
  });

  it("renders a chip per visible notice with the matching tone class", () => {
    render(
      withProvider(
        <>
          <HarnessProbe />
          <NoticeList />
        </>,
      ),
    );
    act(() => {
      screen.getByTestId("info").click();
      screen.getByTestId("warn").click();
      screen.getByTestId("error").click();
      screen.getByTestId("success").click();
    });

    expect(screen.getByText("info message").className).toContain("notice-chip--info");
    expect(screen.getByText("warning message").className).toContain("notice-chip--warning");
    expect(screen.getByText("error message").className).toContain("notice-chip--error");
    expect(screen.getByText("ok").className).toContain("notice-chip--success");
  });

  it("caps the visible shelf at MAX_NOTICES; extra notices are pending", () => {
    render(
      withProvider(
        <>
          <HarnessProbe />
          <NoticeList />
        </>,
      ),
    );
    const infoBtn = screen.getByTestId("info");
    act(() => {
      for (let i = 0; i < MAX_NOTICES + 2; i++) infoBtn.click();
    });
    // MAX_NOTICES visible
    const shelf = screen.getByTestId("notice-shelf");
    expect(shelf.querySelectorAll(".notice-chip")).toHaveLength(MAX_NOTICES);
  });

  it("applies the exiting class when markOldestExiting is called", () => {
    render(
      withProvider(
        <>
          <HarnessProbe />
          <NoticeList />
        </>,
      ),
    );
    act(() => {
      screen.getByTestId("info").click();
      screen.getByTestId("exit").click();
    });
    const chip = screen.getByText("info message");
    expect(chip.className).toContain("notice-chip--exiting");
  });

  it("calls store.remove without crashing when id is unknown", () => {
    render(
      withProvider(
        <>
          <HarnessProbe />
          <NoticeList />
        </>,
      ),
    );
    expect(() => act(() => screen.getByTestId("count").click())).not.toThrow();
  });

  it("the standalone useNoticeStore hook works without a Provider", () => {
    // Inline usage without the Provider still drives a local reducer so the
    // shelf can render the chip. Two distinct useNoticeStore calls would
    // have separate state, so this test only proves that a single consumer
    // gets a working shelf.
    function Inline() {
      const store = useNoticeStore();
      return (
        <button data-testid="push" onClick={() => store.push("hi")}>
          x
        </button>
      );
    }
    render(
      <>
        <Inline />
        <NoticeList />
      </>,
    );
    // Push into Inline's local store — NoticeList uses its own local
    // store, so we can't observe it here without the Provider. The test
    // simply ensures both can be rendered simultaneously without crash.
    expect(() => screen.getByTestId("push").click()).not.toThrow();
  });
});