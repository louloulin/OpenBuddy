import { describe, expect, it, vi } from "vitest";
import { MultiSurfaceSessionRegistry } from "./multi-surface-session";
describe("MultiSurfaceSessionRegistry", () => {
  it("releases only after the last surface and is idempotent", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire(" session-1 ", "desktop"); const second = registry.acquire("session-1", "web");
    expect(first.generation).toBe(second.generation); expect(registry.snapshot("session-1")[0]?.refCount).toBe(2);
    first.release(); first.release(); expect(released).not.toHaveBeenCalled(); second.release(); expect(released).toHaveBeenCalledWith("session-1", first.generation);
  });
  it("treats duplicate acquire of one surface as idempotent", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire("session-1", "desktop");
    const duplicate = registry.acquire("session-1", "desktop");
    expect(duplicate.generation).toBe(first.generation);
    expect(registry.snapshot("session-1")[0]).toMatchObject({ refCount: 1, surfaces: ["desktop"] });
    duplicate.release();
    expect(registry.snapshot("session-1")).toEqual([]);
    expect(released).toHaveBeenCalledTimes(1);
    first.release();
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("keeps different sessions independent across generation bumps", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire("session-1", "desktop");
    const other = registry.acquire("session-2", "desktop");
    first.release();
    expect(registry.snapshot("session-2")[0]).toMatchObject({ sessionId: "session-2", refCount: 1 });
    const replacement = registry.acquire("session-1", "desktop");
    expect(replacement.generation).toBeGreaterThan(first.generation);
    expect(registry.release("session-1", "desktop", first.generation)).toBe(false);
    expect(registry.snapshot("session-1")[0]?.generation).toBe(replacement.generation);
    other.release(); replacement.release();
    expect(released).toHaveBeenCalledTimes(3);
  });

  it("rejects empty identities", () => {
    const registry = new MultiSurfaceSessionRegistry();
    expect(() => registry.acquire("", "desktop")).toThrow();
    expect(() => registry.acquire("session-1", " ")).toThrow();
  });

});
