/**
 * Tests for the 4 bridge.image helpers added in Round 24 — G4 PR 3
 * (plan4.1.md §9.14): detectImageMime / resizeBridgeImage /
 * resizeBridgeImageFile / convertBridgeImageToPng.
 *
 * Mirrors the text helpers' 4-layer fallback contract. The image
 * domain differs: fallbacks return `null` instead of raw input,
 * matching the underlying bridge contract (see
 * `electron/main/agent/pi-bridge/index.ts:69-105`).
 *
 * Also covers the PiBridgeTextApi.truncateLine type fix landed in
 * this round — `truncateLineText` no longer needs `as never` cast.
 *
 * Exercises the channels
 *   pi-bridge-image:detect-mime
 *   pi-bridge-image:resize
 *   pi-bridge-image:resize-file
 *   pi-bridge-image:convert-to-png
 * which were previously dead (Round 23: 7/14 live = 50%). After this
 * round lands 11/14 = 79%.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  convertBridgeImageToPng,
  detectImageMime,
  resizeBridgeImage,
  resizeBridgeImageFile,
  truncateLineText,
} from "../pi-client";

type ImageBridgeOverrides = {
  detectMime?: (filePath: string) => Promise<string | null>;
  resize?: (
    bytes: Uint8Array,
    mimeType: string,
    opts?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
  ) => Promise<{
    data: string;
    mimeType: string;
    originalWidth?: number;
    originalHeight?: number;
    width?: number;
    height?: number;
    wasResized?: boolean;
    note?: string;
  } | null>;
  resizeFile?: (
    filePath: string,
    opts?: { maxWidth?: number; maxHeight?: number; maxBytes?: number; jpegQuality?: number },
  ) => Promise<{
    data: string;
    mimeType: string;
    width?: number;
    height?: number;
    wasResized?: boolean;
  } | null>;
  convertToPng?: (
    base64Data: string,
    mimeType: string,
  ) => Promise<{ data: string; mimeType: string } | null>;
};

type BridgeBuilder = (overrides?: ImageBridgeOverrides) => {
  text: Record<string, unknown>;
  image: Record<string, unknown>;
  skills: Record<string, unknown>;
};

const buildBridge: BridgeBuilder = (overrides = {}) => {
  const noop = async () => null;
  return {
    text: { parseFrontmatter: noop, stripFrontmatter: noop },
    image: {
      detectMime: overrides.detectMime ?? noop,
      resize: overrides.resize ?? noop,
      resizeFile: overrides.resizeFile ?? noop,
      convertToPng: overrides.convertToPng ?? noop,
    },
    skills: {},
  };
};

describe("Round 24 — G4 PR 3 bridge.image helpers", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    vi.restoreAllMocks();
  });

  // ---------- detectImageMime ----------

  it("detectImageMime: returns null when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await detectImageMime("/tmp/foo.png")).toBeNull();
  });

  it("detectImageMime: delegates to bridge.image.detectMime", async () => {
    const detectMime = vi.fn(async () => "image/png");
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ detectMime }) } };
    const result = await detectImageMime("/tmp/foo.png");
    expect(detectMime).toHaveBeenCalledWith("/tmp/foo.png");
    expect(result).toBe("image/png");
  });

  it("detectImageMime: returns null when bridge throws", async () => {
    const detectMime = vi.fn(async () => {
      throw new Error("ipc down");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ detectMime }) } };
    expect(await detectImageMime("/tmp/foo.png")).toBeNull();
  });

  // ---------- resizeBridgeImage ----------

  it("resizeBridgeImage: returns null when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    expect(await resizeBridgeImage(bytes, "image/jpeg", { maxWidth: 100 })).toBeNull();
  });

  it("resizeBridgeImage: delegates to bridge.image.resize", async () => {
    const payload = { data: "Zm9v", mimeType: "image/png", wasResized: true, width: 80, height: 60 };
    const resize = vi.fn(async () => payload);
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ resize }) } };
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const result = await resizeBridgeImage(bytes, "image/jpeg", { maxWidth: 100, jpegQuality: 85 });
    expect(resize).toHaveBeenCalledWith(bytes, "image/jpeg", { maxWidth: 100, jpegQuality: 85 });
    expect(result?.mimeType).toBe("image/png");
    expect(result?.wasResized).toBe(true);
  });

  it("resizeBridgeImage: returns null when bridge throws", async () => {
    const resize = vi.fn(async () => {
      throw new Error("decode failed");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ resize }) } };
    expect(await resizeBridgeImage(new Uint8Array([1]), "image/jpeg")).toBeNull();
  });

  // ---------- resizeBridgeImageFile ----------

  it("resizeBridgeImageFile: returns null when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await resizeBridgeImageFile("/tmp/foo.jpg", { maxWidth: 200 })).toBeNull();
  });

  it("resizeBridgeImageFile: delegates to bridge.image.resizeFile", async () => {
    const payload = { data: "YmFy", mimeType: "image/png", width: 150, height: 100 };
    const resizeFile = vi.fn(async () => payload);
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ resizeFile }) } };
    const result = await resizeBridgeImageFile("/tmp/foo.jpg", { maxWidth: 200, maxBytes: 65536 });
    expect(resizeFile).toHaveBeenCalledWith("/tmp/foo.jpg", { maxWidth: 200, maxBytes: 65536 });
    expect(result?.width).toBe(150);
  });

  it("resizeBridgeImageFile: returns null when image namespace is empty", async () => {
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: {}, image: {}, skills: {} } },
    };
    expect(await resizeBridgeImageFile("/tmp/foo.jpg")).toBeNull();
  });

  // ---------- convertBridgeImageToPng ----------

  it("convertBridgeImageToPng: returns null when bridge is missing", async () => {
    delete (globalThis as { window?: unknown }).window;
    expect(await convertBridgeImageToPng("aGVsbG8=", "image/jpeg")).toBeNull();
  });

  it("convertBridgeImageToPng: delegates to bridge.image.convertToPng", async () => {
    const out = { data: "aVZCT1J5", mimeType: "image/png" };
    const convertToPng = vi.fn(async () => out);
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ convertToPng }) } };
    const result = await convertBridgeImageToPng("aGVsbG8=", "image/jpeg");
    expect(convertToPng).toHaveBeenCalledWith("aGVsbG8=", "image/jpeg");
    expect(result?.mimeType).toBe("image/png");
  });

  it("convertBridgeImageToPng: returns null when bridge throws", async () => {
    const convertToPng = vi.fn(async () => {
      throw new Error("decoder missing");
    });
    (globalThis as { window?: unknown }).window = { api: { pi: buildBridge({ convertToPng }) } };
    expect(await convertBridgeImageToPng("aGVsbG8=", "image/jpeg")).toBeNull();
  });

  // ---------- truncateLine type fix (Round 24 cleanup) ----------

  it("truncateLineText: opts type allows maxChars after bridge type fix", async () => {
    const truncateLine = vi.fn(async (c: string) => c.slice(0, 5));
    (globalThis as { window?: unknown }).window = {
      api: { pi: { text: { truncateLine }, image: {}, skills: {} } },
    };
    // The fix in pi-bridge-client.ts means we no longer need 'as never'
    // to pass `{ maxChars: N }` through. This test pins the type contract:
    const result = await truncateLineText("hello world", { maxChars: 5 });
    expect(truncateLine).toHaveBeenCalledWith("hello world", { maxChars: 5 });
    expect(result).toBe("hello");
  });
});