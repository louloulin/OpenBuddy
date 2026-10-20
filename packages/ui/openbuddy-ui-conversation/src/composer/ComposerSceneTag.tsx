/**
 * ComposerSceneTag — small "操作类型" chip displayed above the textarea
 * once the home page picks a capability category.
 *
 * Pure presentational: shows the scene's icon + label, plus a × button
 * that calls `onRemove`. No store reads.
 */
import { X, type LucideIcon } from "lucide-react";

export function ComposerSceneTag({
  sceneTag,
  onClear,
}: {
  sceneTag: { label: string; icon: LucideIcon } | null | undefined;
  onClear?: () => void;
}) {
  if (!sceneTag) return null;
  const Icon = sceneTag.icon;
  return (
    <div
      className="wb-composer__scene-tag"
      role="group"
      aria-label={`操作类型 ${sceneTag.label}`}
    >
      <span className="wb-composer__scene-tag-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="wb-composer__scene-tag-text">{sceneTag.label}</span>
      <button
        type="button"
        className="wb-composer__scene-tag-remove"
        aria-label={`移除 ${sceneTag.label}`}
        onClick={(e) => {
          e.stopPropagation();
          onClear?.();
        }}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
}
