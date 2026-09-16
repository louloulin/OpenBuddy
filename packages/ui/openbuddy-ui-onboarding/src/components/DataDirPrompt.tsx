/**
 * @openbuddy/ui-onboarding/DataDirPrompt — 首次启动确认数据目录
 *
 * 完全受控:**不调用任何 IPC**。路径候选由宿主给(`defaultPaths`),用户的选择
 * 通过 `onSubmit(path)` 抛回宿主,写入 / 校验 / 权限检查都在宿主侧完成。
 * 这样同一个组件既能给桌面端用,也能给"远端工作区"这类不同落地方式复用。
 */
import { useEffect, useState } from "react";

import styles from "./DataDirPrompt.module.css";

export interface DataDirPromptProps {
  /** 当前生效的目录(只读展示)。 */
  initialPath?: string;
  /** 候选目录(一键切换),通常是"默认位置 / 上次位置 / 外接盘"。 */
  defaultPaths?: string[];
  onSubmit(path: string): void;
  onCancel?(): void;
  busy?: boolean;
  /** 宿主校验失败的原因(与组件内部的空值校验合并展示)。 */
  error?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  placeholder?: string;
  className?: string;
}

export function DataDirPrompt({
  initialPath,
  defaultPaths,
  onSubmit,
  onCancel,
  busy = false,
  error,
  title = "OpenBuddy 把文件放在哪里?",
  description = "会话、工作区文件与产物都会保存在这个目录里。可以随时在设置中更改。",
  confirmLabel = "使用此目录",
  placeholder = "/Users/you/OpenBuddy",
  className,
}: DataDirPromptProps) {
  const [value, setValue] = useState(() => initialPath ?? defaultPaths?.[0] ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  // 宿主异步拿到当前目录后回灌;只在 prop 真正变化时覆盖用户输入。
  useEffect(() => {
    if (initialPath !== undefined) setValue(initialPath);
  }, [initialPath]);

  const paths = defaultPaths ?? [];
  const shown = error ?? localError;

  function handleSubmit() {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setLocalError("请选择或输入一个目录");
      return;
    }
    setLocalError(null);
    onSubmit(trimmed);
  }

  return (
    <div
      className={className ? `${styles.root} ${className}` : styles.root}
      data-testid="data-dir-prompt"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={styles.card}>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>

        {paths.length > 0 && (
          <div className={styles.chips} data-testid="data-dir-defaults">
            {paths.map((path) => (
              <button
                key={path}
                type="button"
                className={`${styles.chip} ${path === value ? styles.chipActive : ""}`}
                onClick={() => {
                  setLocalError(null);
                  setValue(path);
                }}
                disabled={busy}
                data-testid="data-dir-default"
              >
                {path}
              </button>
            ))}
          </div>
        )}

        <label className={styles.fieldLabel} htmlFor="openbuddy-data-dir">
          数据目录
        </label>
        <input
          id="openbuddy-data-dir"
          className={styles.input}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          onChange={(event) => {
            setLocalError(null);
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          data-testid="data-dir-input"
        />

        <p className={styles.note}>所有内容都留在这台设备上,OpenBuddy 不会上传你的文件。</p>

        {shown && (
          <p className={styles.error} role="alert" data-testid="data-dir-error">
            {shown}
          </p>
        )}

        <div className={styles.footer}>
          {onCancel && (
            <button
              type="button"
              className={styles.ghost}
              onClick={onCancel}
              disabled={busy}
              data-testid="data-dir-cancel"
            >
              稍后再说
            </button>
          )}
          <button
            type="button"
            className={styles.primary}
            onClick={handleSubmit}
            disabled={busy}
            data-testid="data-dir-submit"
          >
            {busy ? "保存中…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
