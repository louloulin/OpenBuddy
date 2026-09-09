import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetGenericServiceRegistryForTest,
  isGenericDeepSeekSpecifier,
  readGenericService,
  resolveDeepSeekGenericModule,
  writeGenericService,
  type DeepSeekGenericService,
} from "./deepseek-generic";

describe("deepseek-generic shim (Phase L.3 step 1)", () => {
  beforeEach(() => {
    __resetGenericServiceRegistryForTest();
  });

  describe("resolveDeepSeekGenericModule", () => {
    it("returns a no-op plugin module for DSH package specifiers", () => {
      const bare = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-terminal");
      expect(bare).toBeDefined();
      expect(bare).toMatchObject({
        default: expect.objectContaining({ apply: expect.any(Function) }),
        name: "@deepseek-ai/dsh-tool-terminal",
        apply: expect.any(Function),
      });
    });

    it("returns a /remote variant with TYPERT_REMOTE for /remote subpath", () => {
      const remote = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-terminal/remote");
      expect(remote).toBeDefined();
      expect(remote).toHaveProperty("default");
      expect(remote).toHaveProperty("TYPERT_REMOTE");
    });

    it("returns a no-op invariant for /invariant subpath", () => {
      const invariant = resolveDeepSeekGenericModule("@deepseek-ai/dsh-tool-terminal/invariant");
      expect(invariant).toBeDefined();
      expect(invariant).toMatchObject({
        name: "@deepseek-ai/dsh-tool-terminal-invariant",
        apply: expect.any(Function),
      });
    });

    it("the no-op apply() does not register any cordis services", async () => {
      const result = resolveDeepSeekGenericModule("@deepseek-ai/dsh-llm");
      expect(result).toBeDefined();
      const plugin = result!.default as { apply: (ctx: unknown, config?: unknown) => Promise<() => void> };
      const dispose = await plugin.apply({}, {});
      expect(typeof dispose).toBe("function");
      // dispose() must be a no-op, not throw
      expect(() => dispose()).not.toThrow();
    });

    it("returns undefined for non-DSH specifiers", () => {
      expect(resolveDeepSeekGenericModule("@earendil-works/pi-coding-agent")).toBeUndefined();
      expect(resolveDeepSeekGenericModule("node:fs")).toBeUndefined();
      expect(resolveDeepSeekGenericModule("./local")).toBeUndefined();
    });

    it("returns undefined for the explicit @deepseek-ai/dsh-session-query carve-out", () => {
      expect(resolveDeepSeekGenericModule("@deepseek-ai/dsh-session-query")).toBeUndefined();
      expect(resolveDeepSeekGenericModule("@deepseek-ai/dsh-session-query/types")).toBeUndefined();
    });
  });

  describe("isGenericDeepSeekSpecifier", () => {
    it("recognizes @deepseek-ai/dsh-* specifiers", () => {
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/dsh-tool-terminal")).toBe(true);
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/dsh-tool-terminal/client")).toBe(true);
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/dsh-system-prompt")).toBe(true);
    });

    it("recognizes @deepseek-ai/cordis-plugin-* specifiers", () => {
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/cordis-plugin-foo")).toBe(true);
    });

    it("excludes the explicit @deepseek-ai/dsh-session-query package", () => {
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/dsh-session-query")).toBe(false);
      expect(isGenericDeepSeekSpecifier("@deepseek-ai/dsh-session-query/types")).toBe(false);
    });

    it("returns false for non-DeepSeek specifiers", () => {
      expect(isGenericDeepSeekSpecifier("@earendil-works/pi-coding-agent")).toBe(false);
      expect(isGenericDeepSeekSpecifier("@openbuddy/cordis")).toBe(false);
      expect(isGenericDeepSeekSpecifier("node:fs")).toBe(false);
      expect(isGenericDeepSeekSpecifier("./local")).toBe(false);
    });
  });

  describe("genericServiceRegistry", () => {
    it("round-trips services through read/write", () => {
      const service: DeepSeekGenericService = { hello: () => "world" };
      expect(readGenericService("non-existent")).toBeUndefined();
      writeGenericService("settings", service);
      expect(readGenericService("settings")).toBe(service);
    });

    it("overwrites an existing entry on re-write", () => {
      const first: DeepSeekGenericService = { id: "first" };
      const second: DeepSeekGenericService = { id: "second" };
      writeGenericService("settings", first);
      writeGenericService("settings", second);
      expect(readGenericService("settings")).toBe(second);
    });

    it("__resetGenericServiceRegistryForTest clears the registry", () => {
      const service: DeepSeekGenericService = { id: "ephemeral" };
      writeGenericService("settings", service);
      expect(readGenericService("settings")).toBe(service);
      __resetGenericServiceRegistryForTest();
      expect(readGenericService("settings")).toBeUndefined();
    });
  });
});