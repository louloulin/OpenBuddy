import { beforeEach, expect, it } from "vitest";
import { act } from "@testing-library/react";
import { useSessionStore } from "../../../features/chat/state/session-store";
import { useUnseenStore } from "../unseen-store";

beforeEach(() => {
  localStorage.removeItem("openbuddy.unseen");
  act(() => { useUnseenStore.setState({ ids: [] }); useSessionStore.setState({ sessionId: "a" }); });
});

it("marks background completions and clears them when the session is opened", () => {
  act(() => useUnseenStore.getState().mark("b"));
  act(() => useUnseenStore.getState().mark("a")); // the open session is already seen
  expect(useUnseenStore.getState().ids).toEqual(["b"]);
  expect(JSON.parse(localStorage.getItem("openbuddy.unseen")!)).toEqual(["b"]);
  act(() => useSessionStore.setState({ sessionId: "b" }));
  expect(useUnseenStore.getState().ids).toEqual([]);
});
