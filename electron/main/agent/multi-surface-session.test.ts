import { describe, expect, it, vi } from "vitest";
import { MultiSurfaceSessionRegistry } from "./multi-surface-session";

describe("MultiSurfaceSessionRegistry", () => {
  it("does not dispose an owner for a single surface release unless requested", () => {
    const ownerDispose = vi.fn();
    const registry = new MultiSurfaceSessionRegistry();
    const lease = registry.acquire("session-1", "desktop");
    expect(lease.ok).toBe(true);
    if (lease.ok) expect(registry.release(lease.sessionId, lease.surfaceId, lease.generation)).toEqual({ ok: true, released: true });
    expect(ownerDispose).not.toHaveBeenCalled();
  });

  it("waits for the final interleaved surface release and disposes once", () => {
    const ownerDispose = vi.fn();
    const registry = new MultiSurfaceSessionRegistry();
    const first = registry.acquire("session-1", "desktop");
    const second = registry.acquire("session-1", "web");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(registry.release(second.sessionId, second.surfaceId, second.generation, ownerDispose)).toEqual({ ok: true, released: true });
      expect(ownerDispose).not.toHaveBeenCalled();
      expect(registry.release(first.sessionId, first.surfaceId, first.generation, ownerDispose)).toEqual({ ok: true, released: true });
      expect(ownerDispose).toHaveBeenCalledTimes(1);
      expect(registry.release(first.sessionId, first.surfaceId, first.generation, ownerDispose).code).toBe("unknown-session");
    }
  });

  it("does not reactivate a disposed session", () => {
    const registry = new MultiSurfaceSessionRegistry();
    const lease = registry.acquire("session-1", "desktop");
    if (lease.ok) registry.release(lease.sessionId, lease.surfaceId, lease.generation, vi.fn());
    expect(registry.acquire("session-1", "desktop")).toMatchObject({ ok: false, code: "disposed" });
  });

  it("returns a clear generation mismatch error", () => {
    const registry = new MultiSurfaceSessionRegistry();
    const lease = registry.acquire("session-1", "desktop");
    if (lease.ok) expect(registry.release("session-1", "desktop", lease.generation + 1)).toMatchObject({ ok: false, code: "generation-mismatch" });
  });

  it("keeps the registry clean when owner dispose throws", () => {
    const registry = new MultiSurfaceSessionRegistry();
    const lease = registry.acquire("session-1", "desktop");
    if (lease.ok) {
      expect(registry.release(lease.sessionId, lease.surfaceId, lease.generation, () => { throw new Error("dispose failed"); })).toEqual({ ok: true, released: true });
    }
    expect(registry.snapshot()).toEqual([]);
    expect(registry.acquire("session-1", "desktop")).toMatchObject({ ok: false, code: "disposed" });
  });

  it("releases only after the last surface and is idempotent", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire(" session-1 ", "desktop"); const second = registry.acquire("session-1", "web");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.generation).toBe(second.generation); expect(registry.snapshot("session-1")[0]?.refCount).toBe(2);
      expect(first.release()).toEqual({ ok: true, released: true }); expect(first.release()).toMatchObject({ ok: false, code: "duplicate-release" });
      expect(released).not.toHaveBeenCalled(); second.release(); expect(released).toHaveBeenCalledWith("session-1", first.generation);
    }
  });

  it("treats duplicate acquire of one surface as idempotent", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire("session-1", "desktop"); const duplicate = registry.acquire("session-1", "desktop");
    expect(first.ok && duplicate.ok).toBe(true);
    if (first.ok && duplicate.ok) { duplicate.release(); expect(registry.snapshot("session-1")).toEqual([]); expect(released).toHaveBeenCalledTimes(1); first.release(); expect(released).toHaveBeenCalledTimes(1); }
  });

  it("keeps different sessions independent across generation bumps", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire("session-1", "desktop"); const other = registry.acquire("session-2", "desktop");
    if (first.ok && other.ok) { first.release(); expect(registry.snapshot("session-2")[0]?.refCount).toBe(1); expect(registry.acquire("session-1", "desktop")).toMatchObject({ ok: false, code: "disposed" }); other.release(); expect(released).toHaveBeenCalledTimes(2); }
  });

  it("rejects empty identities", () => { const registry = new MultiSurfaceSessionRegistry(); expect(() => registry.acquire("", "desktop")).toThrow(); expect(() => registry.acquire("session-1", " ")).toThrow(); });
});
