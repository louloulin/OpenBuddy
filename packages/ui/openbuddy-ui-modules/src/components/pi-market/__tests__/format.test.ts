import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  buildSearchBlob,
  formatDownloads,
  formatRelative,
  formatSize,
  previewAccent,
} from "../format";

describe("format", () => {
  describe("formatDownloads", () => {
    it("returns undefined for invalid input", () => {
      expect(formatDownloads(undefined)).toBeUndefined();
      expect(formatDownloads(null)).toBeUndefined();
      expect(formatDownloads(-1)).toBeUndefined();
      expect(formatDownloads(Number.NaN)).toBeUndefined();
    });

    it("renders <1K as integer/mo", () => {
      expect(formatDownloads(0)).toBe("0/mo");
      expect(formatDownloads(123)).toBe("123/mo");
      expect(formatDownloads(999)).toBe("999/mo");
    });

    it("renders thousands as K/mo with one decimal when <10K", () => {
      expect(formatDownloads(1_000)).toBe("1K/mo");
      expect(formatDownloads(1_500)).toBe("1.5K/mo");
      expect(formatDownloads(9_500)).toBe("9.5K/mo");
      expect(formatDownloads(10_000)).toBe("10K/mo");
    });

    it("renders millions as M/mo", () => {
      expect(formatDownloads(1_000_000)).toBe("1M/mo");
      expect(formatDownloads(1_500_000)).toBe("1.5M/mo");
      expect(formatDownloads(22_600_000)).toBe("23M/mo");
      expect(formatDownloads(50_000_000)).toBe("50M/mo");
    });
  });

  describe("formatRelative", () => {
    const NOW = new Date("2026-09-23T12:00:00.000Z");
    it("returns undefined for invalid input", () => {
      expect(formatRelative(undefined, NOW)).toBeUndefined();
      expect(formatRelative(null, NOW)).toBeUndefined();
      expect(formatRelative("", NOW)).toBeUndefined();
    });

    it("renders seconds / minutes / hours / days / months / years", () => {
      expect(formatRelative(new Date("2026-09-23T11:59:30Z"), NOW)).toMatch(/s ago/);
      expect(formatRelative(new Date("2026-09-23T11:55:00Z"), NOW)).toBe("5m ago");
      expect(formatRelative(new Date("2026-09-23T10:00:00Z"), NOW)).toBe("2h ago");
      expect(formatRelative(new Date("2026-09-22T12:00:00Z"), NOW)).toBe("1d ago");
      expect(formatRelative(new Date("2026-08-15T12:00:00Z"), NOW)).toMatch(/mo ago/);
      expect(formatRelative(new Date("2024-09-23T12:00:00Z"), NOW)).toMatch(/y ago/);
    });
  });

  describe("buildInstallCommand", () => {
    it("prefers npmName when present", () => {
      expect(buildInstallCommand("pi-mcp-adapter", "x")).toBe("pi install npm:pi-mcp-adapter");
    });

    it("falls back to id when npmName missing", () => {
      expect(buildInstallCommand(undefined, "scope/plugin")).toBe(
        "pi install npm:scope/plugin",
      );
    });
  });

  describe("previewAccent", () => {
    it("falls back to the theme accent for empty seed", () => {
      expect(previewAccent("", "red")).toBe("red");
    });

    it("is deterministic per seed", () => {
      expect(previewAccent("alpha", "x")).toBe(previewAccent("alpha", "x"));
      expect(previewAccent("alpha", "x")).not.toBe(previewAccent("beta", "x"));
    });
  });

  describe("buildSearchBlob", () => {
    it("concatenates truthy parts lowercased", () => {
      expect(buildSearchBlob(["Foo", null, "BAR", "", "  baz  "])).toBe("foo bar baz");
    });
  });

  describe("formatSize", () => {
    it("returns undefined for invalid input", () => {
      expect(formatSize(undefined)).toBeUndefined();
      expect(formatSize(-1)).toBeUndefined();
    });
    it("renders human sizes", () => {
      expect(formatSize(0)).toBe("0 B");
      expect(formatSize(512)).toBe("512 B");
      expect(formatSize(2048)).toBe("2 KB");
      expect(formatSize(2_500_000)).toBe("2.4 MB");
    });
  });
});
