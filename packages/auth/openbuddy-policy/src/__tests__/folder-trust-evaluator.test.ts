/**
 * folder-trust-evaluator.test.ts — FolderTrustEvaluator 单元测试
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FolderTrustEvaluator } from "../evaluators/folder-trust-evaluator";

beforeEach(() => vi.restoreAllMocks());

describe("FolderTrustEvaluator — matches()", () => {
  it("matches when context.folder is present", () => {
    const e = new FolderTrustEvaluator({ isFolderTrusted: () => true });
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { folder: "/path/to/folder" } })).toBe(true);
  });

  it("does not match when context.folder is missing or empty", () => {
    const e = new FolderTrustEvaluator({ isFolderTrusted: () => true });
    expect(e.matches({ subject: "u", action: "x", resource: "y" })).toBe(false);
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: {} })).toBe(false);
    expect(e.matches({ subject: "u", action: "x", resource: "y", context: { folder: "" } })).toBe(false);
  });
});

describe("FolderTrustEvaluator — evaluate()", () => {
  it("returns FOLDER_TRUSTED when isFolderTrusted returns true", async () => {
    const e = new FolderTrustEvaluator({ isFolderTrusted: () => true });

    const result = await e.evaluate({
      subject: "u", action: "write", resource: "file",
      context: { folder: "/path/to/folder" },
    });

    expect(result).toMatchObject({
      allowed: true,
      code: "FOLDER_TRUSTED",
      source: "folder_trust",
      matchedRule: "/path/to/folder:trusted",
    });
  });

  it("returns FOLDER_UNTRUSTED when isFolderTrusted returns false", async () => {
    const e = new FolderTrustEvaluator({ isFolderTrusted: () => false });

    const result = await e.evaluate({
      subject: "u", action: "write", resource: "file",
      context: { folder: "/untrusted" },
    });

    expect(result).toMatchObject({
      allowed: false,
      code: "FOLDER_UNTRUSTED",
      source: "folder_trust",
      matchedRule: "/untrusted:untrusted",
    });
  });

  it("supports async isFolderTrusted", async () => {
    const e = new FolderTrustEvaluator({
      isFolderTrusted: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return true;
      },
    });

    const result = await e.evaluate({
      subject: "u", action: "write", resource: "f",
      context: { folder: "/async-folder" },
    });

    expect(result?.code).toBe("FOLDER_TRUSTED");
  });

  it("properties: name='folder_trust', priority=30", () => {
    const e = new FolderTrustEvaluator({ isFolderTrusted: () => true });
    expect(e.name).toBe("folder_trust");
    expect(e.priority).toBe(30);
  });
});
