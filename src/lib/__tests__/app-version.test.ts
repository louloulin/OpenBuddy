import { describe, it, expect } from "vitest";
import { APP_VERSION } from "../platform/app-version";

describe("APP_VERSION", () => {
  it("is a non-empty semantic version string from package.json", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION.length).toBeGreaterThan(0);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
