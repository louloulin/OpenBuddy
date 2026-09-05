/**
 * 关于 OpenBuddy 对话框 - 显示版本/内核/认证信息。
 *
 * 从 piInit() 的 InitResult 取 agentVersion，从 piAuthStatus() 取认证状态，
 * 内核路径指向项目内 vendor/pi-build submodule。
 *
 * 文案走 `src/lib/i18n.ts` (`t('about.*')`)。
 */
import { useEffect, useState } from "react";
import { XCloseIcon, CheckIcon } from "@openbuddy/ui-primitives/icons";
import { piAuthStatus } from "@/lib/agent/pi-client";
import type { InitResult } from "@/lib/agent/pi-client";
import { APP_VERSION } from "@/lib/platform/app-version";
import { useT } from "@/lib/platform/i18n";
import logoUrl from "@/assets/openbuddy-logo.svg";
// pi-build 是 OpenBuddy 的进程内内核，作为 git submodule 内置于 vendor/pi-build，
// 通过 Cargo 相对路径依赖引入。
const PI_BUILD_PATH = "vendor/pi-build (submodule)";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  init?: InitResult | null;
}

export function AboutDialog({ open, onClose, init }: AboutDialogProps) {
  const [authReady, setAuthReady] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<string[]>([]);

  const title = useT("about.title");
  const versionLabel = useT("about.version");

  useEffect(() => {
    if (!open) return;
    piAuthStatus()
      .then((s) => {
        setAuthReady(s.ready);
        setProviders(s.providers);
      })
      .catch(() => setAuthReady(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="about-dialog__overlay" onClick={onClose}>
      <div
        className="about-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <button className="about-dialog__close" onClick={onClose} aria-label={useT("common.close")}>
          <XCloseIcon size="md" />
        </button>
        <div className="about-dialog__header">
          <img
            src={logoUrl}
            alt="OpenBuddy"
            className="about-dialog__logo"
            width={48}
            height={48}
          />
          <div>
            <h2 className="about-dialog__title">OpenBuddy</h2>
            <p className="about-dialog__subtitle">
              WorkBuddy 风格的 pi 桌面外壳
            </p>
          </div>
        </div>
        <dl className="about-dialog__list">
          <div className="about-dialog__row">
            <dt>{versionLabel}</dt>
            <dd>v{APP_VERSION}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>pi agent</dt>
            <dd>{init?.agentVersion ?? "未知"}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>默认模型</dt>
            <dd>{init?.defaultModelId ?? "未指定"}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>工作目录</dt>
            <dd title={init?.cwd}>{init?.cwd ?? "—"}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>内核路径</dt>
            <dd title={PI_BUILD_PATH}>
              <code>{PI_BUILD_PATH}</code>
            </dd>
          </div>
          <div className="about-dialog__row">
            <dt>认证状态</dt>
            <dd>
              {authReady === null ? (
                "检查中…"
              ) : authReady ? (
                <span className="about-dialog__ok">
                  <CheckIcon size="sm" /> 就绪
                </span>
              ) : (
                <span className="about-dialog__warn">未就绪</span>
              )}
            </dd>
          </div>
          {providers.length > 0 && (
            <div className="about-dialog__row">
              <dt>已配置模型</dt>
              <dd>{providers.join(", ")}</dd>
            </div>
          )}
        </dl>
        <p className="about-dialog__footer">
          基于 <code>Electron</code> + <code>React</code> +{" "}
          <code>Pi agent runtime</code> 驱动。
        </p>
      </div>
    </div>
  );
}
