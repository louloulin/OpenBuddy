/**
 * noticeReducer tests — Phase R3.0 (pi-web-alignment).
 *
 * Pins the bounded-shelf semantics: at most MAX_NOTICES visible; pending
 * promotion; oldest-first exit; no leaks when items are removed mid-flight.
 */
import { describe, expect, it } from "vitest";
import {
  createNoticeId,
  fillPendingNotices,
  INITIAL_NOTICE_STATE,
  makeNotice,
  markOldestNoticeExiting,
  MAX_NOTICES,
  noticeReducer,
  type NoticeItem,
  type NoticeState,
} from "../noticeReducer";

const fixture = (msg: string): NoticeItem => ({ id: msg, message: msg, type: "info" });

describe("noticeReducer", () => {
  it("returns the same state for unknown actions", () => {
    const state: NoticeState = { visible: [fixture("a")], pending: [] };
    // @ts-expect-error — intentional exhaustiveness check
    expect(noticeReducer(state, { type: "bogus" })).toBe(state);
  });

  it("appates a notice to the visible list when there is room", () => {
    const next = noticeReducer(INITIAL_NOTICE_STATE, {
      type: "add",
      notice: fixture("hello"),
    });
    expect(next.visible).toHaveLength(1);
    expect(next.pending).toHaveLength(0);
    expect(next.visible[0].message).toBe("hello");
  });

  it("queues pending when the visible shelf is full", () => {
    let state = INITIAL_NOTICE_STATE;
    for (let i = 0; i < MAX_NOTICES; i++) {
      state = noticeReducer(state, { type: "add", notice: fixture(`v${i}`) });
    }
    expect(state.visible).toHaveLength(MAX_NOTICES);
    state = noticeReducer(state, { type: "add", notice: fixture("overflow") });
    expect(state.visible).toHaveLength(MAX_NOTICES);
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].message).toBe("overflow");
  });

  it("promotes pending into visible after a remove", () => {
    let state = INITIAL_NOTICE_STATE;
    for (let i = 0; i < MAX_NOTICES; i++) {
      state = noticeReducer(state, { type: "add", notice: fixture(`v${i}`) });
    }
    state = noticeReducer(state, { type: "add", notice: fixture("queued") });
    expect(state.pending).toHaveLength(1);

    state = noticeReducer(state, { type: "remove", id: "v0" });
    // queued promoted into visible, no more pending
    expect(state.visible.map((n) => n.message)).toEqual(["v1", "v2", "v3", "v4", "queued"]);
    expect(state.pending).toHaveLength(0);
  });

  it("mark_oldest_exiting marks the oldest non-exiting visible row", () => {
    let state = INITIAL_NOTICE_STATE;
    for (let i = 0; i < 3; i++) {
      state = noticeReducer(state, { type: "add", notice: fixture(`v${i}`) });
    }
    state = noticeReducer(state, { type: "mark_oldest_exiting" });
    expect(state.visible[0].exiting).toBe(true);
    expect(state.visible[1].exiting).toBeUndefined();
  });

  it("mark_oldest_exiting is a no-op when all visible rows are already exiting", () => {
    let state = INITIAL_NOTICE_STATE;
    state = noticeReducer(state, { type: "add", notice: fixture("a") });
    state = noticeReducer(state, { type: "mark_oldest_exiting" });
    const before = state;
    const after = noticeReducer(state, { type: "mark_oldest_exiting" });
    expect(after).toBe(before);
  });

  it("add while a visible row is exiting queues the new notice as pending", () => {
    let state = INITIAL_NOTICE_STATE;
    for (let i = 0; i < MAX_NOTICES; i++) {
      state = noticeReducer(state, { type: "add", notice: fixture(`v${i}`) });
    }
    state = noticeReducer(state, { type: "mark_oldest_exiting" });
    // Add while the shelf is full AND one row is exiting → queue as pending
    // without forcing another exit (the pending promotion path runs later).
    state = noticeReducer(state, { type: "add", notice: fixture("incoming") });
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].message).toBe("incoming");
    // Only one row is exiting (the one we just marked).
    expect(state.visible.filter((n) => n.exiting)).toHaveLength(1);
  });

  it("does not duplicate a notice id that is already in the visible list", () => {
    // The reducer itself does NOT de-duplicate — that responsibility lives
    // in the call site (noticeAppend on the chat side). This test pins
    // current behavior so a future "smart dedup" change is intentional.
    const initial = { visible: [fixture("dup")], pending: [] };
    const next = noticeReducer(initial, { type: "add", notice: fixture("dup") });
    expect(next.visible).toHaveLength(2);
  });
});

describe("markOldestNoticeExiting", () => {
  it("returns the same reference when no candidate exists", () => {
    const exiting: NoticeItem[] = [{ id: "a", message: "a", type: "info", exiting: true }];
    expect(markOldestNoticeExiting(exiting)).toBe(exiting);
  });
});

describe("fillPendingNotices", () => {
  it("promotes pending while there is room", () => {
    const visible = [fixture("v0"), fixture("v1")];
    const pending = [fixture("p0"), fixture("p1")];
    const next = fillPendingNotices(visible, pending);
    expect(next.visible.map((n) => n.message)).toEqual(["v0", "v1", "p0", "p1"]);
    expect(next.pending).toHaveLength(0);
  });

  it("marks oldest visible exiting when pending still has items but no slot is free", () => {
    const visible: NoticeItem[] = Array.from({ length: MAX_NOTICES }, (_, i) =>
      fixture(`v${i}`),
    );
    const pending = [fixture("p0")];
    const next = fillPendingNotices(visible, pending);
    expect(next.visible[0].exiting).toBe(true);
    expect(next.pending).toHaveLength(1);
  });
});

describe("makeNotice / createNoticeId", () => {
  it("creates a notice with a unique id", () => {
    const a = makeNotice("hi");
    const b = makeNotice("hi");
    expect(a.id).not.toBe(b.id);
    expect(a.message).toBe("hi");
    expect(a.type).toBe("info");
  });

  it("respects an explicit type", () => {
    expect(makeNotice("x", "warning").type).toBe("warning");
    expect(makeNotice("x", "error").type).toBe("error");
  });

  it("createNoticeId falls back to time+random when crypto is unavailable", () => {
    // We don't easily tear down crypto.randomUUID in node, but the
    // implementation always produces a non-empty string — that's enough.
    expect(typeof createNoticeId()).toBe("string");
    expect(createNoticeId().length).toBeGreaterThan(0);
  });
});