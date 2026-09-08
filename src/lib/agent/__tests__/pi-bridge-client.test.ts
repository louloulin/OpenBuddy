import { afterEach, describe, expect, it, vi } from "vitest";

import { getPiBridge, requirePiBridge } from "../pi-bridge-client";

describe("pi-bridge-client", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("getPiBridge returns null when window.api is undefined", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(getPiBridge()).toBeNull();
  });

  it("getPiBridge returns null when window.api has no pi", () => {
    (globalThis as { window?: unknown }).window = { api: {} };
    expect(getPiBridge()).toBeNull();
  });

  it("getPiBridge returns the typed client when present", () => {
    const fake = { text: {}, image: {}, skills: {} };
    (globalThis as { window?: unknown }).window = { api: { pi: fake } };
    expect(getPiBridge()).toBe(fake);
  });

  it("requirePiBridge throws when missing", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => requirePiBridge()).toThrow(/pi-bridge is not available/);
  });

  it("requirePiBridge returns the client when present", () => {
    const fake = { text: {}, image: {}, skills: {} };
    (globalThis as { window?: unknown }).window = { api: { pi: fake } };
    expect(requirePiBridge()).toBe(fake);
  });
});