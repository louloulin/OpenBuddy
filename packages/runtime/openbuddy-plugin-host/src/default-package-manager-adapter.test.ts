/**
 * G3 PR 2 — adapter tests (specifier classification + error aggregation).
 *
 * Covers three guarantees from plan4.1.md §9.23:
 *   1. `classifySpecifier` returns the right `SpecifierKind` for each
 *      specifier family (npm, git-https, git-ssh, github, tarball,
 *      file:, local-directory).
 *   2. `defaultProfilePackageManager.install` aggregates pi + pnpm
 *      failures into an `AggregateError` whose `.errors` carries both
 *      original rejections and whose `message` mentions the classified
 *      specifier kind.
 *   3. The `lastInstallResult` side-channel is updated with the
 *      `channel: "both-failed"` snapshot when both paths fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifySpecifier,
  type SpecifierKind,
} from "./default-package-manager-adapter";

const SPECIFIER_CASES: Array<[string, SpecifierKind]> = [
  ["npm:pi-context-prune@1.3.0", "npm"],
  ["@openbuddy/plugin-x@1.0.0", "npm"],
  ["plain-name", "npm"],
  ["git+https://github.com/x/y.git", "git-https"],
  ["https://example.com/x.git", "git-https"],
  ["git+ssh://git@github.com/x/y.git", "git-ssh"],
  ["git@github.com:x/y.git", "git-ssh"],
  ["github:openbuddy/plugin-y", "github"],
  ["tarball-https://example.com/x.tgz", "tarball-https"],
  ["tarball+https://example.com/x.tgz", "tarball-https"],
  ["https://example.com/x.tgz", "tarball-https"],
  ["https://example.com/x.tar.gz", "tarball-https"],
  ["file:../local-plugin", "file"],
  ["./local-plugin", "local-directory"],
  ["../shared-plugin", "local-directory"],
  ["/abs/path/plugin", "local-directory"],
  ["", "unknown"],
  ["!!!", "unknown"],
];

describe("classifySpecifier", () => {
  for (const [input, expected] of SPECIFIER_CASES) {
    it(`classifies ${JSON.stringify(input)} as ${expected}`, () => {
      expect(classifySpecifier(input)).toBe(expected);
    });
  }
});

describe("defaultProfilePackageManager.install (Round 33 PR 2 error aggregation)", () => {
  let pmInstallMock: ReturnType<typeof vi.fn>;
  let pmConstructorMock: ReturnType<typeof vi.fn>;
  let execFileMock: ReturnType<typeof vi.fn>;
  let SettingsManagerCreateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pmInstallMock = vi.fn();
    pmConstructorMock = vi.fn().mockImplementation(function FakePM(this: Record<string, unknown>) {
      this.install = pmInstallMock;
      this.remove = pmInstallMock;
    });
    execFileMock = vi.fn();
    SettingsManagerCreateMock = vi.fn().mockReturnValue({});
    vi.doMock("@earendil-works/pi-coding-agent", () => ({
      DefaultPackageManager: pmConstructorMock,
      SettingsManager: { create: SettingsManagerCreateMock },
    }));
    vi.doMock("node:child_process", () => ({ execFile: execFileMock, default: { execFile: execFileMock } }));
    vi.doMock("node:util", () => ({
      promisify: () => (...args: unknown[]) => execFileMock(...args),
      default: { promisify: () => (...args: unknown[]) => execFileMock(...args) },
    }));
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("@earendil-works/pi-coding-agent");
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:util");
    vi.resetModules();
  });

  it("records channel=pi when DefaultPackageManager.install succeeds", async () => {
    pmInstallMock.mockResolvedValueOnce(undefined);
    const adapter = await import("./default-package-manager-adapter");
    await adapter.defaultProfilePackageManager.install("/tmp/profile", "npm:foo@1.0.0");
    expect(adapter.lastInstallResult).toMatchObject({ ok: true, channel: "pi", specifier: "npm" });
    expect(pmInstallMock).toHaveBeenCalledWith("npm:foo@1.0.0", { local: true });
  });

  it("falls back to pnpm when pi rejects, recording channel=pnpm-fallback", async () => {
    pmInstallMock.mockRejectedValueOnce(new Error("pi: unknown specifier"));
    execFileMock.mockResolvedValueOnce({ stdout: "", stderr: "" });
    const adapter = await import("./default-package-manager-adapter");
    await adapter.defaultProfilePackageManager.install("/tmp/profile", "git+https://github.com/x/y.git");
    expect(adapter.lastInstallResult).toMatchObject({
      ok: true,
      channel: "pnpm-fallback",
      specifier: "git-https",
      piError: expect.stringContaining("pi: unknown specifier"),
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "pnpm",
      expect.arrayContaining(["add", "git+https://github.com/x/y.git"]),
      expect.objectContaining({ cwd: "/tmp/profile" }),
    );
  });

  it("aggregates pi + pnpm errors into AggregateError when both fail", async () => {
    pmInstallMock.mockRejectedValueOnce(new Error("pi: strict specifier rejected"));
    execFileMock.mockRejectedValueOnce(new Error("pnpm: ENOENT no such file"));
    const adapter = await import("./default-package-manager-adapter");
    let caught: unknown;
    try {
      await adapter.defaultProfilePackageManager.install("/tmp/profile", "tarball-https://example.com/x.tgz" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    expect(aggregate.message).toMatch(/tarball-https|profile-package: install failed/);
    expect(aggregate.errors).toHaveLength(2);
    expect(aggregate.errors[0]?.message).toContain("pi: strict specifier rejected");
    expect(aggregate.errors[1]?.message).toContain("pnpm: ENOENT no such file");
    expect(adapter.lastInstallResult).toMatchObject({ ok: false, channel: "both-failed", specifier: "tarball-https" });
  });
});
