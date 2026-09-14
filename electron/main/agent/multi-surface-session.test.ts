import { describe, expect, it, vi } from "vitest";
import { MultiSurfaceSessionRegistry } from "./multi-surface-session";
describe("MultiSurfaceSessionRegistry", () => {
  it("releases only after the last surface and is idempotent", () => {
    const released = vi.fn(); const registry = new MultiSurfaceSessionRegistry(released);
    const first = registry.acquire(" session-1 ", "desktop"); const second = registry.acquire("session-1", "web");
    expect(first.generation).toBe(second.generation); expect(registry.snapshot("session-1")[0]?.refCount).toBe(2);
    first.release(); first.release(); expect(released).not.toHaveBeenCalled(); second.release(); expect(released).toHaveBeenCalledWith("session-1", first.generation);
  });
  it("isolates generations and sessions", () => {
    const registry = new MultiSurfaceSessionRegistry(); const old = registry.acquire("session-1", "desktop"); old.release(); const current = registry.acquire("session-1", "web");
    expect(current.generation).toBeGreaterThan(old.generation); expect(registry.release("session-1", "web", old.generation)).toBe(false);
    expect(() => registry.acquire("", "desktop")).toThrow(); expect(registry.snapshot()[0]?.sessionId).toBe("session-1");
  });
});
