import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { DiffBlock } from "./bench/DiffBlock";

/**
 * In-app replacements for window.confirm / window.prompt. Electron does not
 * implement prompt() at all, and the native confirm() box looks foreign, so
 * every confirmation goes through this single host mounted by App.
 */
interface DialogRequest {
  id: number;
  kind: "confirm" | "prompt";
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  defaultValue?: string;
  placeholder?: string;
  checkbox?: { label: string; checked: boolean; required?: boolean };
  /** Show what a write would change before confirming (20261115-ui U1.7). */
  diff?: { before: string; after: string };
  resolve: (value: string | boolean | null, checked?: boolean) => void;
}

interface DialogState {
  queue: DialogRequest[];
  push: (request: DialogRequest) => void;
  settle: (id: number, value: string | boolean | null, checked?: boolean) => void;
}

const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (request) => set({ queue: [...get().queue, request] }),
  settle: (id, value, checked) => {
    const request = get().queue.find((r) => r.id === id);
    set({ queue: get().queue.filter((r) => r.id !== id) });
    request?.resolve(value, checked);
  },
}));

let nextId = 1;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  diff?: { before: string; after: string };
}

export function appConfirm(options: ConfirmOptions | string): Promise<boolean> {
  const o = typeof options === "string" ? { title: options } : options;
  return new Promise((resolve) => {
    useDialogStore.getState().push({ id: nextId++, kind: "confirm", ...o, resolve: (v) => resolve(v === true) });
  });
}

/** Confirm with one extra choice, e.g. "同时还原文件改动" (20261115-ui U2.4). */
/** `required`: the confirm button stays disabled until the box is ticked (risk acknowledgement). */
export function appConfirmWithOption(options: ConfirmOptions & { checkbox: { label: string; checked?: boolean; required?: boolean } }): Promise<{ ok: boolean; checked: boolean }> {
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: nextId++,
      kind: "confirm",
      ...options,
      checkbox: { label: options.checkbox.label, checked: options.checkbox.checked ?? true, required: options.checkbox.required },
      resolve: (v, checked) => resolve({ ok: v === true, checked: !!checked }),
    });
  });
}

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

/** Resolves to the trimmed text, or null when cancelled or left empty. */
export function appPrompt(options: PromptOptions | string): Promise<string | null> {
  const o = typeof options === "string" ? { title: options } : options;
  return new Promise((resolve) => {
    useDialogStore.getState().push({
      id: nextId++,
      kind: "prompt",
      ...o,
      resolve: (v) => resolve(typeof v === "string" && v.trim() ? v.trim() : null),
    });
  });
}

function DialogBox({ request }: { request: DialogRequest }) {
  const settle = useDialogStore((s) => s.settle);
  const [value, setValue] = useState(request.defaultValue ?? "");
  const [checked, setChecked] = useState(request.checkbox?.checked ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancel = () => settle(request.id, request.kind === "confirm" ? false : null, checked);
  const ok = () => settle(request.id, request.kind === "confirm" ? true : value, checked);

  useEffect(() => {
    if (request.kind === "prompt") {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      confirmRef.current?.focus();
    }
  }, [request.kind]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const disabled = (request.kind === "prompt" && !value.trim()) || (!!request.checkbox?.required && !checked);
  return (
    <div className="app-dialog__overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
      <div className={"app-dialog" + (request.diff ? " app-dialog--wide" : "")} role={request.kind === "confirm" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby={`app-dialog-${request.id}`}>
        <div className="app-dialog__title" id={`app-dialog-${request.id}`}>{request.title}</div>
        {request.message && <div className="app-dialog__message">{request.message}</div>}
        {request.diff && <div className="app-dialog__diff"><DiffBlock before={request.diff.before} after={request.diff.after} empty="内容与当前文件相同" /></div>}
        {request.checkbox && (
          <label className="app-dialog__check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>{request.checkbox.label}</span>
          </label>
        )}
        {request.kind === "prompt" && (
          <input
            ref={inputRef}
            className="app-dialog__input"
            value={value}
            placeholder={request.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && !disabled) {
                e.preventDefault();
                ok();
              }
            }}
          />
        )}
        <div className="app-dialog__actions">
          <button type="button" className="app-dialog__btn" onClick={cancel}>{request.cancelLabel ?? "取消"}</button>
          <button
            ref={confirmRef}
            type="button"
            className={"app-dialog__btn " + (request.danger ? "app-dialog__btn--danger" : "app-dialog__btn--primary")}
            onClick={ok}
            disabled={disabled}
          >
            {request.confirmLabel ?? "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounted once by App; shows the oldest pending dialog. */
export function AppDialogHost() {
  const head = useDialogStore((s) => s.queue[0]);
  return head ? <DialogBox key={head.id} request={head} /> : null;
}
