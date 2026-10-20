/**
 * ComposerMetaRow — secondary meta line displayed below the composer card
 * (between the card and the disclaimer).
 *
 * Contains:
 *   - Workspace picker (or a "选择工作空间" fallback button)
 *   - Permission picker (only when not already inline-rendered in the footer)
 *
 * Pure presentational: receives `cwd`, `workspaces`, `onSelectWorkspace`,
 * `loading`, `permissionInline`, `onToast`, and `onPlaceholder`.
 */
import type { WorkspaceInfo } from "@/lib/agent/pi-client";
import { WorkspacePicker } from "@openbuddy/ui-shell";
import { PermissionPicker } from "@openbuddy/ui-shared";
import { ChevronDownIcon } from "@openbuddy/ui-primitives/icons";

export function ComposerMetaRow({
  showWorkspacePicker,
  cwd,
  workspaces,
  onSelectWorkspace,
  workspaceLoading,
  permissionInline,
  onToast,
  onPlaceholder,
}: {
  showWorkspacePicker: boolean;
  cwd?: string;
  workspaces?: WorkspaceInfo[];
  // Composer.tsx wires `onSelectWorkspace: (cwd: string) => void`;
  // WorkspacePicker calls us back with the picked workspace's cwd string.
  onSelectWorkspace?: (cwd: string) => void;
  workspaceLoading?: boolean;
  permissionInline: boolean;
  onToast?: (msg: string) => void;
  onPlaceholder?: (action: string) => void;
}) {
  return (
    <div className="wb-composer-meta">
      {showWorkspacePicker ? (
        <WorkspacePicker
          cwd={cwd}
          workspaces={workspaces!}
          onSelectWorkspace={onSelectWorkspace!}
          loading={workspaceLoading}
        />
      ) : (
        <button
          className="wb-composer-meta__btn"
          onClick={() => onPlaceholder?.("选择工作空间")}
        >
          选择工作空间 <ChevronDownIcon size="sm" />
        </button>
      )}
      {!permissionInline && <PermissionPicker onToast={onToast} />}
    </div>
  );
}

export function ComposerDisclaimer({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="wb-composer__disclaimer">内容由 AI 生成，请核实重要信息</div>
  );
}
