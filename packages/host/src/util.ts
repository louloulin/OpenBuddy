import { object } from "@openbuddy/services/settings/settings";
import type { PiEngine } from "@openbuddy/engine/pi-engine";
/** A list of non-empty strings (queued prompts). */
export function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim())) throw Error("invalid_payload: list");
  return value as string[];
}
/**
 * Queued prompts (pii W1.8): a string, or `{ text, images }` after the desktop inline step.
 * The engine re-queues them through Pi's steer / followUp, images included.
 */
export function queueItems(value: unknown): Array<{ text: string; images?: ReturnType<typeof trustedImages> }> {
  if (!Array.isArray(value) || value.length > 50) throw Error("invalid_payload: queue");
  return value.map((raw) => {
    if (typeof raw === "string") {
      if (!raw.trim()) throw Error("invalid_payload: queue");
      return { text: raw };
    }
    const item = object(raw);
    if (typeof item.text !== "string" || !item.text.trim()) throw Error("invalid_payload: queue");
    const images = trustedImages(item.images);
    return images?.length ? { text: item.text, images } : { text: item.text };
  });
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
