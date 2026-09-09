/**
 * calendar-tools.test.ts — Phase C.3 tests for the calendar tool factory.
 *
 * Verifies that the calendar capability now exposes a PI tool surface
 * (4 tools: 1 read + 3 mutation) following the same factory pattern as
 * email-tools. Each test pins a specific contract of the factory so
 * future refactors can change internals without breaking callers.
 */

import { describe, expect, it } from "vitest";

import {
  createCalendarToolDefinitions,
  createReadOnlyCalendarToolDefinitions,
  CALENDAR_READ_ONLY_TOOL_NAMES,
  type CalendarToolHandlers,
} from "./calendar-tools";

function makeStubHandlers(): CalendarToolHandlers {
  const stub: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ["list", "create", "update", "updateInRoom", "remove", "removeInRoom"]) {
    stub[name] = (...args) => ({ ok: true, name, args });
  }
  return stub as unknown as CalendarToolHandlers;
}

describe("calendar-tools (Phase C.3)", () => {
  it("createCalendarToolDefinitions returns the 4-tool canonical set", () => {
    const tools = createCalendarToolDefinitions(makeStubHandlers());
    const names = new Set(tools.map((tool) => tool.name));

    // 1 read + 3 mutation = 4 total
    expect(tools).toHaveLength(4);
    expect(names.has("calendar_list")).toBe(true);    // READ
    expect(names.has("calendar_create")).toBe(true);  // MUTATION
    expect(names.has("calendar_update")).toBe(true);  // MUTATION
    expect(names.has("calendar_remove")).toBe(true);  // MUTATION
  });

  it("createReadOnlyCalendarToolDefinitions is a strict subset", () => {
    const full = createCalendarToolDefinitions(makeStubHandlers());
    const readonly = createReadOnlyCalendarToolDefinitions(makeStubHandlers());

    const fullNames = new Set(full.map((tool) => tool.name));
    for (const tool of readonly) {
      expect(fullNames.has(tool.name)).toBe(true);
    }
    // Strict subset: mutation tools must be excluded.
    expect(readonly.length).toBeLessThan(full.length);
  });

  it("createReadOnlyCalendarToolDefinitions matches CALENDAR_READ_ONLY_TOOL_NAMES exactly", () => {
    const readonly = createReadOnlyCalendarToolDefinitions(makeStubHandlers());
    const readonlyNames = readonly.map((tool) => tool.name).sort();
    const expected = [...CALENDAR_READ_ONLY_TOOL_NAMES].sort();
    expect(readonlyNames).toEqual(expected);
  });

  it("CALENDAR_READ_ONLY_TOOL_NAMES contains the single read tool", () => {
    expect(CALENDAR_READ_ONLY_TOOL_NAMES).toHaveLength(1);
    expect(CALENDAR_READ_ONLY_TOOL_NAMES[0]).toBe("calendar_list");
  });

  it("the read-only subset excludes all mutation tools", () => {
    const readonly = createReadOnlyCalendarToolDefinitions(makeStubHandlers());
    const readonlyNames = new Set(readonly.map((tool) => tool.name));

    expect(readonlyNames.has("calendar_create")).toBe(false);
    expect(readonlyNames.has("calendar_update")).toBe(false);
    expect(readonlyNames.has("calendar_remove")).toBe(false);
  });

  it("every tool name matches the calendar_* convention", () => {
    const tools = createCalendarToolDefinitions(makeStubHandlers());
    for (const tool of tools) {
      expect(tool.name).toMatch(/^calendar_[a-z_]+$/);
    }
  });
});