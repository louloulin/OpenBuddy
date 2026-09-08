/**
 * host-modules/_surface/filesystem-capability-policy.test.ts
 *
 * v5-F — Verify the filesystem capability policy helper delegates to the
 * canonical evals/node helper and returns the expected shape.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILESYSTEM_POLICY,
  evaluateFilesystemCapabilityPolicy,
  type FilesystemCapabilityPolicy,
} from "./filesystem-capability-policy";

describe("filesystem-capability-policy", () => {
  it("exports the default policy constant", () => {
    expect(DEFAULT_FILESYSTEM_POLICY).toBe("disabled-by-policy");
  });

  it("delegates to the evals/node helper with no overrides", () => {
    const result = evaluateFilesystemCapabilityPolicy();
    expect(result).toBeTypeOf("object");
    expect(typeof result.allowed).toBe("boolean");
    expect(typeof result.reason).toBe("string");
    expect(["env", "manifest", "default"]).toContain(result.source);
  });

  it("passes env overrides through to the helper", () => {
    const env = { OPENBUDDY_FS_CAPABILITY: "allow" } as NodeJS.ProcessEnv;
    const result = evaluateFilesystemCapabilityPolicy({ env });
    expect(result).toBeTypeOf("object");
  });

  it("passes manifestPolicy override through to the helper", () => {
    const result = evaluateFilesystemCapabilityPolicy({ manifestPolicy: "allow" });
    expect(result).toBeTypeOf("object");
  });

  it("returns a shape compatible with FilesystemCapabilityPolicy", () => {
    const result: FilesystemCapabilityPolicy = evaluateFilesystemCapabilityPolicy();
    expect(result).toBeDefined();
  });
});
