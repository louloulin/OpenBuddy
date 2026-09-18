/**
 * composer/use-composer-attachments.ts — Composer 附件相关 state + handlers 钩子
 *
 * P0-1 拆分（见 docs/plan/06-roadmap.md）：把 Composer.tsx（1421 行 → ~1230 行）
 * 中**所有与"附件 / 图片 / 拖拽"相关**的 state + handlers 抽到独立钩子。
 * 抽出后 Composer 只消费这些返回值，自身不再持有这些 state。
 *
 * 设计要点：
 *  - **零 JSX 依赖**：本钩子只导出 state + handlers，不渲染任何东西，
 *    因此可被 Composer.tsx 在文件顶部 `ComposerInner()` 内直接调用，不需要
 *    任何 prop drilling 或 context。
 *  - **状态机完全等价**：抽出后 Composer 的渲染结果、副作用、回调时序
 *    与抽出前**逐字节等价**（line coverage 不变，scoped vitest 不需改）。
 *  - **依赖镜像**：imagesRef 与 useEffect 同步的"写法原样照搬"，避免引入
 *    「ref 不同步导致 paste/drop 时丢图」之类的回归。
 *
 * 抽出范围（原 Composer.tsx 行号）：
 *  - attachments / images state + imagesRef + sync effect（line 213-219）
 *  - readImageFile（line 448-511）
 *  - pickFiles（line 593-609）
 *  - pickImages（line 610-647）
 *  - drag effect（line 648-714）
 */

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { openPaths, getCurrentWebview } from "@/lib/platform/electron-api";
import {
  collectDroppedPaths,
  isDragDrop,
  isDragHovering,
  type DragDropEvent,
} from "@/lib/files/drop-utils";
import type { ImageAttachment } from "./types";

export type UseComposerAttachmentsOptions = {
  /** Toast 通道：文件类型不支持 / 过大 / 读取失败时调用 */
  onToast?: (msg: string) => void;
};

export type UseComposerAttachmentsResult = {
  /** 当前已附加的文件绝对路径列表（OS picker / 拖拽 / 粘贴统一汇入这里） */
  attachments: string[];
  setAttachments: Dispatch<SetStateAction<string[]>>;
  /** 当前已附加的图片附件（base64 内嵌，会随消息一起发给 agent） */
  images: ImageAttachment[];
  setImages: Dispatch<SetStateAction<ImageAttachment[]>>;
  /** images 的镜像 ref —— 用于在 effect / async 回调里读到最新数组 */
  imagesRef: MutableRefObject<ImageAttachment[]>;
  /** 拖拽遮罩是否高亮（Electron-compatible webview 原生 drag-drop） */
  dragActive: boolean;
  /** OS 文件选择器（任意文件）；通过 openPaths + setAttachments 入队 */
  pickFiles: () => Promise<void>;
  /** OS 文件选择器（仅图片）；fetch file:// → readImageFile → setImages 入队 */
  pickImages: () => Promise<void>;
  /** File → ImageAttachment 转换（含大小 / 类型校验 + base64 dataURL 剥离） */
  readImageFile: (file: File) => Promise<ImageAttachment | null>;
};

const SUPPORTED_IMAGE =
  /^image\/(png|jpe?g|webp|gif)$/i;
const SUPPORTED_DOC =
  /^(application\/pdf|text\/(plain|markdown|csv|html|xml)|application\/(json|xml|yaml)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation))$/i;
const IMAGE_CAP = 16 * 1024 * 1024;
const FILE_CAP = 8 * 1024 * 1024;

export function useComposerAttachments(
  { onToast }: UseComposerAttachmentsOptions = {},
): UseComposerAttachmentsResult {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const imagesRef = useRef<ImageAttachment[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  const [dragActive, setDragActive] = useState(false);

  const readImageFile = (file: File): Promise<ImageAttachment | null> => {
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
  };

  const pickFiles = async () => {
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
  };

  const pickImages = async () => {
    try {
      const paths = await openPaths({
        multiple: true,
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      if (paths.length === 0) return;
      // Resolve each path to a File via fetch. The preload bridge returns
      // a file:// URL we can fetch in the renderer. In test environments
      // (no Electron) fetch will reject — we surface a toast and continue.
      for (const p of paths) {
        try {
          // Use a fetch with file:// to read the bytes; this is supported
          // when the page is loaded from a file:// origin or has the
          // necessary permission via Electron.
          const fileUrl = p.startsWith("file:") ? p : `file://${p}`;
          const resp = await fetch(fileUrl);
          const blob = await resp.blob();
          const ext = p.split(".").pop()?.toLowerCase() ?? "";
          const mime = blob.type || (ext === "jpg" ? "image/jpeg" : `image/${ext}`);
          const file = new File([blob], p.split(/[\\/]/).pop() ?? "image", { type: mime });
          const img = await readImageFile(file);
          if (img) setImages((prev) => [...prev, img]);
        } catch (err) {
          onToast?.(`无法读取图片:${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch {
      // dialog plugin not available in non-Electron-compatible env (vitest) — no-op.
    }
  };

  // ---------- 拖拽文件附件（对齐 WorkBuddy drop-zone）----------
  // Electron-compatible webview 的 DOM onDrop 拿不到本地文件绝对路径（只给 File blob），
  // 必须用原生 drag-drop 事件。enter/over 显示遮罩；drop 收集路径并入附件；
  // leave 隐藏遮罩。非 Electron-compatible 环境（vitest）getCurrentWebview 会抛错，安全降级。
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    try {
      const webview = getCurrentWebview();
      webview
        .onDragDropEvent((event) => {
          // Electron-compatible 把 DragDropEvent 包在 Event<T>.payload 里。
          const e = event.payload as DragDropEvent;
          if (isDragDrop(e)) {
            const incoming = collectDroppedPaths(e.paths);
            if (incoming.length > 0) {
              setAttachments((prev) => {
                const seen = new Set(prev);
                const out = [...prev];
                for (const p of incoming) {
                  if (!seen.has(p)) {
                    seen.add(p);
                    out.push(p);
                  }
                }
                return out;
              });
            }
            setDragActive(false);
          } else {
            setDragActive(isDragHovering(e));
          }
        })
        .then((un) => {
          if (cancelled) {
            // 组件已卸载，立刻解绑。
            try {
              un();
            } catch {
              /* noop */
            }
          } else {
            unlisten = un;
          }
        })
        .catch(() => {
          /* 非 Electron-compatible 环境无此事件 — 静默降级 */
        });
    } catch {
      /* getCurrentWebview 在非 Electron-compatible 环境抛错 — 静默降级 */
    }
    return () => {
      cancelled = true;
      if (unlisten) {
        try {
          unlisten();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return {
    attachments,
    setAttachments,
    images,
    setImages,
    imagesRef,
    dragActive,
    pickFiles,
    pickImages,
    readImageFile,
  };
}
