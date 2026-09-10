/**
 * GlobalConfirmHost — renders the single pending request from
 * `useGlobalConfirmStore` using the workbuddy-style `ConfirmDialog`.
 *
 * Mounted once near the top of the React tree (inside App.tsx) so that any
 * code path — settings panels, marketplace, MCP, conversation rewind bar —
 * can fire confirmations through the same visual surface without each
 * panel having to manage its own `requestConfirm` state. This replaces the
 * legacy `await confirm(message)` helper that opened the native
 * `dialog.showMessageBox`.
 */
import { useGlobalConfirmStore } from "@/stores/global-confirm-store";
import { ConfirmDialog } from "@openbuddy/ui-dialogs";

export function GlobalConfirmHost(): React.ReactElement | null {
  const pending = useGlobalConfirmStore((state) => state.pending);
  const resolve = useGlobalConfirmStore((state) => state.resolve);
  if (!pending) return null;
  return (
    <ConfirmDialog
      open
      title={pending.title}
      {...(pending.description === undefined ? {} : { description: pending.description })}
      {...(pending.tone === undefined ? {} : { tone: pending.tone })}
      {...(pending.confirmLabel === undefined ? {} : { confirmLabel: pending.confirmLabel })}
      cancelLabel={pending.cancelLabel ?? "取消"}
      onConfirm={() => resolve(pending.id, true)}
      onCancel={() => resolve(pending.id, false)}
    />
  );
}