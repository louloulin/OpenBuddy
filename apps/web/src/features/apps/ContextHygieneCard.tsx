import { useState } from "react";
import { Clock } from "lucide-react";
import type { IdleApp } from "@openbuddy/client/api/files";

/**
 * 上下文治理卡 (20261126-upup UP-6.4 / 20261127-upup U5)。
 *
 * 已启用但 ≥14 天没用过的应用仍会把工具和技能塞进每个新会话的上下文；这里提示一键停用。
 * 「保留」之后 14 天内不再提醒。数据来自宿主 `apps_hygiene`（引擎按工具来源包记的最近使用日）。
 */
export function ContextHygieneCard({
  idle,
  onDisable,
  onKeep,
}: {
  idle: IdleApp[];
  onDisable: (app: IdleApp) => Promise<void>;
  onKeep: (app: IdleApp) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  if (!idle.length) return null;
  const run = async (app: IdleApp, action: (app: IdleApp) => Promise<void>) => {
    setBusy(app.packageSource);
    try {
      await action(app);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="apps-hygiene" aria-label="长期未使用的应用">
      <header className="apps-hygiene__head">
        <Clock size={15} aria-hidden />
        <strong>长期未使用</strong>
        <span className="apps-hygiene__desc">停用后它的工具与技能不再进入新会话，随时可以重新启用。</span>
      </header>
      <ul className="apps-hygiene__list">
        {idle.map((app) => (
          <li key={app.packageSource} className="apps-hygiene__item">
            <span className="apps-hygiene__name">{app.name}</span>
            <span className="apps-hygiene__meta">
              {app.lastUsedAt ? `${app.idleDays} 天未使用（最近 ${app.lastUsedAt}）` : `安装 ${app.idleDays} 天以来未使用`}
            </span>
            <button type="button" className="apps-hygiene__btn" disabled={busy === app.packageSource} onClick={() => void run(app, onDisable)}>
              停用 {app.name}
            </button>
            <button type="button" className="apps-hygiene__btn apps-hygiene__btn--ghost" disabled={busy === app.packageSource} onClick={() => void run(app, onKeep)}>
              保留
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
