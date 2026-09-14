import { describe, expect, it } from "vitest";
import { PluginEventLogCursorRegistry } from "../../../../electron/main/agent/plugin-event-log-cursor";
describe("useAgentSession event-log lifecycle contract", () => {
  it("mount attaches and reads initial events", () => { const r = new PluginEventLogCursorRegistry(); expect(r.attachSurface("s", "surface")).toMatchObject({ ok: true }); r.append("s", "e1", 1); expect(r.readSince("s", "surface", undefined, 50)).toMatchObject({ events: [1] }); });
  it("preserves initial event order", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "surface"); r.append("s", "a", "a"); r.append("s", "b", "b"); expect(r.readSince("s", "surface")).toMatchObject({ events: ["a", "b"] }); });
  it("advances cursor and reads only new events", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "surface"); r.append("s", "a", "a"); r.append("s", "b", "b"); r.readSince("s", "surface", undefined, 50); r.append("s", "c", "c"); expect(r.readSince("s", "surface", "b")).toMatchObject({ events: ["c"], nextCursor: "c" }); });
  it("unmount detaches the surface", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "surface"); expect(r.detachSurface("s", "surface")).toMatchObject({ ok: true }); expect(r.attachSurface("s", "surface")).toMatchObject({ ok: false, code: "frozen" }); });
  it("disposed sessions return cleared", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "surface"); r.disposeOwner("s"); expect(r.attachSurface("s", "surface")).toMatchObject({ ok: false, code: "cleared" }); });
  it("duplicate mount does not attach twice", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "surface"); expect(r.attachSurface("s", "surface")).toMatchObject({ ok: false, code: "already-attached" }); });
});
