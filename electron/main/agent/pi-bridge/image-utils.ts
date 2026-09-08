/**
 * pi-bridge/image-utils.ts — thin IPC shim around pi's image utilities.
 *
 * Phase A.1 of OPENBUDDY_PI_NATIVE_PLAN.md. The renderer's image pipeline
 * (paste, drag-drop, attachment) routes through these helpers instead of
 * re-implementing mime detection / resize / PNG conversion.
 *
 * NOTE: pi returns base64 strings over the wire (JSON-friendly). We expose
 * both helpers that accept a file path (and read+resize internally) and ones
 * that take raw bytes when the renderer has already loaded them.
 */
import { readFile } from "node:fs/promises";
import {
  resizeImage as piResizeImage,
  convertToPng as piConvertToPng,
  detectSupportedImageMimeTypeFromFile as piDetectSupportedImageMimeTypeFromFile,
  formatDimensionNote as piFormatDimensionNote,
} from "@earendil-works/pi-coding-agent";

export interface ResizedImagePayload {
  /** base64-encoded output bytes. */
  data: string;
  /** Output mime type. */
  mimeType: string;
  /** Original dimensions (pre-resize). */
  originalWidth?: number;
  originalHeight?: number;
  /** Output dimensions (post-resize). */
  width?: number;
  height?: number;
  /** True when the image was actually resized. */
  wasResized?: boolean;
  /** Optional dimension note string for LLM consumption. */
  note?: string;
}

export interface ResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  maxBytes?: number;
  jpegQuality?: number;
}

/** Resize an image (Uint8Array input) and return base64-encoded output. */
export async function resizeImage(
  bytes: Uint8Array,
  mimeType: string,
  options?: ResizeOptions,
): Promise<ResizedImagePayload | null> {
  const result = await piResizeImage(bytes, mimeType, options);
  if (!result) return null;
  return {
    data: result.data,
    mimeType: result.mimeType,
    originalWidth: result.originalWidth,
    originalHeight: result.originalHeight,
    width: result.width,
    height: result.height,
    wasResized: result.wasResized,
    note: piFormatDimensionNote(result),
  };
}

/** Convert a base64 image (any mime) to PNG. Returns base64 + mime. */
export async function convertToPng(
  base64Data: string,
  mimeType: string,
): Promise<{ data: string; mimeType: string } | null> {
  return piConvertToPng(base64Data, mimeType);
}

/** Detect supported image mime type from a file path (async stat + sniff). */
export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
  return piDetectSupportedImageMimeTypeFromFile(filePath);
}

/** Convenience: read a file from disk + resize it in one call. */
export async function readAndResizeImage(
  filePath: string,
  options?: ResizeOptions,
): Promise<ResizedImagePayload | null> {
  const detected = await piDetectSupportedImageMimeTypeFromFile(filePath);
  if (!detected) return null;
  const bytes = await readFile(filePath);
  return resizeImage(bytes, detected, options);
}