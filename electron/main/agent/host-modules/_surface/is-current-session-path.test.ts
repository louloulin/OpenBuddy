/**
 * host-modules/_surface/is-current-session-path.test.ts
 *
 * v7-A2 — Verify the warm-host fast-path predicate:
 *   - returns false when no session is active
 *   - returns false when cwd mismatch
 *   - returns false when sessionPath is empty
 *   - returns true only when session.sessionManager.getSessionFile() === sessionPath
 */
import { describe, expect, it } from "vitest";

import { isCurrentSessionPath } from "./is-current-session-path";

describe("isCurrentSessionPath", () => {
  it("returns false when no session is active", () => {
    const state = { session: null, cwd: "/foo" };
    expect(isCurrentSessionPath(state, "/path/to/session.jsonl", "/foo")).toBe(false);
  });

  it("returns false when cwd differs from state.cwd", () => {
    const state = {
      session: { sessionManager: { getSessionFile: () => "/path/to/session.jsonl" } },
      cwd: "/foo",
    };
    expect(isCurrentSessionPath(state, "/path/to/session.jsonl", "/bar")).toBe(false);
  });

  it("returns false when sessionPath is empty/undefined", () => {
    const state = {
      session: { sessionManager: { getSessionFile: () => "/path/to/session.jsonl" } },
      cwd: "/foo",
    };
    expect(isCurrentSessionPath(state, undefined, "/foo")).toBe(false);
    expect(isCurrentSessionPath(state, "", "/foo")).toBe(false);
  });

  it("returns true when session file matches sessionPath and cwd matches", () => {
    const state = {
      session: { sessionManager: { getSessionFile: () => "/path/to/session.jsonl" } },
      cwd: "/foo",
    };
    expect(isCurrentSessionPath(state, "/path/to/session.jsonl", "/foo")).toBe(true);
  });

  it("returns false when session file differs from sessionPath", () => {
    const state = {
      session: { sessionManager: { getSessionFile: () => "/path/to/active.jsonl" } },
      cwd: "/foo",
    };
    expect(isCurrentSessionPath(state, "/path/to/request.jsonl", "/foo")).toBe(false);
  });

  it("returns true when cwd is undefined (caller doesn't constrain cwd)", () => {
    const state = {
      session: { sessionManager: { getSessionFile: () => "/path/to/session.jsonl" } },
      cwd: "/foo",
    };
    expect(isCurrentSessionPath(state, "/path/to/session.jsonl", undefined)).toBe(true);
  });
});
