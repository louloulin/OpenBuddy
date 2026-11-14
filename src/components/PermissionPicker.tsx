
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  CheckIcon,
  ShieldCheckIcon,
} from "@openbuddy/ui/icon/icons/index";
import { permissionModeGet, permissionModeSet } from "@openbuddy/client/agent-client";
import { listen } from "@openbuddy/client/ipc";
import { appConfirmWithOption } from "./AppDialog";
import type { PermissionMode } from "@openbuddy/client/agent-client";

const MODES: { id: PermissionMode; label: string; desc: string }[] = [
  { id: "ask", label: "审批模式", desc: "每次工具调用都需要确认" },
  { id: "auto", label: "自动模式", desc: "安全操作自动执行,风险操作询问" },
  { id: "always-approve", label: "完全访问", desc: "不再询问：改文件、删文件、运行命令都自动执行" },
];

export function PermissionPicker({
  onToast,
  triggerLabel,
}: {
  onToast?: (msg: string) => void;
  /** 覆盖触发按钮文字（如本地助理页固定显示「默认权限」）；缺省显示当前模式名。 */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PermissionMode>("ask");
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    permissionModeGet()
      .then(setMode)
      .catch(() => {
        /* 读不到就用默认 ask */
      });
    // Changed elsewhere (another picker, 设置·安全): follow it.
    let off: (() => void) | undefined;
    let gone = false;
    void listen<{ mode?: PermissionMode }>("agent://permission-mode", (e) => { if (e.payload?.mode) setMode(e.payload.mode); }).then((u) => { if (gone) u(); else off = u; }, () => { /* no bridge (tests) */ });
    return () => { gone = true; off?.(); };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = useCallback(
    async (next: PermissionMode) => {
      if (next === mode) {
        setOpen(false);
        return;
      }
      if (next === "always-approve") {
        // 完全访问 skips every confirmation, deletions included: ask twice (U5.5).
        setOpen(false);
        const { ok } = await appConfirmWithOption({
          title: "切换到完全访问？",
          message: "之后 Buddy 改动或删除文件、运行命令都不会再征求你的同意，也包括 rm 这类删除操作。改动仍会留快照，可在工作台还原。只在你信任当前任务和工作空间时使用。",
          confirmLabel: "切换到完全访问",
          danger: true,
          checkbox: { label: "我了解风险，愿意让 Buddy 不经确认执行操作", checked: false, required: true },
        });
        if (!ok) return;
      }
      setBusy(true);
      try {
        await permissionModeSet(next);
        setMode(next);
        setOpen(false);
      } catch (e) {
        onToast?.(`权限模式切换失败:${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(false);
      }
    },
    [mode, onToast],
  );

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <div className="permission-picker" ref={popRef}>
      <button
        type="button"
        className={"wb-composer-meta__btn" + (mode === "always-approve" ? " permission-picker__trigger--full" : "")}
        onClick={() => setOpen((v) => !v)}
        title={`权限模式 · ${current.desc}`}
      >
        <ShieldCheckIcon size="sm" />
        {triggerLabel ?? current.label}
        <ChevronDownIcon size="sm" />
      </button>
      {open && (
        <div className="permission-picker__popover permission-picker__popover--modes" role="menu">
          <div className="permission-picker__header">权限模式</div>
          <div className="permission-picker__modes">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={
                  "permission-picker__mode" +
                  (m.id === mode ? " permission-picker__mode--active" : "")
                }
                onClick={() => select(m.id)}
                disabled={busy}
                role="menuitemradio"
                aria-checked={m.id === mode}
              >
                <span className="permission-picker__mode-label">{m.label}</span>
                <span className="permission-picker__mode-desc">{m.desc}</span>
                {m.id === mode && <CheckIcon size="sm" className="permission-picker__mode-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
