/**
 * 权限模式选择器 - Composer meta 行的下拉
 *
 * 对应 pi 的 `[ui] permission_mode`,五档(与 Pi 原生 1:1 对齐):
 *  - default          默认:每次工具调用都弹确认
 *  - acceptEdits      接受编辑:文件编辑类自动批准,其余询问
 *  - dontAsk          不再询问:仅对白名单工具静默执行
 *  - plan             计划模式:进入 plan 流程,执行需先批准
 *  - bypassPermissions 完全跳过:所有工具调用自动批准
 *
 * 切换会写入 config.toml(影响之后的启动),并通过
 * `pi://permission-mode` 通知运行中的 agent 立即生效。
 *
 * 历史 3 档(ask / auto / always-approve)已废弃,1:1 映射在
 * `electron/main/ipc.ts` 完成;本组件直接使用 Pi 原生 5 档 ID。
 *
 * 视觉:参考 Claude Code 权限下拉的"盾牌 + 标题 + 描述 + 右侧勾选"风格,
 * 但保持 5 档;配色遵循 openbuddy tokens(`--wb-bg-primary` / `--wb-border-default` /
 * `--wb-text-strong/medium/weak`)。`bypassPermissions` 档用 warning 红色凸显风险。
 *
 * 文案走 `src/lib/i18n.ts` (`t('permission.modes.default')` 等)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  PlanToolIcon,
  ShieldCheckIcon,
  WarningOutlineIcon,
} from "@openbuddy/ui-primitives/icons";
import type { IconComponentProps } from "@openbuddy/ui-primitives/icons";
import { permissionModeGet, permissionModeSet } from "@/lib/agent/pi-client";
import type { PermissionMode } from "@/lib/agent/pi-client";
import { useT } from "@/lib/platform/i18n";

const MODE_IDS: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "dontAsk",
  "plan",
  "bypassPermissions",
];

type IconComponent = ForwardRefExoticComponent<
  Omit<IconComponentProps, "ref"> & RefAttributes<SVGSVGElement>
>;

/** 5 档视觉语义:每档的图标 + 色调倾向(用于激活态的勾选/标题着色)。 */
const MODE_VISUALS: Record<PermissionMode, { Icon: IconComponent; tone: "neutral" | "warning" | "danger" }> = {
  default: { Icon: ShieldCheckIcon, tone: "neutral" },
  acceptEdits: { Icon: ShieldCheckIcon, tone: "neutral" },
  dontAsk: { Icon: ShieldCheckIcon, tone: "neutral" },
  plan: { Icon: PlanToolIcon, tone: "neutral" },
  bypassPermissions: { Icon: WarningOutlineIcon, tone: "danger" },
};

export function PermissionPicker({
  onToast,
  triggerLabel,
}: {
  onToast?: (msg: string) => void;
  /** 覆盖触发按钮文字(如本地助理页固定显示「默认权限」);缺省显示当前模式名。 */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PermissionMode>("default");
  const [busy, setBusy] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  const titleKey = useT("permission.title");
  const failedPrefix = useT("permission.mode_change_failed");

  // Build mode entries using translations, refreshed whenever the locale changes.
  const modes = useMemo(
    () =>
      MODE_IDS.map((id) => ({
        id,
        labelKey: `permission.modes.${id}`,
        descKey: `permission.descriptions.${id}`,
      })),
    [],
  );
  const labels = useT(`permission.modes.${mode}`);
  const descs = useT(`permission.descriptions.${mode}`);
  const currentVisual = MODE_VISUALS[mode];

  useEffect(() => {
    permissionModeGet()
      .then(setMode)
      .catch(() => {
        /* 读不到就用默认 default */
      });
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
      setBusy(true);
      try {
        await permissionModeSet(next);
        setMode(next);
        setOpen(false);
      } catch (e) {
        onToast?.(`${failedPrefix}:${String(e).replace(/^Error:\s*/, "")}`);
      } finally {
        setBusy(false);
      }
    },
    [mode, onToast, failedPrefix],
  );


  return (
    <div
      className={
        "permission-picker" +
        (open ? " permission-picker--open" : "") +
        " permission-picker--tone-" + currentVisual.tone
      }
      ref={popRef}
    >
      <button
        type="button"
        className={
          "wb-composer-meta__btn permission-picker__trigger" +
          " permission-picker__trigger--tone-" + currentVisual.tone
        }
        onClick={() => setOpen((v) => !v)}
        title={`${titleKey} · ${descs}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <currentVisual.Icon size="sm" className="permission-picker__trigger-icon" />
        <span className="permission-picker__trigger-label">
          {triggerLabel ?? labels}
        </span>
        <ChevronDownIcon size="sm" className="permission-picker__trigger-caret" />
      </button>
      {open && (
        <div
          className="permission-picker__popover"
          role="menu"
          aria-label={titleKey}
        >
          <div className="permission-picker__header">{titleKey}</div>
          <div className="permission-picker__modes">
            {modes.map((m) => (
              <ModeButton
                key={m.id}
                id={m.id}
                labelKey={m.labelKey}
                descKey={m.descKey}
                active={m.id === mode}
                disabled={busy}
                onClick={() => select(m.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  id,
  labelKey,
  descKey,
  active,
  disabled,
  onClick,
}: {
  id: PermissionMode;
  labelKey: string;
  descKey: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = useT(labelKey);
  const desc = useT(descKey);
  const { Icon, tone } = MODE_VISUALS[id];
  return (
    <button
      type="button"
      className={
        "permission-picker__mode permission-picker__mode--tone-" + tone +
        (active ? " permission-picker__mode--active" : "")
      }
      onClick={onClick}
      disabled={disabled}
      role="menuitemradio"
      aria-checked={active}
      data-permission-mode={id}
    >
      <span className="permission-picker__mode-icon" aria-hidden="true">
        <Icon size="md" />
      </span>
      <span className="permission-picker__mode-text">
        <span className="permission-picker__mode-label">{label}</span>
        <span className="permission-picker__mode-desc">{desc}</span>
      </span>
      {active ? (
        <CheckIcon
          size="md"
          className="permission-picker__mode-check"
          aria-hidden="true"
        />
      ) : (
        <span className="permission-picker__mode-check permission-picker__mode-check--placeholder" aria-hidden="true" />
      )}
    </button>
  );
}
