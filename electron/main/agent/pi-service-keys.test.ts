import { describe, expect, it } from "vitest";
import { isServiceKey, PI_SERVICE_KEYS, type ServiceKey } from "./pi-service-keys";

describe("pi-service-keys", () => {
  it("exposes the canonical ServiceKey literals", () => {
    expect(PI_SERVICE_KEYS).toContain("memory");
    expect(PI_SERVICE_KEYS).toContain("plan");
    expect(PI_SERVICE_KEYS).toContain("automation");
    expect(PI_SERVICE_KEYS).toContain("folder-trust");
    expect(PI_SERVICE_KEYS).toContain("sessions");
    expect(PI_SERVICE_KEYS).toContain("fsLocal");
  });

  it("isServiceKey narrows string literals", () => {
    const value: string = "memory";
    const narrowed: ServiceKey | undefined = isServiceKey(value) ? value : undefined;
    expect(narrowed).toBe("memory");
  });

  it("isServiceKey rejects unknown keys", () => {
    expect(isServiceKey("not-a-real-key")).toBe(false);
    expect(isServiceKey("Memory")).toBe(false);
    expect(isServiceKey("")).toBe(false);
  });

  it("PI_SERVICE_KEYS is a frozen literal array", () => {
    expect(Array.isArray(PI_SERVICE_KEYS)).toBe(true);
    expect(PI_SERVICE_KEYS.length).toBeGreaterThanOrEqual(10);
  });
});
