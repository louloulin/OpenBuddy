
import { useEffect, useState } from "react";
import { XCloseIcon, CheckIcon } from "@/foundation/components/Icon/icons";
import { agentAuthStatus } from "@openbuddy/client/agent-client";
import type { InitResult } from "@openbuddy/client/agent-client";
import { APP_VERSION } from "@/lib/app-version";
import logoUrl from "@/assets/openbuddy-logo.svg";
// 引擎运行在 Electron 主进程。
const ENGINE_PACKAGE = "@earendil-works/pi-coding-agent";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  init?: InitResult | null;
}

export function AboutDialog({ open, onClose, init }: AboutDialogProps) {
  const [authReady, setAuthReady] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    agentAuthStatus()
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
        aria-label="关于 OpenBuddy"
      >
        <button className="about-dialog__close" onClick={onClose} aria-label="关闭">
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
              基于 Pi 的桌面智能体
            </p>
          </div>
        </div>
        <dl className="about-dialog__list">
          <div className="about-dialog__row">
            <dt>版本</dt>
            <dd>v{APP_VERSION}</dd>
          </div>
          <div className="about-dialog__row">
            <dt>agent agent</dt>
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
            <dt>引擎包</dt>
            <dd title={ENGINE_PACKAGE}>
              <code>{ENGINE_PACKAGE}</code>
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
          <code>@earendil-works/pi-coding-agent</code> 内置。
        </p>
      </div>
    </div>
  );
}
