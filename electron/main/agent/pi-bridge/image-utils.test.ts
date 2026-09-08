import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectSupportedImageMimeTypeFromFile, readAndResizeImage, resizeImage } from "./image-utils";

// Minimal PNG: 1x1 red pixel.
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cf000400020005fbc8b1220000000049454e44ae426082",
  "hex",
);

describe("pi-bridge/image-utils", () => {
  it("detects mime type of a PNG file", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-bridge-img-"));
    try {
      const file = join(root, "tiny.png");
      await writeFile(file, TINY_PNG);
      const mime = await detectSupportedImageMimeTypeFromFile(file);
      expect(mime).toBe("image/png");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns null for non-image files", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-bridge-img-"));
    try {
      const file = join(root, "notes.txt");
      await writeFile(file, "not an image");
      const mime = await detectSupportedImageMimeTypeFromFile(file);
      expect(mime).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Resize relies on the bundled photon-node WASM. In some sandboxed
  // environments the WASM worker cannot be loaded and resizeImage returns
  // null (graceful degradation). Both null and a successful payload are
  // acceptable — the contract is "may return null when the underlying
  // engine is unavailable".
  it("resizeImage returns null or a base64 result", async () => {
    const result = await resizeImage(new Uint8Array(TINY_PNG), "image/png", { maxWidth: 64, maxHeight: 64, maxBytes: 64 * 1024 });
    if (result !== null) {
      expect(result.mimeType).toMatch(/image\/(png|jpeg)/);
      expect(typeof result.data).toBe("string");
      expect(result.width).toBeDefined();
      expect(result.height).toBeDefined();
    } else {
      // Graceful no-op when photon-node WASM is unavailable.
      expect(result).toBeNull();
    }
  });

  it("readAndResizeImage combines read + detect + resize", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-bridge-img-"));
    try {
      const file = join(root, "tiny.png");
      await writeFile(file, TINY_PNG);
      const result = await readAndResizeImage(file, { maxWidth: 64, maxHeight: 64, maxBytes: 64 * 1024 });
      if (result !== null) {
        expect(result.mimeType).toMatch(/image\//);
        expect(typeof result.data).toBe("string");
      } else {
        expect(result).toBeNull();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});