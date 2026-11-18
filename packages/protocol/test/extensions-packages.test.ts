// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateCommandPayload } from "../src/validate.js";
import { validExtensionSource, validRegistryQuery } from "../src/extensions.js";

describe("扩展包来源 (pii W2.6 P2 / S14)", () => {
  it("accepts npm, git and owner/repo sources", () => {
    for (const source of ["npm:@scope/pkg", "npm:some-extension", "git:https://github.com/a/b", "https://github.com/a/b", "git@github.com:a/b.git", "owner/repo"]) {
      expect(validExtensionSource(source)).toBe(true);
      expect(() => validateCommandPayload("agent_extensions_install_package", { source })).not.toThrow();
    }
  });

  it("rejects local paths, schemes and hostile input", () => {
    for (const source of ["/etc/passwd", "C:\\temp\\x", "file:///tmp/x", "ftp://x/y", "a/b/c", "npm:", "x".repeat(2049), "npm:foo\nbar"]) {
      expect(validExtensionSource(source)).toBe(false);
      expect(() => validateCommandPayload("agent_extensions_install_package", { source })).toThrow(/invalid_payload/);
    }
  });

  it("update accepts an optional source", () => {
    expect(() => validateCommandPayload("agent_extensions_update_packages", {})).not.toThrow();
    expect(() => validateCommandPayload("agent_extensions_update_packages", { source: "owner/repo" })).not.toThrow();
    expect(() => validateCommandPayload("agent_extensions_update_packages", { source: "/local" })).toThrow(/invalid_payload/);
  });
});

describe("Pi 包市场与包资源 (S15)", () => {
  it("accepts an empty or bounded registry query", () => {
    for (const query of ["", "web", "a".repeat(120)]) {
      expect(validRegistryQuery(query)).toBe(true);
      expect(() => validateCommandPayload("agent_extensions_search_registry", { query })).not.toThrow();
    }
    expect(() => validateCommandPayload("agent_extensions_search_registry", {})).not.toThrow();
  });

  it("rejects hostile registry queries", () => {
    for (const query of ["a".repeat(121), "a\nb", "a\0b", 42 as unknown as string]) {
      expect(validRegistryQuery(query)).toBe(false);
      expect(() => validateCommandPayload("agent_extensions_search_registry", { query })).toThrow(/invalid_payload/);
    }
  });

  it("scopes the resources command by an optional cwd", () => {
    expect(() => validateCommandPayload("agent_extensions_resources", {})).not.toThrow();
    expect(() => validateCommandPayload("agent_extensions_resources", { cwd: "/tmp/work" })).not.toThrow();
  });

  it("accepts a bounded pagination offset", () => {
    expect(() => validateCommandPayload("agent_extensions_search_registry", { query: "web", offset: 25 })).not.toThrow();
    expect(() => validateCommandPayload("agent_extensions_search_registry", { query: "web", offset: 1000 })).not.toThrow();
    for (const offset of [-1, 1001, 1.5, "25"]) {
      expect(() => validateCommandPayload("agent_extensions_search_registry", { query: "web", offset })).toThrow(/invalid_payload/);
    }
  });

  it("validates per-package resource switches", () => {
    expect(() => validateCommandPayload("agent_extensions_set_package_resources", { source: "npm:a", resources: { skills: false } })).not.toThrow();
    expect(() => validateCommandPayload("agent_extensions_set_package_resources", { source: "npm:a", resources: {} })).not.toThrow();
    for (const resources of [null, [], "skills", { skills: "no" }, { unknown: false }]) {
      expect(() => validateCommandPayload("agent_extensions_set_package_resources", { source: "npm:a", resources })).toThrow(/invalid_payload/);
    }
    expect(() => validateCommandPayload("agent_extensions_set_package_resources", { source: "/local", resources: {} })).toThrow(/invalid_payload/);
  });
});
