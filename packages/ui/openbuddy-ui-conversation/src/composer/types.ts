/**
 * composer/types — 输入区对外/内部共享的类型契约。
 *
 * P0 拆分（见 `docs/plan/06-roadmap.md` P0-1）：`ImageAttachment` 从
 * `Composer.tsx` 抽出，**纯移动，逻辑零改动**。抽出后 `use-composer-attachments`
 * 与 `Composer` 共享同一份类型，避免循环引用。
 *
 * 注：`Composer.tsx` 仍以 `export type { ImageAttachment }` 形式转出，
 * 保持既有导入路径可用（向后兼容）。
 */

/** Single attachment bundled into a `piSendContent` prompt. The renderer
 *  converts dropped/pasted files into base64 once at attach time so the IPC
 *  payload is a deterministic shape.
 *
 *  Two flavours: `image` (png/jpeg/webp/gif, ≤16MB) and `file` (PDF /
 *  plain text / markdown / json / xml / docx, ≤8MB). `file` attachments
 *  are forwarded to the LLM as a single base64 part; the agent side
 *  parses the type and either inlines the text content or hands the
 *  binary to its own reader. */
export type ImageAttachment = {
  id: string;
  /** MIME type. For images: image/{png,jpeg,webp,gif}. For documents:
   *  application/pdf, text/plain, text/markdown, application/json,
   *  application/xml, or application/vnd.openxmlformats-officedocument.wordprocessingml.document. */
  mediaType: string;
  data: string;
  name?: string;
  /** "image" for visual models, "file" for documents. The composer emits
   *  one piSendContent part per attachment; the IPC contract maps both
   *  to the same Anthropic `image` block today, but the discriminator
   *  lets us route PDFs to a base64-PDF reader later without breaking
   *  the wire format. */
  kind: "image" | "file";
};
