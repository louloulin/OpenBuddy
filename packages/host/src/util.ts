import { object } from "@openbuddy/services/settings/settings";
import type { PiEngine } from "@openbuddy/engine/pi-engine";
/** A list of non-empty strings (queued prompts). */
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) throw Error("invalid_payload: list");
  return value as string[];
}
export function trustedImages(
  value: unknown,
): NonNullable<Parameters<PiEngine["send"]>[2]> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw Error("invalid_images");
  let total = 0;
  return value.map((raw) => {
    const image = object(raw);
    if (
      image.type !== "image" ||
      typeof image.data !== "string" ||
      !image.data ||
      image.data.length > 14 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) ||
      !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
        String(image.mimeType),
      )
    )
      throw Error("invalid_images");
    total += image.data.length;
    if (total > 28 * 1024 * 1024) throw Error("images_too_large");
    return {
      type: "image" as const,
      data: image.data,
      mimeType: String(image.mimeType),
    };
  });
}
export function promptText(p: Record<string, unknown>) {
  if (
    typeof p.text !== "string" ||
    p.text.includes("\0") ||
    (!p.text.trim() && !Array.isArray(p.images))
  )
    throw Error("invalid_prompt");
  return p.text;
}
