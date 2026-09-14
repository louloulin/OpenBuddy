import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { MultiSurfaceSessionRegistry, type MultiSurfaceSessionLease } from "./multi-surface-session";

type Surface = EventEmitter & { lease?: MultiSurfaceSessionLease; mount(sessionId: string): void; unmount(): void; crash(): void; reconnect(sessionId: string): void };
function surface(registry: MultiSurfaceSessionRegistry, ownerDispose: () => void, name: string): Surface {
  const emitter = new EventEmitter() as Surface;
  emitter.mount = (sessionId) => { const lease = registry.acquire(sessionId, name); if (!lease.ok) throw new Error(lease.message); emitter.lease = lease; emitter.emit("acquire", lease); };
  emitter.unmount = () => { emitter.emit("will-unmount"); emitter.lease?.release(); emitter.lease = undefined; };
  emitter.crash = () => { emitter.emit("crash"); const lease = emitter.lease; if (lease) registry.release(lease.sessionId, lease.surfaceId, lease.generation, ownerDispose); emitter.lease = undefined; };
  emitter.reconnect = (sessionId) => { const lease = registry.reconnect(sessionId, name); if (!lease.ok) throw new Error(lease.message); emitter.lease = lease; emitter.emit("acquire", lease); };
  return emitter;
}
function setup() { const ownerDispose = vi.fn(); const registry = new MultiSurfaceSessionRegistry(ownerDispose); return { ownerDispose, registry, panel: surface(registry, ownerDispose, "panel"), webview: surface(registry, ownerDispose, "webview"), inspector: surface(registry, ownerDispose, "inspector") }; }

describe("multi-surface session lifecycle integration", () => {
  it("A: mounts three surfaces and disposes after the final release", () => { const { registry, ownerDispose, panel, webview, inspector } = setup(); panel.mount("A"); webview.mount("A"); panel.unmount(); inspector.mount("A"); inspector.unmount(); webview.unmount(); expect(ownerDispose).toHaveBeenCalledTimes(1); expect(registry.acquire("A", "panel")).toMatchObject({ ok: false, code: "disposed" }); });
  it("B: crash cleanup removes the stale lease and disposes the owner", () => { const { registry, ownerDispose, panel } = setup(); panel.mount("B"); panel.crash(); expect(ownerDispose).toHaveBeenCalledTimes(1); expect(registry.acquire("B", "panel")).toMatchObject({ ok: false, code: "disposed" }); });
  it("C: reconnect bumps generation and rejects the stale release", () => { const { registry, ownerDispose, webview } = setup(); webview.mount("C"); const old = webview.lease!; webview.reconnect("C"); expect(registry.release("C", "webview", old.generation)).toMatchObject({ ok: false, code: "generation-mismatch" }); webview.lease!.release(); expect(ownerDispose).toHaveBeenCalledTimes(1); expect(registry.acquire("C", "webview")).toMatchObject({ ok: false, code: "disposed" }); });
  it("D: a handoff keeps the session alive until the inspector releases", () => { const { registry, ownerDispose, webview, inspector } = setup(); webview.mount("D"); const old = webview.lease!; webview.emit("will-unmount"); inspector.mount("D"); registry.release(old.sessionId, old.surfaceId, old.generation); webview.lease = undefined; inspector.unmount(); expect(ownerDispose).toHaveBeenCalledTimes(1); expect(registry.acquire("D", "inspector")).toMatchObject({ ok: false, code: "disposed" }); });
  it("E: parallel sessions remain isolated", () => { const { registry, ownerDispose, panel, webview } = setup(); panel.mount("E1"); webview.mount("E2"); panel.unmount(); expect(ownerDispose).toHaveBeenCalledTimes(1); expect(registry.snapshot("E2")[0]?.refCount).toBe(1); webview.unmount(); expect(ownerDispose).toHaveBeenCalledTimes(2); expect(registry.acquire("E1", "panel")).toMatchObject({ ok: false, code: "disposed" }); expect(registry.acquire("E2", "webview")).toMatchObject({ ok: false, code: "disposed" }); });
});
