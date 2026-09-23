/**
 * ComposerChips — small presentational chips displayed above the textarea
 * (Beneath the dropzone overlay).
 *
 * Contains:
 *   - `ComposerBlocks`: multi-block reference chip row shown when the user
 *     pasted @mentions / file refs / slash commands (WorkBuddy content-blocks).
 *   - `ComposerAttachmentChips`: file-path chips for attached documents,
 *     each with a remove button.
 *   - `ComposerImageAttachmentChips`: image thumbnails with remove buttons.
 *
 * Each chip-row is a focused, testable unit. The parent owns the state
 * (`setAttachments`, `setImages`) so we keep callbacks one-directional.
 */
import { X } from "lucide-react";
import type { ImageAttachment } from "../Composer";
import { blockLabel, type ContentBlock } from "@/lib/markdown/content-blocks";

export function ComposerBlocks({
  blocks,
  fullTitle,
}: {
  blocks: readonly ContentBlock[];
  fullTitle?: string;
}) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <div className="composer-blocks" title={fullTitle}>
      {blocks.map((b) => (
        <span key={b.id} className="composer-blocks__chip">
          {blockLabel(b)}
        </span>
      ))}
    </div>
  );
}

export function ComposerAttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: readonly string[];
  onRemove: (path: string) => void;
}) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="composer-attachments">
      {attachments.map((path) => (
        <span key={path} className="composer-attachments__chip" title={path}>
          <span className="composer-attachments__chip-name">
            {path.replace(/\\/g, "/").split("/").pop()}
          </span>
          <button
            type="button"
            className="composer-attachments__chip-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(path);
            }}
            aria-label="移除附件"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ComposerImageAttachmentChips({
  images,
  onRemove,
}: {
  images: readonly ImageAttachment[];
  onRemove: (id: string) => void;
}) {
  if (!images || images.length === 0) return null;
  return (
    <div className="composer-image-attachments" role="list" aria-label="图片附件">
      {images.map((img) => (
        <span
          key={img.id}
          className="composer-image-attachments__chip"
          title={img.name ?? img.mediaType}
          role="listitem"
        >
          <img
            className="composer-image-attachments__thumb"
            src={`data:${img.mediaType};base64,${img.data}`}
            alt={img.name ?? "pasted image"}
          />
          <span className="composer-image-attachments__name">
            {img.name ?? "pasted image"}
          </span>
          <button
            type="button"
            className="composer-image-attachments__remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(img.id);
            }}
            aria-label="移除图片"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </span>
      ))}
    </div>
  );
}
