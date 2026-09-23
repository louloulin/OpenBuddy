/**
 * ComposerOverlays — non-interactive overlays rendered above the composer card.
 *
 * Contains:
 *   - `ComposerSetupHint`: full-card button that fires when API is not ready.
 *     Visible text is sr-only; placeholder on the textarea already says the
 *     same thing, so visually we only render the click hotspot.
 *   - `ComposerDropzone`: drag-active overlay shown while a file is being
 *     dragged over the card. Provides the "松手以添加文件" hint.
 *
 * Both are pure presentational: no hooks, no store, no children. They sit
 * on top of the textarea via `position: absolute; inset: 0` and never
 * capture focus.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function ComposerSetupHint({
  visible,
  onOpenSettings,
}: {
  visible: boolean;
  onOpenSettings?: () => void;
}) {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="wb-composer__setup-hint"
      onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenSettings?.();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onOpenSettings?.();
      }}
    >
      {/* R30 — this button covers the entire card; visible label is sr-only
          because the textarea placeholder already says the same thing. */}
      <span className="wb-sr-only">请先配置 API Key 开始使用</span>
    </button>
  );
}

export function ComposerDropzone({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="wb-composer__dropzone" role="status" aria-live="polite">
      <span className="wb-composer__dropzone-text">松开以添加文件到对话</span>
    </div>
  );
}
