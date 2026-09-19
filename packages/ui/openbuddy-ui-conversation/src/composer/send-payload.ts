/**
 * composer/send-payload — file/image attachment plumbing for the composer.
 *
 * Phase-3 split (goal mu7rpkze-gc769z). These three helpers used to live
 * inline in `Composer.tsx`:
 *   - `readImageFile` — turn a dropped/pasted/picked File into a base64
 *     ImageAttachment, with MIME-type-driven cap (16MB images, 8MB docs).
 *   - `pickFiles`     — open the OS file picker for arbitrary files and
 *     add the chosen paths to the path-attachment set.
 *   - `pickImages`    — open the OS image picker and convert each picked
 *     path into an inline ImageAttachment.
 *
 * Splitting them out keeps the main Composer file under the 800-line cap
 * while leaving the dependencies (openPaths, setAttachments/setImages
 * updaters, onToast) explicit. No React state is owned here — every
 * helper takes the state mutator it needs as an argument.
 */

import { openPaths } from "@/lib/platform/electron-api";
import type { ImageAttachment } from "./types";

const SUPPORTED_IMAGE =
  /^image\/(png|jpe?g|webp|gif)$/i;
const SUPPORTED_DOC =
  /^(application\/pdf|text\/(plain|markdown|csv|html|xml)|application\/(json|xml|yaml)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/i;
const IMAGE_CAP = 16 * 1024 * 1024;
const FILE_CAP = 8 * 1024 * 1024;

/**
 * Read a File (from paste/drop/picker) and convert it to an ImageAttachment
 * that piSendContent can ship through the agent prompt. Returns null when
 * the file is not a supported MIME type or exceeds the per-flavour cap.
 */
export function readImageFile(
  file: File,
  onToast?: (msg: string) => void,
): Promise<ImageAttachment | null> {
  return new Promise((resolve) => {
    let kind: "image" | "file";
    let cap: number;
    let capLabel: string;
    if (SUPPORTED_IMAGE.test(file.type)) {
      kind = "image";
      cap = IMAGE_CAP;
      capLabel = "16MB";
    } else if (SUPPORTED_DOC.test(file.type)) {
      kind = "file";
      cap = FILE_CAP;
      capLabel = "8MB";
    } else {
      onToast?.(`不支持的文件类型: ${file.type || "未知"}（图片/文档）`);
      return resolve(null);
    }
    if (file.size > cap) {
      onToast?.(`附件过大(>${capLabel}),已拒绝：${file.name || file.type}`);
      return resolve(null);
    }
    const reader = new FileReader();
    reader.onerror = () => {
      onToast?.("读取附件失败");
      resolve(null);
    };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return resolve(null);
      // result is a data URL like "data:image/png;base64,XXXX"; strip the
      // prefix so the IPC payload is just the raw base64.
      const comma = result.indexOf(",");
      if (comma === -1) return resolve(null);
      const data = result.slice(comma + 1);
      resolve({
        id: `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        mediaType: file.type,
        data,
        name: file.name || undefined,
        kind,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Add file paths to the path-attachment set via the OS file picker. */
export async function pickFiles(
  setAttachments: (updater: (prev: string[]) => string[]) => void,
): Promise<void> {
  try {
    const paths = await openPaths({ multiple: true });
    if (paths.length === 0) return;
    setAttachments((prev) => {
      const set = new Set(prev);
      paths.forEach((p) => set.add(p));
      return [...set];
    });
  } catch {
    // dialog plugin not available in non-Electron-compatible env (vitest) — no-op.
  }
}

/**
 * Open the OS image picker and convert each picked path into an inline
 * ImageAttachment. Path → File → readImageFile → setImages.
 */
export async function pickImages(
  setImages: (updater: (prev: ImageAttachment[]) => ImageAttachment[]) => void,
  onToast?: (msg: string) => void,
): Promise<void> {
  try {
    const paths = await openPaths({
      multiple: true,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    if (paths.length === 0) return;
    for (const p of paths) {
      try {
        const fileUrl = p.startsWith("file:") ? p : `file://${p}`;
        const resp = await fetch(fileUrl);
        const blob = await resp.blob();
        const ext = p.split(".").pop()?.toLowerCase() ?? "";
        const mime = blob.type || (ext === "jpg" ? "image/jpeg" : `image/${ext}`);
        const file = new File([blob], p.split(/[\\/]/).pop() ?? "image", { type: mime });
        const img = await readImageFile(file, onToast);
        if (img) setImages((prev) => [...prev, img]);
      } catch (err) {
        onToast?.(`无法读取图片:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch {
    // dialog plugin not available in non-Electron-compatible env (vitest) — no-op.
  }
}