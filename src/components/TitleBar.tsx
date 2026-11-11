import { useState, useEffect } from "react";
import { win as windowControls } from "@/lib/ipc";
import { XCloseIcon } from "@/foundation/components/Icon/icons";
import logoMarkUrl from "@/assets/openbuddy-logo.svg";

interface MenuItem {
  label: string;
  action?: "minimize" | "maximize" | "close";
  /** Maps the item to a `document.execCommand` action (editing menu). */
  edit?: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
  /** Opens the About dialog. */
  about?: boolean;
}
const MENUS: Record<string, MenuItem[]> = {
  编辑: [
    { label: "撤销", edit: "undo" },
    { label: "重做", edit: "redo" },
    { label: "剪切", edit: "cut" },
    { label: "复制", edit: "copy" },
    { label: "粘贴", edit: "paste" },
    { label: "全选", edit: "selectAll" },
  ],
  窗口: [
    { label: "最小化", action: "minimize" },
    { label: "最大化", action: "maximize" },
    { label: "关闭", action: "close" },
  ],
  帮助: [{ label: "关于 OpenBuddy", about: true }],
};

// 最小化图标
const MinimizeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
  </svg>
);

// 最大化/还原图标
const MaximizeIcon = ({ isMaximized }: { isMaximized: boolean }) => {
  if (isMaximized) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <rect x="3" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="none" />
        <rect x="1" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1" fill="var(--wb-bg-primary)" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1" width="10" height="10" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
};

async function win(action: "minimize" | "maximize" | "close") {
  try {
    const w = windowControls;
    if (action === "minimize") await w.minimize();
    else if (action === "maximize") await w.toggleMaximize();
    else await w.close();
  } catch {
  }
}

/** Insert text at the cursor position of the currently focused editable
 *  element (textarea/input). Used by the Edit → Paste menu item. Falls back
 *  to execCommand('insertText') when available so undo history is preserved. */
function insertTextAtFocus(text: string) {
  const el = document.activeElement as HTMLTextAreaElement | HTMLInputElement | null;
  if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) {
    // No text target focused — try execCommand as a generic fallback.
    try {
      document.execCommand("insertText", false, text);
    } catch {
      /* ignore */
    }
    return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);
  el.value = next;
  const caret = start + text.length;
  el.selectionStart = el.selectionEnd = caret;
  // React-controlled inputs need a native input event to update state.
  el.dispatchEvent(new Event("input", { bubbles: true }));
}


export function TitleBar({
  onPlaceholder,
  onShowAbout,
}: {
  onPlaceholder: (label: string) => void;
  onShowAbout?: () => void;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void windowControls.isMaximized().then(value => {
        if (!disposed) setIsMaximized(value);
      }).catch(() => {});
    };
    let unlisten: (() => void) | undefined;
    refresh();
    try { unlisten = windowControls.onResized(refresh); } catch { /* Browser preview. */ }
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const runItem = (item: MenuItem) => {
    setOpenMenu(null);
    if (item.action) {
      win(item.action);
      return;
    }
    if (item.edit) {
      // Editing commands operate on the focused editable element (textarea,
      // input). execCommand is deprecated but still the only API that works
      // webview. For paste, prefer the async Clipboard API (execCommand paste
      // is blocked in non-secure contexts).
      if (item.edit === "paste") {
        navigator.clipboard
          ?.readText()
          .then((text) => insertTextAtFocus(text))
          .catch(() => {
            /* clipboard permission denied — silent */
          });
      } else {
        try {
          document.execCommand(item.edit);
        } catch {
          /* no editable focus — silent */
        }
      }
      return;
    }
    if (item.about) {
      onShowAbout?.();
      return;
    }
    onPlaceholder(item.label);
  };

  return (
    <div className="titlebar" data-window-drag-region>
      <div className="titlebar__menus" data-window-drag-region>
        <button
          className="titlebar__brand"
          onClick={() => onShowAbout?.()}
          aria-label="OpenBuddy"
          title="关于 OpenBuddy"
        >
          <img
            src={logoMarkUrl}
            alt=""
            width={18}
            height={18}
            className="titlebar__brand-logo"
          />
          <span>OpenBuddy</span>
        </button>
        {Object.keys(MENUS).map((name) => (
          <div key={name} className="titlebar__menu-wrap">
            <button
              className={"titlebar__menu" + (openMenu === name ? " titlebar__menu--open" : "")}
              onClick={() => setOpenMenu(openMenu === name ? null : name)}
              aria-label={name}
            >
              {name}
            </button>
            {openMenu === name && (
              <>
                <div className="titlebar__backdrop" onClick={() => setOpenMenu(null)} />
                <div className="titlebar__dropdown" role="menu">
                  {MENUS[name].map((item) => (
                    <button
                      key={item.label}
                      className="titlebar__dropdown-item"
                      onClick={() => runItem(item)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* 弹性空间 - 用于拖拽 */}
      <div className="titlebar__spacer" data-window-drag-region />

      {/* 窗口控制按钮 */}
      <div className="titlebar__controls">
        <button
          className="titlebar__control titlebar__control--minimize"
          onClick={() => win("minimize")}
          title="最小化"
        >
          <MinimizeIcon />
        </button>
        <button
          className="titlebar__control titlebar__control--maximize"
          onClick={() => win("maximize")}
          title={isMaximized ? "还原" : "最大化"}
        >
          <MaximizeIcon isMaximized={isMaximized} />
        </button>
        <button
          className="titlebar__control titlebar__control--close"
          onClick={() => win("close")}
          title="关闭"
        >
          <XCloseIcon size="sm" />
        </button>
      </div>
    </div>
  );
}
