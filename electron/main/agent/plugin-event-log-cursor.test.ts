import { describe, expect, it } from "vitest";
import { PluginEventLogCursorRegistry } from "./plugin-event-log-cursor";

describe("PluginEventLogCursorRegistry", () => {
  it("attaches, advances, detaches and freezes", () => { const r = new PluginEventLogCursorRegistry(); const a = r.attachSurface("s", "a"); expect(a).toMatchObject({ ok: true, generation: 1 }); expect(r.advance("s", "a", "e1")).toMatchObject({ ok: true, cursor: "e1" }); expect(r.detachSurface("s", "a")).toMatchObject({ ok: true }); expect(r.advance("s", "a", "e2")).toMatchObject({ ok: false, code: "frozen" }); });
  it("keeps surface cursors independent", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "a"); r.attachSurface("s", "b"); r.advance("s", "a", "e1"); r.advance("s", "b", "e2"); expect(r.snapshot("s")[0]?.cursors).toEqual({ a: "e1", b: "e2" }); });
  it("freezes after the final detach", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "a"); r.attachSurface("s", "b"); r.detachSurface("s", "a"); expect(r.advance("s", "b", "e2")).toMatchObject({ ok: true }); r.detachSurface("s", "b"); expect(r.advance("s", "b", "e3")).toMatchObject({ ok: false, code: "frozen" }); });
  it("clears after owner disposal", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "a"); expect(r.disposeOwner("s")).toEqual({ ok: true, archived: true }); expect(r.attachSurface("s", "b")).toMatchObject({ ok: false, code: "cleared" }); });
  it("rejects duplicate surface attachment", () => { const r = new PluginEventLogCursorRegistry(); r.attachSurface("s", "a"); expect(r.attachSurface("s", "a")).toMatchObject({ ok: false, code: "already-attached" }); });
  it("returns generation mismatch errors", () => { const r = new PluginEventLogCursorRegistry(); const a = r.attachSurface("s", "a"); if (a.ok) expect(r.advance("s", "a", "e1", a.generation + 1)).toMatchObject({ ok: false, code: "generation-mismatch" }); });
  it("returns not-attached without throwing", () => { const r = new PluginEventLogCursorRegistry(); expect(r.detachSurface("s", "missing")).toMatchObject({ ok: false, code: "unknown-session" }); });
});
